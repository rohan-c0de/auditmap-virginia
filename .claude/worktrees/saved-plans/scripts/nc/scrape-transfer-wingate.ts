/**
 * Scrape Wingate University NCCCS Transfer Guide PDF.
 *
 * Source: https://www.wingate.edu/admissions/transfers/transfer-credit-guide
 * PDF: https://resources.finalsite.net/images/v1683722576/wingateedu/odwep1auaovmonmfj8xk/TransferGuide.pdf
 *
 * Format: text-based PDF with columns:
 *   NCCCS Course | NCCCS Course Title | NCCCS designation | WU Course Equivalent | Hours
 *
 * Uses Python/pdfplumber for extraction.
 * Merges mappings into data/nc/transfer-equiv.json.
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-transfer-wingate.ts
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

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

const PDF_URL = "https://resources.finalsite.net/images/v1683722576/wingateedu/odwep1auaovmonmfj8xk/TransferGuide.pdf";

async function main() {
  console.log("Wingate University NCCCS Transfer Guide Scraper\n");

  // Download PDF
  const tmpPdf = "/tmp/wingate-transfer.pdf";
  console.log("Downloading PDF...");
  const res = await fetch(PDF_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmpPdf, buf);
  console.log(`  Downloaded ${(buf.length / 1024).toFixed(0)} KB`);

  // Extract text with pdfplumber — text extraction is cleaner than table extraction for this PDF
  const pyScript = `
import pdfplumber, json
lines = []
with pdfplumber.open("${tmpPdf}") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        if text:
            lines.extend(text.split("\\n"))
print(json.dumps(lines))
`;
  const result = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const allLines: string[] = JSON.parse(result);
  console.log(`Extracted ${allLines.length} lines`);

  // Parse lines — format: "COURSE_CODE TITLE DESIGNATION WU_EQUIV HOURS"
  // Examples:
  //   ACA 122 College Transfer Success AA/AS Required Course GATE 101 1
  //   ACC 120 Prin of Financial Accounting Pre-Major/Elective ACCT253 4
  const coursePattern = /^([A-Z]{2,4})\s+(\d{3}[A-Z]?)\s+(.+)/;

  const mappings: TransferMapping[] = [];
  let skipped = 0;

  for (const line of allLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(coursePattern);
    if (!match) continue;

    const prefix = match[1];
    const number = match[2];
    const rest = match[3];

    // Skip header lines
    if (prefix === "NCCCS" && rest.includes("Course Title")) continue;

    // Parse the rest — need to extract title, designation, WU equiv, hours
    // The hours is the last number, WU equiv is before that, designation is a known set
    // Known designations: "AA/AS Required Course", "Pre-Major/Elective", "UGETC: ...", "GEN ED: ..."

    // Strategy: work backwards from end
    // Hours is last token (a number)
    const parts = rest.split(/\s+/);
    const hoursStr = parts[parts.length - 1];
    const hours = parseInt(hoursStr);
    if (isNaN(hours)) {
      skipped++;
      continue;
    }

    // WU equivalent is the token(s) before hours — typically one code like "ACCT253" or "ART 110"
    // It can be: "GATE 101", "ACCT253", "ACCTELC", "BIOL101/L", "NO CREDIT", etc.
    // Look for the WU course working backwards
    let wuCourse = "";
    let titleAndDesig = "";

    // Check for "NO CREDIT" or "NO EQUIV" patterns
    const noCreditMatch = rest.match(/(.+?)\s+(NO\s+(?:CREDIT|EQUIV)[A-Z]*)\s+(\d+)$/);
    if (noCreditMatch) {
      titleAndDesig = noCreditMatch[1];
      wuCourse = noCreditMatch[2];
    } else {
      // Try pattern: ... WU_CODE HOURS  (WU_CODE is one or two tokens)
      // Two-token WU codes: "ART 110", "GATE 101", "BIO 101", etc.
      const twoTokenMatch = rest.match(/(.+?)\s+([A-Z]{2,8}\s+\d{3}[A-Z]?(?:\/[A-Z])?)\s+(\d+)$/);
      const oneTokenMatch = rest.match(/(.+?)\s+([A-Z]{2,}[A-Z0-9/]*\d*)\s+(\d+)$/);

      if (twoTokenMatch) {
        titleAndDesig = twoTokenMatch[1];
        wuCourse = twoTokenMatch[2];
      } else if (oneTokenMatch) {
        titleAndDesig = oneTokenMatch[1];
        wuCourse = oneTokenMatch[2];
      } else {
        skipped++;
        continue;
      }
    }

    // Split titleAndDesig into title and designation
    // Known designations at the end of the string
    const desigPatterns = [
      /\s+(UGETC:\s*.+?)$/,
      /\s+(GEN\s+ED:\s*.+?)$/,
      /\s+(AA\/AS\s+Required\s+Course)$/,
      /\s+(Pre-Major\/Elective)$/,
      /\s+(General\s+Education.*)$/,
    ];

    let title = titleAndDesig;
    let designation = "";
    for (const dp of desigPatterns) {
      const dm = titleAndDesig.match(dp);
      if (dm) {
        title = titleAndDesig.substring(0, dm.index!).trim();
        designation = dm[1].trim();
        break;
      }
    }

    const isElective = wuCourse.toLowerCase().includes("elec") ||
      designation.toLowerCase().includes("elective");
    const noCredit = wuCourse.toUpperCase().includes("NO CREDIT") ||
      wuCourse.toUpperCase().includes("NO EQUIV");

    mappings.push({
      cc_prefix: prefix,
      cc_number: number,
      cc_course: `${prefix} ${number}`,
      cc_title: title,
      cc_credits: String(hours),
      university: "wingate",
      university_name: "Wingate University",
      univ_course: wuCourse,
      univ_title: "",
      univ_credits: String(hours),
      notes: designation,
      no_credit: noCredit,
      is_elective: isElective,
    });
  }

  console.log(`\nParsed ${mappings.length} mappings (${skipped} skipped)`);

  // Spot check
  const eng111 = mappings.filter(m => m.cc_course === "ENG 111");
  if (eng111.length) {
    console.log(`\n  Spot check — ENG 111:`);
    eng111.forEach(m => console.log(`    ${m.cc_course} → ${m.univ_course} (${m.univ_credits} cr) [${m.notes}]`));
  }

  const mat171 = mappings.filter(m => m.cc_course === "MAT 171");
  if (mat171.length) {
    console.log(`  Spot check — MAT 171:`);
    mat171.forEach(m => console.log(`    ${m.cc_course} → ${m.univ_course} (${m.univ_credits} cr) [${m.notes}]`));
  }

  if (mappings.length === 0) {
    console.log("No mappings found — check PDF format");
    process.exit(1);
  }

  // Merge into transfer-equiv.json
  const equivPath = path.join(process.cwd(), "data", "nc", "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  if (fs.existsSync(equivPath)) {
    existing = JSON.parse(fs.readFileSync(equivPath, "utf-8"));
  }

  const withoutWingate = existing.filter(m => m.university !== "wingate");
  const merged = [...withoutWingate, ...mappings];

  merged.sort((a, b) =>
    a.cc_prefix.localeCompare(b.cc_prefix) ||
    a.cc_number.localeCompare(b.cc_number) ||
    a.university.localeCompare(b.university)
  );

  fs.writeFileSync(equivPath, JSON.stringify(merged, null, 2));
  console.log(`\nSaved ${merged.length} total mappings (${mappings.length} Wingate + ${withoutWingate.length} existing)`);

  fs.unlinkSync(tmpPdf);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
