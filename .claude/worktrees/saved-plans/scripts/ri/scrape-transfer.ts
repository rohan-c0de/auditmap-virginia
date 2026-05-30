/**
 * scrape-transfer.ts
 *
 * Scrapes transfer equivalency data from TES (Transfer Evaluation System)
 * Public View for:
 *   - CCRI -> University of Rhode Island (URI)
 *   - CCRI -> Rhode Island College (RIC)
 *
 * CollegeTransfer.Net does not have CCRI->URI/RIC data, so we scrape the
 * TES Public View pages directly. These are ASP.NET WebForms apps with a
 * math CAPTCHA that can be solved programmatically.
 *
 * Flow per target:
 *   1. GET the TES page -> extract form fields + CAPTCHA token
 *   2. POST (async) to switch to math CAPTCHA mode
 *   3. POST (full page) to submit the math answer
 *   4. POST (full page) to search for "Community College of Rhode Island"
 *   5. POST (full page) to select CCRI from results
 *   6. POST (full page) to paginate through all equivalency pages
 *   7. Parse each page's table -> TransferMapping[]
 *
 * IMPORTANT: Steps 3+ use full-page POSTs (not async UpdatePanel posts)
 * and carry ALL form fields from the previous response. This is required
 * because ASP.NET's EventValidation rejects postbacks when form fields
 * are missing (e.g., hidden fields inside GridView controls).
 *
 * Usage:
 *   npx tsx scripts/ri/scrape-transfer.ts
 *   npx tsx scripts/ri/scrape-transfer.ts --no-import
 */

import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TransferMapping {
  state: string;
  cc_prefix: string;
  cc_number: string;
  cc_course: string;
  cc_title: string;
  cc_credits: string;
  university: string;
  university_name: string;
  univ_course: string;
  univ_title: string;
  univ_credits: string;
  notes: string;
  no_credit: boolean;
  is_elective: boolean;
}

interface TESTarget {
  url: string;
  universitySlug: string;
  universityName: string;
  searchTerm: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TARGETS: TESTarget[] = [
  {
    url: "https://tes.collegesource.com/publicview/TES_publicview01.aspx?rid=1c0bd699-6f8b-42fc-ac83-51408ff760a1&aid=c28df682-d5df-4a28-99b1-9f25280c1db2",
    universitySlug: "uri",
    universityName: "University of Rhode Island",
    searchTerm: "Community College of Rhode Island",
  },
  {
    url: "https://tes.collegesource.com/publicview/TES_publicview01.aspx?rid=e5211763-2fb1-4582-af04-2a4a4ec9a7a4&aid=7b15105c-3488-40e6-a258-c47eb0ffd072",
    universitySlug: "ric",
    universityName: "Rhode Island College",
    searchTerm: "Community College of Rhode Island",
  },
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// HTTP / Cookie Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractCookies(resp: Response): string {
  const setCookies = resp.headers.getSetCookie?.() || [];
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

function mergeCookies(existing: string, newCookies: string): string {
  if (!newCookies) return existing;
  if (!existing) return newCookies;
  const map = new Map<string, string>();
  for (const pair of existing.split("; ")) {
    const [k, ...rest] = pair.split("=");
    if (k) map.set(k, rest.join("="));
  }
  for (const pair of newCookies.split("; ")) {
    const [k, ...rest] = pair.split("=");
    if (k) map.set(k, rest.join("="));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

// ---------------------------------------------------------------------------
// ASP.NET Helpers
// ---------------------------------------------------------------------------

/**
 * Parse ASP.NET async UpdatePanel response.
 * Format: length|type|id|content|length|type|id|content|...
 * The 'length' prefix is the char count of 'content'.
 */
function parseAsyncResponse(text: string): {
  panels: Map<string, string>;
  fields: Map<string, string>;
} {
  const panels = new Map<string, string>();
  const fields = new Map<string, string>();
  let pos = 0;
  while (pos < text.length) {
    const p1 = text.indexOf("|", pos);
    if (p1 === -1) break;
    const length = parseInt(text.substring(pos, p1), 10);
    if (isNaN(length)) break;
    const p2 = text.indexOf("|", p1 + 1);
    if (p2 === -1) break;
    const type = text.substring(p1 + 1, p2);
    const p3 = text.indexOf("|", p2 + 1);
    if (p3 === -1) break;
    const id = text.substring(p2 + 1, p3);
    const cs = p3 + 1;
    const content = text.substring(cs, cs + length);
    if (type === "hiddenField") fields.set(id, content);
    else if (type === "updatePanel") panels.set(id, content);
    pos = cs + length + 1;
  }
  return { panels, fields };
}

/**
 * Extract ALL form fields from a full HTML page.
 * This is critical for ASP.NET WebForms — missing fields cause
 * EventValidation errors on postback.
 */
function extractAllFormFields($: cheerio.CheerioAPI): Record<string, string> {
  const fields: Record<string, string> = {};

  $("input[type='hidden']").each((_, el) => {
    const name = $(el).attr("name");
    const value = $(el).attr("value") || "";
    if (name) fields[name] = value;
  });

  $("input[type='text']").each((_, el) => {
    const name = $(el).attr("name");
    const value = $(el).attr("value") || "";
    if (name) fields[name] = value;
  });

  $("select").each((_, el) => {
    const name = $(el).attr("name");
    const value =
      $(el).find("option[selected]").attr("value") ||
      $(el).find("option:first-child").attr("value") ||
      "";
    if (name) fields[name] = value;
  });

  return fields;
}

/**
 * POST to TES page as an ASP.NET async (UpdatePanel) postback.
 * Only used for CAPTCHA mode switch in step 2.
 */
async function doAsyncPost(
  url: string,
  cookies: string,
  params: Record<string, string>
): Promise<{ text: string; cookies: string }> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Cookie: cookies,
      "X-MicrosoftAjax": "Delta=true",
    },
    body: new URLSearchParams(params).toString(),
  });
  return {
    text: await resp.text(),
    cookies: mergeCookies(cookies, extractCookies(resp)),
  };
}

/**
 * POST to TES page as a regular full-page postback.
 * Returns full HTML which can be parsed for form fields.
 */
async function doFullPost(
  url: string,
  cookies: string,
  params: Record<string, string>
): Promise<{ html: string; cookies: string }> {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookies,
    },
    body: new URLSearchParams(params).toString(),
    redirect: "follow",
  });
  return {
    html: await resp.text(),
    cookies: mergeCookies(cookies, extractCookies(resp)),
  };
}

// ---------------------------------------------------------------------------
// CAPTCHA / Parsing Helpers
// ---------------------------------------------------------------------------

/**
 * Solve a simple math CAPTCHA question like "Solve: 3 + 5 = ?"
 */
function solveMathCaptcha(question: string): number {
  const match = question.match(/(\d+)\s*([+\-\u2212\xD7x*])\s*(\d+)/);
  if (!match) {
    throw new Error(`Cannot parse math CAPTCHA: "${question}"`);
  }
  const a = parseInt(match[1]);
  const op = match[2];
  const b = parseInt(match[3]);
  switch (op) {
    case "+":
      return a + b;
    case "-":
    case "\u2212":
      return a - b;
    case "\xD7":
    case "x":
    case "*":
      return a * b;
    default:
      throw new Error(`Unknown math operator: "${op}"`);
  }
}

/**
 * Parse a CCRI course string like "ENGL 1010 ENGLISH COMPOSITION I (3)"
 */
function parseCCRICourse(raw: string): {
  prefix: string;
  number: string;
  title: string;
  credits: string;
} {
  const cleaned = raw.trim();
  const match = cleaned.match(
    /^([A-Z]{2,5})\s+(\d{3,5}[A-Z]?)\s+(.+?)(?:\s*\((\d+(?:\s*(?:to|-)\s*\d+)?)\))?\s*$/
  );
  if (match) {
    return {
      prefix: match[1],
      number: match[2],
      title: match[3].trim(),
      credits: match[4] || "",
    };
  }
  const simple = cleaned.match(/^([A-Z]{2,5})\s+(\S+)\s*(.*)/);
  if (simple) {
    const titleCredits = simple[3].match(
      /^(.+?)\s*\((\d+(?:\s*(?:to|-)\s*\d+)?)\)\s*$/
    );
    return {
      prefix: simple[1],
      number: simple[2],
      title: titleCredits?.[1]?.trim() || simple[3].trim(),
      credits: titleCredits?.[2] || "",
    };
  }
  return { prefix: "", number: "", title: cleaned, credits: "" };
}

/**
 * Parse a university course string like "ENG 101 COMPOSITION (3)"
 */
function parseUnivCourse(raw: string): {
  course: string;
  title: string;
  credits: string;
} {
  const cleaned = raw.trim();
  const match = cleaned.match(
    /^([A-Z]{2,5}\s+\S+)\s+(.+?)(?:\s*\((\d+(?:\s*(?:to|-)\s*\d+)?)\))?\s*$/
  );
  if (match) {
    return {
      course: match[1].trim(),
      title: match[2].trim(),
      credits: match[3] || "",
    };
  }
  return { course: cleaned, title: "", credits: "" };
}

/**
 * Detect if a university course is an elective.
 */
function isElective(courseStr: string, titleStr: string): boolean {
  const course = courseStr.toUpperCase();
  const title = titleStr.toLowerCase();
  return (
    course.includes("XX") ||
    title.includes("elective") ||
    title.includes("general education") ||
    /\d[A-Z]\d/.test(course)
  );
}

/**
 * Parse the equivalency table rows from TES HTML.
 */
function parseEquivalencyTable(
  html: string,
  universitySlug: string,
  universityName: string
): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  $("#gdvCourseEQ tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length < 4) return;

    const ccLink = $(tds[0]).find("a[id*='btnViewCourseEQDetail']");
    if (ccLink.length === 0) return;

    const ccRaw = ccLink.attr("title") || ccLink.text().trim();
    const cc = parseCCRICourse(ccRaw);
    if (!cc.prefix || !cc.number) return;

    const univSpan = $(tds[1]).find("span[id*='lblReceiveCourseCode']");
    let univRaw = univSpan.text().trim() || $(tds[1]).text().trim();

    // TES sometimes concatenates multiple receiving courses without a
    // delimiter. Split on course-code boundaries and take only the first.
    // e.g. "WRT 104 WRITING (3)WRT 106 RESEARCH" -> take "WRT 104 WRITING (3)"
    const multiMatch = univRaw.match(
      /^([A-Z]{2,5}\s+\S+\s+.+?\(\d+(?:\s*(?:to|-)\s*\d+)?\))([A-Z]{2,5}\s+\S+)/
    );
    let additionalCourses = "";
    if (multiMatch) {
      const rest = univRaw.substring(multiMatch[1].length).trim();
      univRaw = multiMatch[1];
      additionalCourses = rest;
    }

    const univ = parseUnivCourse(univRaw);

    // Skip expired equivalencies
    const endDate = $(tds[4])?.text().trim().replace(/\u00a0/g, "").trim();
    if (endDate && endDate.length > 0) {
      const endParsed = new Date(endDate);
      if (!isNaN(endParsed.getTime()) && endParsed < new Date()) {
        return;
      }
    }

    const noCredit =
      univRaw.toLowerCase().includes("no credit") ||
      univRaw.toLowerCase().includes("does not transfer") ||
      univRaw.toLowerCase().includes("no equivalent");
    const isElec =
      !noCredit && isElective(univ.course, univ.title || univRaw);

    mappings.push({
      state: "ri",
      cc_prefix: cc.prefix,
      cc_number: cc.number,
      cc_course: `${cc.prefix} ${cc.number}`,
      cc_title: cc.title,
      cc_credits: cc.credits,
      university: universitySlug,
      university_name: universityName,
      univ_course: noCredit ? "" : univ.course,
      univ_title: noCredit ? "Does not transfer" : univ.title || univRaw,
      univ_credits: noCredit ? "" : univ.credits,
      notes: additionalCourses
        ? `Also awards: ${additionalCourses}`
        : "",
      no_credit: noCredit,
      is_elective: isElec,
    });
  });

  return mappings;
}

// ---------------------------------------------------------------------------
// Main TES Scraper
// ---------------------------------------------------------------------------

async function scrapeTESPublicView(
  target: TESTarget
): Promise<TransferMapping[]> {
  const { url, universitySlug, universityName, searchTerm } = target;
  const allMappings: TransferMapping[] = [];

  // --- Step 1: GET the page (with retry for transient errors) ---
  console.log("  Step 1: Fetching TES page...");
  let resp1: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    resp1 = await fetch(url, { headers: { "User-Agent": UA } });
    if (resp1.ok) break;
    console.log(
      `  Step 1: HTTP ${resp1.status}, retrying (${attempt + 1}/3)...`
    );
    await resp1.text(); // consume body
    await sleep(2000 * (attempt + 1));
  }
  if (!resp1 || !resp1.ok)
    throw new Error(`HTTP ${resp1?.status} fetching TES page after retries`);
  let cookies = extractCookies(resp1);
  const html1 = await resp1.text();
  let $ = cheerio.load(html1);
  let fields = extractAllFormFields($);

  if (!fields["_VSTATE"] || !fields["__EVENTVALIDATION"]) {
    throw new Error("Could not extract ViewState from TES page");
  }

  // --- Step 2: Switch to math CAPTCHA (async POST required) ---
  console.log("  Step 2: Switching to math CAPTCHA...");
  await sleep(500);
  const r2 = await doAsyncPost(url, cookies, {
    ScriptManager1: "udpPublicView01|Captcha1$rblMode$1",
    __EVENTTARGET: "Captcha1$rblMode$1",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    ...fields,
    "Captcha1$rblMode": "math",
    "Captcha1$txtAnswer": "",
    __ASYNCPOST: "true",
  });
  cookies = r2.cookies;
  const p2 = parseAsyncResponse(r2.text);
  // Update fields from async response
  for (const [k, v] of p2.fields) fields[k] = v;

  const $2 = cheerio.load([...p2.panels.values()].join(""));
  const mathQuestion = $2("#Captcha1_lblMath").text();
  fields["Captcha1$hfToken"] =
    $2("#Captcha1_hfToken").val()?.toString() || "";

  if (!mathQuestion) {
    throw new Error("Could not find math CAPTCHA question");
  }

  const answer = solveMathCaptcha(mathQuestion);
  console.log(`  Step 2: "${mathQuestion}" => ${answer}`);

  // --- Step 3: Submit CAPTCHA answer (full POST) ---
  console.log("  Step 3: Submitting CAPTCHA...");
  await sleep(500);
  let fr = await doFullPost(url, cookies, {
    ...fields,
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    "Captcha1$rblMode": "math",
    "Captcha1$txtAnswer": String(answer),
    btnCaptchaSubmit: "Submit",
  });
  cookies = fr.cookies;
  $ = cheerio.load(fr.html);
  fields = extractAllFormFields($);

  if (!fr.html.includes("tbxSearchTransferCollege")) {
    throw new Error(
      "CAPTCHA was not solved correctly -- search box not found"
    );
  }
  console.log("  Step 3: CAPTCHA solved!");

  // --- Step 4: Search for CCRI (full POST) ---
  console.log(`  Step 4: Searching for "${searchTerm}"...`);
  await sleep(500);
  fields["tbxSearchTransferCollege"] = searchTerm;
  fr = await doFullPost(url, cookies, {
    ...fields,
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    btnSearchTransferCollege: "Search",
  });
  cookies = fr.cookies;
  $ = cheerio.load(fr.html);
  fields = extractAllFormFields($);

  // Find the CCRI link
  const ccriLink = $("a[id*='btnCreditFromInstName']").first();
  if (ccriLink.length === 0) {
    throw new Error("CCRI not found in search results");
  }
  const href = ccriLink.attr("href") || "";
  const postbackMatch = href.match(
    /__doPostBack\(&#39;([^&]+)&#39;/
  ) || href.match(/__doPostBack\('([^']+)'/);
  if (!postbackMatch) {
    throw new Error("Could not extract postback target for CCRI");
  }
  const ccriPostbackTarget = postbackMatch[1];
  console.log(`  Step 4: Found CCRI`);

  // --- Step 5: Click CCRI (full POST) ---
  console.log("  Step 5: Loading equivalencies...");
  await sleep(500);
  fr = await doFullPost(url, cookies, {
    ...fields,
    __EVENTTARGET: ccriPostbackTarget,
    __EVENTARGUMENT: "",
  });
  cookies = fr.cookies;
  $ = cheerio.load(fr.html);
  fields = extractAllFormFields($);

  const pageInfoMatch = fr.html.match(/PAGE\s+(\d+)\s+OF\s+(\d+)/i);
  const totalPages = pageInfoMatch ? parseInt(pageInfoMatch[2]) : 1;
  console.log(`  Step 5: Found ${totalPages} page(s) of equivalencies`);

  // Parse page 1
  const page1Mappings = parseEquivalencyTable(
    fr.html,
    universitySlug,
    universityName
  );
  allMappings.push(...page1Mappings);
  console.log(`  Page 1: ${page1Mappings.length} mappings`);

  // --- Step 6: Paginate (full POST with all form fields) ---
  let consecutiveEmpty = 0;
  for (let page = 2; page <= totalPages; page++) {
    await sleep(800);
    console.log(`  Loading page ${page}/${totalPages}...`);

    fr = await doFullPost(url, cookies, {
      ...fields,
      __EVENTTARGET: "gdvCourseEQ",
      __EVENTARGUMENT: `Page$${page}`,
    });
    cookies = fr.cookies;

    // Detect session expiry (CAPTCHA page returned)
    if (fr.html.includes("Security Verification") && fr.html.includes("Captcha1")) {
      console.log(`  Session expired at page ${page} (CAPTCHA returned). Stopping pagination.`);
      break;
    }

    // Detect EventValidation error
    if (fr.html.includes("Invalid postback")) {
      console.error(`  Page ${page} failed: EventValidation error. Stopping pagination.`);
      break;
    }

    $ = cheerio.load(fr.html);
    fields = extractAllFormFields($);

    const pageMappings = parseEquivalencyTable(
      fr.html,
      universitySlug,
      universityName
    );
    allMappings.push(...pageMappings);
    console.log(`  Page ${page}: ${pageMappings.length} mappings`);

    // Stop after 3 consecutive empty pages (likely end of data)
    if (pageMappings.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 3) {
        console.log(`  3 consecutive empty pages. Stopping.`);
        break;
      }
    } else {
      consecutiveEmpty = 0;
    }
  }

  return allMappings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const noImport = process.argv.includes("--no-import");

  console.log("TES Public View -- Rhode Island Transfer Scraper\n");
  console.log("Source: Community College of Rhode Island (CCRI)\n");

  const allMappings: TransferMapping[] = [];

  for (const target of TARGETS) {
    console.log(
      `\n${"=".repeat(60)}\n${target.universityName} (${target.universitySlug})\n${"=".repeat(60)}`
    );
    try {
      const mappings = await scrapeTESPublicView(target);
      allMappings.push(...mappings);
      console.log(`  Total: ${mappings.length} mappings`);
    } catch (err) {
      console.error(
        `  ERROR scraping ${target.universityName}: ${(err as Error).message}`
      );
    }
    await sleep(2000);
  }

  // Filter out no-transfer entries for stats
  const transferable = allMappings.filter((m) => !m.no_credit);

  // Stats
  const byUniv = new Map<string, number>();
  for (const m of transferable) {
    byUniv.set(m.university, (byUniv.get(m.university) || 0) + 1);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("Summary:");
  console.log(`  Total mappings: ${allMappings.length}`);
  console.log(`  Transferable: ${transferable.length}`);
  for (const [univ, count] of byUniv) {
    console.log(`    ${univ}: ${count}`);
  }
  console.log(
    `  Direct equivalencies: ${transferable.filter((m) => !m.is_elective).length}`
  );
  console.log(
    `  Elective credit: ${transferable.filter((m) => m.is_elective).length}`
  );
  console.log(
    `  No transfer: ${allMappings.filter((m) => m.no_credit).length}`
  );

  // Spot checks
  const eng1010 = transferable.find(
    (m) =>
      m.cc_prefix === "ENGL" &&
      m.cc_number === "1010" &&
      m.university === "uri"
  );
  if (eng1010) {
    console.log(
      `\n  Spot check -- ENGL 1010 -> URI: ${eng1010.univ_course} (${eng1010.univ_title})`
    );
  }
  const math1000 = transferable.find(
    (m) =>
      m.cc_prefix === "MATH" &&
      m.cc_number === "1000" &&
      m.university === "uri"
  );
  if (math1000) {
    console.log(
      `  Spot check -- MATH 1000 -> URI: ${math1000.univ_course} (${math1000.univ_title})`
    );
  }
  const psyc2010 = transferable.find(
    (m) =>
      m.cc_prefix === "PSYC" &&
      m.cc_number === "2010" &&
      m.university === "ric"
  );
  if (psyc2010) {
    console.log(
      `  Spot check -- PSYC 2010 -> RIC: ${psyc2010.univ_course} (${psyc2010.univ_title})`
    );
  }

  if (transferable.length === 0) {
    console.log(
      "\nNo transferable mappings found! Check if TES changed its structure."
    );
    process.exit(1);
  }

  // Deduplicate: keep latest entry per (cc_course, university, univ_course).
  // TES sometimes lists multiple entries for the same course.
  const deduped = new Map<string, TransferMapping>();
  for (const m of allMappings) {
    const key = `${m.cc_course}|${m.university}|${m.univ_course}`;
    deduped.set(key, m);
  }
  const finalMappings = [...deduped.values()];
  if (finalMappings.length < allMappings.length) {
    console.log(
      `\nDeduplicated: ${allMappings.length} -> ${finalMappings.length} unique mappings`
    );
  }

  // Save to file
  const outPath = path.join(
    process.cwd(),
    "data",
    "ri",
    "transfer-equiv.json"
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(finalMappings, null, 2) + "\n");
  console.log(`\nSaved to ${outPath}`);

  // Import to Supabase
  if (!noImport) {
    try {
      const imported = await importTransfersToSupabase("ri");
      if (imported > 0) {
        console.log(`Imported ${imported} rows to Supabase`);
      }
    } catch (err) {
      console.log(`Supabase import skipped: ${(err as Error).message}`);
    }
  } else {
    console.log("Supabase import skipped (--no-import)");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
