/**
 * scrape-apsu.ts
 *
 * Scrapes Austin Peay State University's public transfer equivalency tool
 * to extract CC → APSU mappings for all 13 TBR community colleges.
 *
 * APSU uses an Evisions MAPS report server that generates PDFs. The flow:
 *   1. GET cascading dropdown data from banwssprod.apsu.edu/prod/bysktran.*
 *      endpoints to discover institution codes (same Banner IDs as UTK/MTSU)
 *   2. POST to apbrarg2.apsu.edu/mrr with report token + institution code
 *   3. Follow 302 redirect with session cookie → download PDF
 *   4. Parse PDF via `pdftotext -layout` (poppler) into a 4-column table
 *
 * Requires: `pdftotext` CLI (from poppler-utils / poppler via Homebrew).
 *
 * Usage:
 *   npx tsx scripts/tn/transfer/scrape-apsu.ts
 *   npx tsx scripts/tn/transfer/scrape-apsu.ts --no-import
 *   npx tsx scripts/tn/transfer/scrape-apsu.ts --inst=000319
 */

// APSU's Banner server has an expired/self-signed TLS cert. Disable
// verification for this scraper only (same pattern as scrape-banner-ssb.ts).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { importTransfersToSupabase } from "../../lib/supabase-import";

const REPORT_URL = "https://apbrarg2.apsu.edu/mrr";
const REPORT_TOKEN =
  "X2SNLQK4HI5GIVI3ISPNXQW5K5PJOZUQWGM3TBWM2HRZQKQN3DL3GTF4VZOXKSM7PK3ZK4F6RZ56W";
const DROPDOWN_BASE = "https://banwssprod.apsu.edu/prod/bysktran";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Same 13 TBR CC codes.
const TBR_COLLEGES: Record<string, string> = {
  "000319": "Pellissippi State Community College",
  "001084": "Chattanooga State Community College",
  "002848": "Cleveland State Community College",
  "001081": "Columbia State Community College",
  "007323": "Dyersburg State Community College",
  "002266": "Jackson State Community College",
  "001543": "Motlow State Community College",
  "000850": "Nashville State Community College",
  "000453": "Northeast State Community College",
  "001656": "Roane State Community College",
  "000274": "Southwest Tennessee Community College",
  "001881": "Volunteer State Community College",
  "001893": "Walters State Community College",
};

const DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TransferMapping {
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

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Fetch the institution list from APSU's AJAX dropdown endpoint.
 * Returns raw HTML <option> elements that we parse for codes and names.
 */
async function fetchInstitutions(): Promise<
  Array<{ code: string; name: string }>
> {
  const res = await fetch(
    `${DROPDOWN_BASE}.get_insts?stat_code=TN`,
    { headers: { "User-Agent": UA } },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} from get_insts`);
  const html = await res.text();

  const institutions: Array<{ code: string; name: string }> = [];
  // APSU's dropdown uses unquoted values: <option value=007318>Name</option>
  const regex = /<option\s+value=["']?([^"'>\s]+)["']?[^>]*>([^<]+)<\/option>/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const code = m[1].trim();
    const name = m[2].trim();
    if (code && code !== "" && code !== "ALL") {
      institutions.push({ code, name });
    }
  }
  return institutions;
}

/**
 * Download the APSU equivalency PDF for a given institution.
 *
 * 1. POST to the Evisions MAPS server with report token + params
 * 2. Capture the 302 redirect URL and session cookie
 * 3. Fetch the PDF from the redirect URL with the cookie
 * 4. Return the PDF buffer
 */
async function downloadEquivalencyPdf(
  instCode: string,
): Promise<Buffer | null> {
  // parm_subj and parm_crse MUST be "ALL" — empty strings cause HTTP 500
  // from the Evisions MAPS server.
  const body = new URLSearchParams({
    Report: REPORT_TOKEN,
    reportFormat: "PDF",
    parm_stat: "TN",
    parm_inst: instCode,
    parm_subj: "ALL",
    parm_crse: "ALL",
  });

  // Step 1: POST with redirect: manual to capture 302
  const postRes = await fetch(REPORT_URL, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    redirect: "manual",
  });

  if (postRes.status !== 302) {
    console.error(`    Unexpected status ${postRes.status} (expected 302)`);
    return null;
  }

  // Extract redirect URL and session cookie
  const redirectUrl = postRes.headers.get("location");
  const setCookie = postRes.headers.get("set-cookie") || "";
  const sessionMatch = setCookie.match(
    /Evisions\.MAPS\.Session\.Id=([^;]+)/,
  );

  if (!redirectUrl) {
    console.error(`    No redirect URL in 302 response`);
    return null;
  }

  // Build absolute URL if relative
  const pdfUrl = redirectUrl.startsWith("http")
    ? redirectUrl
    : `https://apbrarg2.apsu.edu${redirectUrl}`;

  // Step 2: Fetch the PDF with session cookie
  const cookieHeader = sessionMatch
    ? `Evisions.MAPS.Session.Id=${sessionMatch[1]}`
    : "";

  const pdfRes = await fetch(pdfUrl, {
    headers: {
      "User-Agent": UA,
      Cookie: cookieHeader,
    },
  });

  if (!pdfRes.ok) {
    console.error(`    PDF fetch failed: HTTP ${pdfRes.status}`);
    return null;
  }

  const arrayBuf = await pdfRes.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Parse the text output of `pdftotext -layout` into TransferMappings.
 *
 * The PDF has a 4-column layout:
 *   Transfer Course    Transfer Course Title    APSU Course    APSU Course Title
 *   ACCT 1010          Principles of Acct I     ACCT 2010      Principles of Acct I
 *
 * Lines that look like page headers, footers, or blank lines are skipped.
 * The columns are position-aligned; we use the first data row to detect
 * column boundaries, then parse each subsequent line using those boundaries.
 */
function parsePdfText(text: string): TransferMapping[] {
  const mappings: TransferMapping[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    // Skip blank lines, headers, footers, page numbers
    if (!line.trim()) continue;
    if (/^\s*Transfer Course\s/i.test(line)) continue; // header row
    if (/^\s*Page\s+\d/i.test(line)) continue;
    if (/^\s*Austin Peay/i.test(line)) continue;
    if (/^\s*Transfer Equivalency/i.test(line)) continue;
    if (/^\s*Report Date/i.test(line)) continue;
    if (/^\s*State:/i.test(line)) continue;
    if (/^\s*Institution:/i.test(line)) continue;
    if (/^\f/.test(line)) continue; // form feed

    // Try to match a line with a CC course code at the start
    // The layout looks like:
    //   ACCT 1010          Principles of Acct I     ACCT 2010      Principles of Acct I
    // We use a regex to capture the 4 columns, relying on the fact that
    // course codes follow a PREFIX NUMBER pattern with significant spacing.
    const m = line.match(
      /^\s*([A-Z]{2,5}\s+\d{3,4}[A-Z]?)\s{2,}(.+?)\s{2,}([A-Z]{2,5}\s+\S+)\s{2,}(.+?)\s*$/,
    );
    if (!m) {
      // Try 3-column match (some lines have no APSU title)
      const m3 = line.match(
        /^\s*([A-Z]{2,5}\s+\d{3,4}[A-Z]?)\s{2,}(.+?)\s{2,}([A-Z]{2,5}\s+\S+)\s*$/,
      );
      if (m3) {
        const ccCourse = m3[1].trim();
        const ccTitle = m3[2].trim();
        const apsuCourse = m3[3].trim();
        addMapping(mappings, ccCourse, ccTitle, apsuCourse, "");
      }
      continue;
    }

    const ccCourse = m[1].trim();
    const ccTitle = m[2].trim();
    const apsuCourse = m[3].trim();
    const apsuTitle = m[4].trim();

    addMapping(mappings, ccCourse, ccTitle, apsuCourse, apsuTitle);
  }

  return mappings;
}

function addMapping(
  mappings: TransferMapping[],
  ccCourse: string,
  ccTitle: string,
  apsuCourse: string,
  apsuTitle: string,
): void {
  const ccMatch = ccCourse.match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)$/);
  if (!ccMatch) return;

  const noCredit =
    apsuCourse.toUpperCase().includes("NO CREDIT") ||
    apsuCourse.toUpperCase().includes("NOT TRANSFER") ||
    (!apsuCourse && !apsuTitle);

  // APSU uses "EL" for lower elective, "EU" for upper elective
  const isElective =
    /\bEL\b|\bEU\b/i.test(apsuCourse) || /elective/i.test(apsuTitle);

  mappings.push({
    cc_prefix: ccMatch[1],
    cc_number: ccMatch[2],
    cc_course: `${ccMatch[1]} ${ccMatch[2]}`,
    cc_title: ccTitle,
    cc_credits: "",
    university: "apsu",
    university_name: "Austin Peay State University",
    univ_course: noCredit ? "" : apsuCourse,
    univ_title: noCredit ? "No APSU credit" : apsuTitle || apsuCourse,
    univ_credits: "",
    notes: "",
    no_credit: noCredit,
    is_elective: isElective,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Check pdftotext availability
  try {
    execSync("which pdftotext", { stdio: "pipe" });
  } catch {
    console.error(
      "Error: pdftotext not found. Install poppler: brew install poppler",
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const instArg = args.find((a) => a.startsWith("--inst="))?.split("=")[1];
  const noImport = args.includes("--no-import");

  console.log("APSU Transfer Course Equivalency Scraper");
  console.log(`  Source: ${DROPDOWN_BASE}.*\n`);

  // --- Step 1: institution list ---
  console.log("[1/2] Fetching Tennessee institution list...");
  const allInstitutions = await fetchInstitutions();
  console.log(`  Found ${allInstitutions.length} Tennessee institutions`);

  let targets: Array<{ code: string; name: string }>;
  if (instArg) {
    const inst = allInstitutions.find((i) => i.code === instArg);
    targets = inst
      ? [inst]
      : [{ code: instArg, name: TBR_COLLEGES[instArg] || instArg }];
  } else {
    targets = allInstitutions.filter((i) => i.code in TBR_COLLEGES);
    console.log(`  Filtered to ${targets.length} TBR community colleges:`);
    for (const t of targets) {
      console.log(`    ${t.code} — ${t.name}`);
    }
  }

  // --- Step 2: download + parse PDFs ---
  console.log(
    `\n[2/2] Downloading equivalency PDFs for ${targets.length} colleges...`,
  );
  const allMappings: TransferMapping[] = [];
  let totalRows = 0;
  const tmpDir = "/tmp/apsu-transfer-pdfs";
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const inst of targets) {
    console.log(`\n  ${inst.name} (${inst.code})...`);

    const pdfBuf = await downloadEquivalencyPdf(inst.code);
    if (!pdfBuf || pdfBuf.length < 1000) {
      console.log(`    No PDF or empty PDF, skipping`);
      if (targets.length > 1) await sleep(DELAY_MS);
      continue;
    }

    // Write PDF to temp, run pdftotext
    const pdfPath = path.join(tmpDir, `${inst.code}.pdf`);
    const txtPath = path.join(tmpDir, `${inst.code}.txt`);
    fs.writeFileSync(pdfPath, pdfBuf);

    try {
      execSync(`pdftotext -layout "${pdfPath}" "${txtPath}"`, {
        stdio: "pipe",
      });
    } catch (e) {
      console.error(`    pdftotext failed: ${e}`);
      if (targets.length > 1) await sleep(DELAY_MS);
      continue;
    }

    const text = fs.readFileSync(txtPath, "utf-8");
    const mappings = parsePdfText(text);
    console.log(
      `    ${mappings.length} mappings (${(pdfBuf.length / 1024).toFixed(0)} KB PDF)`,
    );
    allMappings.push(...mappings);
    totalRows += mappings.length;

    if (targets.length > 1) await sleep(DELAY_MS);
  }

  console.log(`\n  Total raw mappings: ${totalRows}`);

  // --- Deduplicate ---
  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of allMappings) {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.univ_course}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }
  console.log(`  After dedup: ${deduped.length} unique mappings`);

  // --- Stats ---
  const directEquiv = deduped.filter(
    (m) => !m.no_credit && !m.is_elective,
  ).length;
  const electives = deduped.filter(
    (m) => !m.no_credit && m.is_elective,
  ).length;
  const noCredit = deduped.filter((m) => m.no_credit).length;
  const prefixes = new Set(deduped.map((m) => m.cc_prefix));

  console.log("\nSummary:");
  console.log(`  Direct equivalencies: ${directEquiv}`);
  console.log(`  Elective credit: ${electives}`);
  console.log(`  No credit: ${noCredit}`);
  console.log(`  Subject prefixes: ${prefixes.size}`);

  // Spot checks
  const engl1010 = deduped.find(
    (m) => m.cc_prefix === "ENGL" && m.cc_number === "1010",
  );
  if (engl1010) {
    console.log(
      `\n  Spot check — ENGL 1010: → ${engl1010.univ_course} (${engl1010.univ_title})`,
    );
  }

  // --- Write (merge with existing) ---
  const outDir = path.join(process.cwd(), "data", "tn");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "transfer-equiv.json");

  let existing: TransferMapping[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  } catch {
    /* first run */
  }
  const nonApsu = existing.filter((m) => m.university !== "apsu");
  const merged = [...nonApsu, ...deduped];
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`\n✓ Wrote ${deduped.length} APSU mappings to ${outPath}`);
  console.log(`  Total in file (all universities): ${merged.length}`);

  // --- Supabase import ---
  if (!noImport) {
    await importTransfersToSupabase("tn");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
