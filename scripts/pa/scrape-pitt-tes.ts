/**
 * scrape-pitt-tes.ts
 *
 * Scrapes transfer equivalency data from TES (Transfer Evaluation System)
 * Public View for University of Pittsburgh, searching for each PA
 * community college as the sending institution.
 *
 * TES is the same platform used for RI (CCRI→URI/RIC). This scraper
 * adapts that pattern for Pitt's TES instance.
 *
 * Flow per CC:
 *   1. GET the TES page → extract form fields + CAPTCHA token
 *   2. POST (async) to switch to math CAPTCHA mode
 *   3. POST (full page) to submit the math answer
 *   4. POST (full page) to search for the CC name
 *   5. POST (full page) to select the CC from results
 *   6. POST (full page) to paginate through all equivalency pages
 *   7. Parse each page's table → TransferMapping[]
 *
 * Usage:
 *   npx tsx scripts/pa/scrape-pitt-tes.ts
 *   npx tsx scripts/pa/scrape-pitt-tes.ts --no-import
 *   npx tsx scripts/pa/scrape-pitt-tes.ts --cc bucks,ccp    # specific CCs only
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

interface CommunityCollege {
  slug: string;
  name: string;
  searchTerm: string; // what to type in TES search box
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PITT_TES_URL =
  "https://tes.collegesource.com/publicview/TES_publicview01.aspx?rid=f504ec66-ae16-41ae-97f2-fa3b680cd9b8&aid=2ac849fb-9d85-462e-a347-ad6cfc5342a1";

const UNIVERSITY_SLUG = "pitt";
const UNIVERSITY_NAME = "University of Pittsburgh";

const PA_COMMUNITY_COLLEGES: CommunityCollege[] = [
  { slug: "bucks", name: "Bucks County Community College", searchTerm: "Bucks County" },
  { slug: "butler", name: "Butler County Community College", searchTerm: "Butler County Community" },
  { slug: "ccac", name: "Community College of Allegheny County", searchTerm: "Allegheny County" },
  { slug: "ccbc", name: "Community College of Beaver County", searchTerm: "Beaver County" },
  { slug: "ccp", name: "Community College of Philadelphia", searchTerm: "Community College of Philadelphia" },
  { slug: "dccc", name: "Delaware County Community College", searchTerm: "Delaware County Community" },
  { slug: "hacc", name: "Harrisburg Area Community College", searchTerm: "Harrisburg Area" },
  { slug: "lccc", name: "Lehigh Carbon Community College", searchTerm: "Lehigh Carbon" },
  { slug: "luzerne", name: "Luzerne County Community College", searchTerm: "Luzerne County" },
  { slug: "mc3", name: "Montgomery County Community College", searchTerm: "Montgomery County Community" },
  { slug: "northampton", name: "Northampton Community College", searchTerm: "Northampton Community" },
  { slug: "pa-highlands", name: "Pennsylvania Highlands Community College", searchTerm: "Pennsylvania Highlands" },
  { slug: "racc", name: "Reading Area Community College", searchTerm: "Reading Area" },
  { slug: "westmoreland", name: "Westmoreland County Community College", searchTerm: "Westmoreland" },
  { slug: "penn-college", name: "Pennsylvania College of Technology", searchTerm: "Pennsylvania College of Technology" },
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
 * Parse a CC course string like "ENG 101 ENGLISH COMPOSITION I (3)"
 */
function parseCCCourse(raw: string): {
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

function parseEquivalencyTable(
  html: string,
  ccSlug: string
): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  $("#gdvCourseEQ tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length < 4) return;

    const ccLink = $(tds[0]).find("a[id*='btnViewCourseEQDetail']");
    if (ccLink.length === 0) return;

    const ccRaw = ccLink.attr("title") || ccLink.text().trim();
    const cc = parseCCCourse(ccRaw);
    if (!cc.prefix || !cc.number) return;

    const univSpan = $(tds[1]).find("span[id*='lblReceiveCourseCode']");
    let univRaw = univSpan.text().trim() || $(tds[1]).text().trim();

    // TES sometimes concatenates multiple receiving courses
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

    const notesArr: string[] = [];
    if (ccSlug) notesArr.push(`[${ccSlug}]`);
    if (additionalCourses) notesArr.push(`Also awards: ${additionalCourses}`);

    mappings.push({
      state: "pa",
      cc_prefix: cc.prefix,
      cc_number: cc.number,
      cc_course: `${cc.prefix} ${cc.number}`,
      cc_title: cc.title,
      cc_credits: cc.credits,
      university: UNIVERSITY_SLUG,
      university_name: UNIVERSITY_NAME,
      univ_course: noCredit ? "" : univ.course,
      univ_title: noCredit ? "Does not transfer" : univ.title || univRaw,
      univ_credits: noCredit ? "" : univ.credits,
      notes: notesArr.join(" "),
      no_credit: noCredit,
      is_elective: isElec,
    });
  });

  return mappings;
}

// ---------------------------------------------------------------------------
// TES Session Management
// ---------------------------------------------------------------------------

async function initTESSession(): Promise<{
  cookies: string;
  fields: Record<string, string>;
}> {
  // Step 1: GET the page
  console.log("  Initializing TES session...");
  let resp: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    resp = await fetch(PITT_TES_URL, { headers: { "User-Agent": UA } });
    if (resp.ok) break;
    console.log(`  HTTP ${resp.status}, retrying (${attempt + 1}/3)...`);
    await resp.text();
    await sleep(2000 * (attempt + 1));
  }
  if (!resp || !resp.ok)
    throw new Error(`HTTP ${resp?.status} fetching TES page after retries`);

  let cookies = extractCookies(resp);
  const html = await resp.text();
  let $ = cheerio.load(html);
  let fields = extractAllFormFields($);

  if (!fields["_VSTATE"] && !fields["__VIEWSTATE"] && !fields["__EVENTVALIDATION"]) {
    throw new Error("Could not extract ViewState from TES page");
  }

  // Step 2: Switch to math CAPTCHA
  console.log("  Switching to math CAPTCHA...");
  await sleep(500);
  const r2 = await doAsyncPost(PITT_TES_URL, cookies, {
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
  for (const [k, v] of p2.fields) fields[k] = v;

  const $2 = cheerio.load([...p2.panels.values()].join(""));
  const mathQuestion = $2("#Captcha1_lblMath").text();
  fields["Captcha1$hfToken"] =
    $2("#Captcha1_hfToken").val()?.toString() || "";

  if (!mathQuestion) {
    throw new Error("Could not find math CAPTCHA question");
  }

  const answer = solveMathCaptcha(mathQuestion);
  console.log(`  CAPTCHA: "${mathQuestion}" => ${answer}`);

  // Step 3: Submit CAPTCHA answer
  console.log("  Submitting CAPTCHA...");
  await sleep(500);
  const fr = await doFullPost(PITT_TES_URL, cookies, {
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
    throw new Error("CAPTCHA was not solved correctly — search box not found");
  }
  console.log("  CAPTCHA solved!\n");

  return { cookies, fields };
}

// ---------------------------------------------------------------------------
// Scrape one CC
// ---------------------------------------------------------------------------

async function scrapeCC(
  cc: CommunityCollege,
  cookies: string,
  fields: Record<string, string>
): Promise<{ mappings: TransferMapping[]; cookies: string; fields: Record<string, string> }> {
  const allMappings: TransferMapping[] = [];

  // Search for the CC
  console.log(`  Searching for "${cc.searchTerm}"...`);
  fields["tbxSearchTransferCollege"] = cc.searchTerm;
  let fr = await doFullPost(PITT_TES_URL, cookies, {
    ...fields,
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    btnSearchTransferCollege: "Search",
  });
  cookies = fr.cookies;
  let $ = cheerio.load(fr.html);
  fields = extractAllFormFields($);

  // Find the CC in search results
  const links = $("a[id*='btnCreditFromInstName']");
  if (links.length === 0) {
    console.log(`  "${cc.searchTerm}" not found in TES. Skipping.`);
    return { mappings: [], cookies, fields };
  }

  // Try to find the best match
  let bestLink = links.first();
  let bestText = bestLink.text().trim();
  links.each((_, el) => {
    const text = $(el).text().trim();
    if (text.toLowerCase().includes(cc.searchTerm.toLowerCase())) {
      bestLink = $(el);
      bestText = text;
    }
  });

  const href = bestLink.attr("href") || "";
  const postbackMatch =
    href.match(/__doPostBack\(&#39;([^&]+)&#39;/) ||
    href.match(/__doPostBack\('([^']+)'/);
  if (!postbackMatch) {
    console.log(`  Could not extract postback for "${cc.name}". Skipping.`);
    return { mappings: [], cookies, fields };
  }

  console.log(`  Found: "${bestText}"`);

  // Click the CC link
  await sleep(500);
  fr = await doFullPost(PITT_TES_URL, cookies, {
    ...fields,
    __EVENTTARGET: postbackMatch[1],
    __EVENTARGUMENT: "",
  });
  cookies = fr.cookies;
  $ = cheerio.load(fr.html);
  fields = extractAllFormFields($);

  const pageInfoMatch = fr.html.match(/PAGE\s+(\d+)\s+OF\s+(\d+)/i);
  const totalPages = pageInfoMatch ? parseInt(pageInfoMatch[2]) : 1;
  console.log(`  ${totalPages} page(s) of equivalencies`);

  // Parse page 1
  const page1 = parseEquivalencyTable(fr.html, cc.slug);
  allMappings.push(...page1);
  console.log(`  Page 1: ${page1.length} mappings`);

  // Paginate
  let consecutiveEmpty = 0;
  for (let page = 2; page <= totalPages; page++) {
    await sleep(800);

    fr = await doFullPost(PITT_TES_URL, cookies, {
      ...fields,
      __EVENTTARGET: "gdvCourseEQ",
      __EVENTARGUMENT: `Page$${page}`,
    });
    cookies = fr.cookies;

    if (fr.html.includes("Security Verification") && fr.html.includes("Captcha1")) {
      console.log(`  Session expired at page ${page}. Stopping.`);
      break;
    }

    if (fr.html.includes("Invalid postback")) {
      console.error(`  Page ${page}: EventValidation error. Stopping.`);
      break;
    }

    $ = cheerio.load(fr.html);
    fields = extractAllFormFields($);

    const pageMappings = parseEquivalencyTable(fr.html, cc.slug);
    allMappings.push(...pageMappings);

    if (page % 5 === 0 || page === totalPages) {
      console.log(`  Page ${page}/${totalPages}: ${allMappings.length} total`);
    }

    if (pageMappings.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 5) {
        console.log(`  5 consecutive empty pages. Stopping.`);
        break;
      }
      // Extra delay on empty page — might be transient
      await sleep(1500);
    } else {
      consecutiveEmpty = 0;
    }
  }

  return { mappings: allMappings, cookies, fields };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");

  // Parse --cc filter
  const ccArg = args.find((a) => a.startsWith("--cc=") || a.startsWith("--cc "));
  let ccFilter: string[] | null = null;
  const ccIdx = args.indexOf("--cc");
  if (ccIdx >= 0 && args[ccIdx + 1]) {
    ccFilter = args[ccIdx + 1].split(",").map((s) => s.trim());
  }
  for (const a of args) {
    if (a.startsWith("--cc=")) {
      ccFilter = a.substring(5).split(",").map((s) => s.trim());
    }
  }

  const colleges = ccFilter
    ? PA_COMMUNITY_COLLEGES.filter((cc) => ccFilter!.includes(cc.slug))
    : PA_COMMUNITY_COLLEGES;

  console.log("TES Public View — Pitt Transfer Scraper\n");
  console.log(`Target: ${UNIVERSITY_NAME}`);
  console.log(`Community Colleges: ${colleges.length}\n`);

  const allMappings: TransferMapping[] = [];
  let sessionCookies = "";
  let sessionFields: Record<string, string> = {};
  let sessionActive = false;

  for (let i = 0; i < colleges.length; i++) {
    const cc = colleges[i];
    console.log(
      `\n${"=".repeat(60)}\n[${i + 1}/${colleges.length}] ${cc.name}\n${"=".repeat(60)}`
    );

    // Start a fresh session for each CC (most robust approach)
    // TES sessions can be finicky about navigating back to search
    let sessionOk = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt > 0) {
          const backoff = 10000 * attempt;
          console.log(`  Waiting ${backoff / 1000}s before retry ${attempt + 1}...`);
          await sleep(backoff);
        }
        const session = await initTESSession();
        sessionCookies = session.cookies;
        sessionFields = session.fields;
        sessionOk = true;
        break;
      } catch (err) {
        console.error(`  Session attempt ${attempt + 1} failed: ${(err as Error).message}`);
      }
    }
    if (!sessionOk) {
      console.log(`  All session attempts failed. Skipping ${cc.name}.`);
      continue;
    }

    try {
      const result = await scrapeCC(cc, sessionCookies, sessionFields);
      allMappings.push(...result.mappings);
      console.log(`  ${cc.slug}: ${result.mappings.length} mappings`);
    } catch (err) {
      console.error(`  Error scraping ${cc.name}: ${(err as Error).message}`);
    }

    // Wait between CCs to avoid rate limiting
    if (i < colleges.length - 1) {
      console.log("  Waiting 8s before next CC...");
      await sleep(8000);
    }
  }

  // Deduplicate
  const deduped = new Map<string, TransferMapping>();
  for (const m of allMappings) {
    const key = `${m.cc_course}|${m.university}|${m.univ_course}|${m.notes}`;
    deduped.set(key, m);
  }
  const finalMappings = [...deduped.values()];

  // Stats
  const direct = finalMappings.filter((m) => !m.no_credit && !m.is_elective);
  const elective = finalMappings.filter((m) => m.is_elective);
  const noCredit = finalMappings.filter((m) => m.no_credit);

  console.log(`\n${"=".repeat(60)}`);
  console.log("Summary:");
  console.log(`  Total: ${finalMappings.length} (deduped from ${allMappings.length})`);
  console.log(`  Direct: ${direct.length} (${((direct.length / finalMappings.length) * 100).toFixed(1)}%)`);
  console.log(`  Elective: ${elective.length} (${((elective.length / finalMappings.length) * 100).toFixed(1)}%)`);
  console.log(`  No credit: ${noCredit.length} (${((noCredit.length / finalMappings.length) * 100).toFixed(1)}%)`);

  // Per-CC breakdown
  const byCC = new Map<string, number>();
  for (const m of finalMappings) {
    const ccNote = m.notes.match(/\[([^\]]+)\]/);
    const slug = ccNote ? ccNote[1] : "unknown";
    byCC.set(slug, (byCC.get(slug) || 0) + 1);
  }
  console.log("\n  Per-CC:");
  for (const [slug, count] of [...byCC.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${slug}: ${count}`);
  }

  if (finalMappings.length === 0) {
    console.log("\nNo mappings found. TES may have changed its structure.");
    process.exit(1);
  }

  // Spot checks
  const eng101 = finalMappings.find(
    (m) => m.cc_prefix === "ENG" && m.cc_number === "101" && !m.no_credit
  );
  if (eng101) {
    console.log(
      `\n  Spot check — ENG 101 → Pitt: ${eng101.univ_course} (${eng101.univ_title})`
    );
  }

  // Save — merge with existing PA data (preserve non-Pitt entries)
  const outPath = path.join(process.cwd(), "data", "pa", "transfer-equiv.json");

  let existing: TransferMapping[] = [];
  try {
    const raw = fs.readFileSync(outPath, "utf-8");
    existing = JSON.parse(raw) as TransferMapping[];
    console.log(`\nLoaded ${existing.length} existing PA mappings`);
  } catch {
    // Fresh start
  }

  const preserved = existing.filter((m) => m.university !== UNIVERSITY_SLUG);
  const merged = [...preserved, ...finalMappings];
  console.log(
    `Merged: ${preserved.length} preserved + ${finalMappings.length} new = ${merged.length} total`
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(`Saved to ${outPath}`);

  // Import to Supabase
  if (!noImport) {
    try {
      const imported = await importTransfersToSupabase("pa");
      if (imported > 0) {
        console.log(`Imported ${imported} rows to Supabase`);
      }
    } catch (err) {
      console.log(`Supabase import skipped: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
