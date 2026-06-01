/**
 * scrape-transfer.ts — Nebraska transfer equivalencies (→ UNL).
 *
 * Nebraska has no in-state data in CollegeTransfer.Net and the statewide
 * "Transfer Nebraska" portal funnels into the login-gated Transferology.
 * The University of Nebraska-Lincoln, however, publishes a fully public
 * Transfer Course Equivalency tool (ASP.NET WebForms) that lists every
 * sending institution's course-to-course equivalencies:
 *
 *   https://admissions.unl.edu/nebraska/equivalency/
 *
 * All 9 Nebraska community colleges appear as sending institutions. We POST
 * the institution id back to the page and parse the results table:
 *   [ sender code | sender title | UNL code | credits | UNL title | ACE req ]
 *
 * COVERAGE NOTE: UNL is the only University of Nebraska campus with a public
 * course-to-course tool (UNO/UNK use CollegeSource TES public views, a
 * possible follow-up). Receiving institution is labeled precisely as
 * "University of Nebraska-Lincoln".
 *
 * Usage:
 *   npx tsx scripts/ne/scrape-transfer.ts
 *   npx tsx scripts/ne/scrape-transfer.ts --no-import
 */

import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";
import { importTransfersToSupabase } from "../lib/supabase-import.js";

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

const URL = "https://admissions.unl.edu/nebraska/equivalency/";
const UNL_SLUG = "university-of-nebraska-lincoln";
const UNL_NAME = "University of Nebraska-Lincoln";
const UA = "Mozilla/5.0 (compatible; cc-coursemap)";

// Sending NE community colleges → UNL ddlInstitutions option value.
const COLLEGES: { slug: string; name: string; id: string }[] = [
  { slug: "central-community-college", name: "Central Community College", id: "32678" },
  { slug: "metropolitan-community-college-area", name: "Metropolitan Community College", id: "32634" },
  { slug: "mid-plains-community-college", name: "Mid-Plains Community College", id: "38008" },
  { slug: "northeast-community-college", name: "Northeast Community College", id: "32641" },
  { slug: "southeast-community-college-area", name: "Southeast Community College", id: "16046" },
  { slug: "western-nebraska-community-college", name: "Western Nebraska Community College", id: "32697" },
  { slug: "nebraska-college-of-technical-agriculture", name: "Nebraska College of Technical Agriculture", id: "16243" },
  { slug: "nebraska-indian-community-college", name: "Nebraska Indian Community College", id: "16115" },
  { slug: "little-priest-tribal-college", name: "Little Priest Tribal College", id: "32633" },
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clean(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCode(code: string): { prefix: string; number: string } {
  const m = code.trim().match(/^([A-Za-z]+)\s*([0-9][0-9A-Za-z]*)$/);
  if (m) return { prefix: m[1].toUpperCase(), number: m[2] };
  return { prefix: code.trim().toUpperCase(), number: "" };
}

function hidden($: cheerio.CheerioAPI, name: string): string {
  return $(`input[name="${name}"]`).attr("value") || "";
}

async function scrapeCollege(
  cc: { slug: string; name: string; id: string },
): Promise<TransferMapping[]> {
  // 1) GET a fresh page to read the ASP.NET hidden tokens.
  const getResp = await fetch(URL, { headers: { "User-Agent": UA } });
  if (!getResp.ok) throw new Error(`GET HTTP ${getResp.status}`);
  const $get = cheerio.load(await getResp.text());

  const form = new URLSearchParams();
  form.set("__VIEWSTATE", hidden($get, "__VIEWSTATE"));
  form.set("__VIEWSTATEGENERATOR", hidden($get, "__VIEWSTATEGENERATOR"));
  const ev = hidden($get, "__EVENTVALIDATION");
  if (ev) form.set("__EVENTVALIDATION", ev);
  form.set("ctl00$bP$teq$ddlInstitutions", cc.id);
  form.set("ctl00$bP$teq$cmdChooseInstitution", "Choose this Institution");

  // 2) POST the institution selection; parse the returned results table.
  let html = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(URL, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (resp.status === 429 || resp.status >= 500) {
      await sleep((attempt + 1) * 2000);
      continue;
    }
    if (!resp.ok) throw new Error(`POST HTTP ${resp.status}`);
    html = await resp.text();
    break;
  }

  const $ = cheerio.load(html);
  const out: TransferMapping[] = [];
  const seen = new Set<string>();

  $("tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => clean($(td).text()))
      .get();
    if (cells.length < 5) return;

    const senderCode = cells[0];
    const senderTitle = cells[1];
    const unlCode = cells[2];
    const credit = cells[3];
    const unlTitle = cells[4];
    const ace = cells[5] || "";

    // Skip header and catch-all rows (sender with no course number, e.g.
    // "ACCT / Other Acct Courses").
    if (!senderCode || /^id$/i.test(senderCode)) return;
    const { prefix: ccPrefix, number: ccNumber } = splitCode(senderCode);
    if (!ccNumber) return;
    if (!unlCode || !unlTitle) return;

    // UNL elective/general markers: codes containing * or @, or titles naming
    // elective / general credit. Strip the marker tail for display.
    const isElective =
      /[*@]/.test(unlCode) || /\b(elective|general)\b/i.test(unlTitle);
    const univCourse = clean(unlCode.replace(/[*@].*$/, ""));

    const noteParts = [`[${cc.slug}]`];
    if (ace && ace !== " ") noteParts.push(`UNL ACE: ${ace}`);

    const mapping: TransferMapping = {
      state: "ne",
      cc_prefix: ccPrefix,
      cc_number: ccNumber,
      cc_course: `${ccPrefix} ${ccNumber}`,
      cc_title: senderTitle,
      cc_credits: "",
      university: UNL_SLUG,
      university_name: UNL_NAME,
      univ_course: univCourse,
      univ_title: unlTitle,
      univ_credits: /^\d/.test(credit) ? credit : "",
      notes: noteParts.join(" "),
      no_credit: false,
      is_elective: isElective,
    };

    const key = `${mapping.cc_course}|${mapping.univ_course}|${mapping.univ_title}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(mapping);
  });

  console.log(
    `  ${cc.slug.padEnd(42)} ${out.length} mappings ` +
      `(direct=${out.filter((m) => !m.is_elective).length}, elective=${out.filter((m) => m.is_elective).length})`,
  );
  return out;
}

async function main() {
  const skipImport = process.argv.includes("--no-import");
  console.log("UNL Transfer Equivalency — Nebraska Scraper\n");

  const successful = new Set<string>();
  const all: TransferMapping[] = [];
  for (const cc of COLLEGES) {
    try {
      const mappings = await scrapeCollege(cc);
      all.push(...mappings);
      successful.add(cc.slug);
    } catch (err) {
      console.error(`  ${cc.slug}: FAILED — ${(err as Error).message}`);
    }
    await sleep(500);
  }

  console.log("\n=== Summary ===");
  console.log(`  Colleges scraped: ${successful.size}/${COLLEGES.length}`);
  console.log(`  Total mappings: ${all.length}`);
  console.log(
    `    direct=${all.filter((m) => !m.is_elective).length} elective=${all.filter((m) => m.is_elective).length}`,
  );

  if (successful.size === 0) {
    console.warn("\n  WARN: no colleges scraped; leaving existing data untouched.");
    return;
  }

  const outPath = path.join(process.cwd(), "data", "ne", "transfer-equiv.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2) + "\n");
  console.log(`\nSaved ${all.length} mappings → ${outPath}`);

  if (!skipImport) {
    try {
      const imported = await importTransfersToSupabase("ne");
      if (imported > 0) console.log(`Imported ${imported} rows to Supabase`);
    } catch (err) {
      console.error(`Supabase import failed: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
