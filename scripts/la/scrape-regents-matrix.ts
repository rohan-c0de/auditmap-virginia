/**
 * scrape-regents-matrix.ts (LA)
 *
 * Parses the Louisiana Board of Regents' "Final Approved Master Course
 * Articulation Matrix AY 2021-2022" — an Excel sheet that maps a statewide
 * "common course code" to the local-equivalent course code at every public
 * Louisiana higher-ed institution (11 LCTCS community/technical colleges
 * and ~14 four-year universities in the LSU, UL, SU systems plus LAICU
 * privates).
 *
 * Source: https://www.laregents.edu/matrix-archive/ — 2021-22 is the most
 * recent "Final Approved" version (the Regents have not yet published a
 * 22-23 or 23-24 final). The sheet has not changed structure for years,
 * so a future re-scrape can swap the URL constant.
 *
 * For each row × (sender × receiver) cell, emits one transfer-equiv entry:
 *   sender_cc.course → receiver_university.course
 *
 * Excluded:
 *   - Empty/blank cells
 *   - Sender placeholder "***" (e.g. "ACCT ***" = "course exists but no
 *     specific code assigned"; not a real equivalency)
 *   - LAICU private schools (Tulane, Loyola, etc.) — out of project scope
 *     (we only model public-system transfers per project conventions).
 *
 * Run:
 *   npx tsx scripts/la/scrape-regents-matrix.ts
 *
 * Writes: data/la/transfer-equiv.json (overwrites; idempotent).
 */

import * as fs from "fs";
import * as path from "path";
import XLSX from "xlsx";

const MATRIX_URL =
  "https://www.laregents.edu/wp-content/uploads/2021/11/Final-Approved-Articulation-Matrix-AY-2021-2022.xlsx";

// LCTCS sender slugs (institutions.json) keyed by their column header in the
// matrix. Matches all 11 colleges on the shared LCTCS Banner SSB host
// (Northshore = NTCC is included here as it does appear in the matrix even
// though it has no public section data — articulation still applies to
// students transferring out).
const SENDERS: Record<string, string> = {
  BPCC: "bossier-parish-community-college",
  BRCC: "baton-rouge-community-college",
  CLTCC: "central-louisiana-technical-community-college",
  DCC: "delgado-community-college",
  FTCC: "fletcher-technical-community-college",
  "LDCC ": "louisiana-delta-community-college", // header has trailing space
  NUNEZ: "nunez-community-college",
  NTCC: "northshore-technical-community-college",
  RPCC: "river-parishes-community-college",
  SLCC: "south-louisiana-community-college",
  SOWELA: "sowela-technical-community-college",
};

// Public-system receivers (LSU + UL + SU). LAICU privates excluded.
// Values are the receiver's URL slug used elsewhere in the data layer
// + a human-readable name.
const RECEIVERS: Record<string, { slug: string; name: string }> = {
  "LSU A&M": { slug: "lsu-baton-rouge", name: "LSU (Baton Rouge)" },
  LSUA: { slug: "lsu-alexandria", name: "LSU Alexandria" },
  LSUE: { slug: "lsu-eunice", name: "LSU Eunice" },
  LSUS: { slug: "lsu-shreveport", name: "LSU Shreveport" },
  GSU: { slug: "grambling-state", name: "Grambling State University" },
  "LA Tech": { slug: "louisiana-tech", name: "Louisiana Tech University" },
  McNeese: { slug: "mcneese-state", name: "McNeese State University" },
  Nicholls: { slug: "nicholls-state", name: "Nicholls State University" },
  NSU: { slug: "northwestern-state", name: "Northwestern State University" },
  SLU: { slug: "southeastern-louisiana", name: "Southeastern Louisiana University" },
  ULL: { slug: "ul-lafayette", name: "University of Louisiana at Lafayette" },
  ULM: { slug: "ul-monroe", name: "University of Louisiana at Monroe" },
  UNO: { slug: "new-orleans", name: "University of New Orleans" },
  "SU A&M": { slug: "southern-baton-rouge", name: "Southern University (Baton Rouge)" },
  SUNO: { slug: "southern-new-orleans", name: "Southern University at New Orleans" },
  SUSLA: { slug: "southern-shreveport", name: "Southern University at Shreveport" },
};

interface TransferEntry {
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
  /** LCTCS slug of the sending CC. Distinguishes which CC the mapping is from. */
  sender_slug: string;
}

function isPlaceholder(code: string): boolean {
  // "*** " / "ACCT ***" — Regents convention for "no equivalent assigned"
  return /\*\*\*/.test(code);
}

function splitCourse(raw: string): { prefix: string; number: string } | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\s+/g, " ");
  // Match "PREFIX NUMBER" with optional decimals/letters: "ENGL 1010", "ACCT 2102 or 2103"
  // For "or" forms, take the first code.
  const orMatch = cleaned.match(/^([A-Z]+)\s+(\d+[A-Z]?)/);
  if (orMatch) return { prefix: orMatch[1], number: orMatch[2] };
  return null;
}

async function main() {
  // Fetch
  const localXlsx = "/tmp/la-matrix.xlsx";
  if (!fs.existsSync(localXlsx)) {
    console.log(`Downloading matrix from ${MATRIX_URL}...`);
    const r = await fetch(MATRIX_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) throw new Error(`Matrix download failed: ${r.status}`);
    fs.writeFileSync(localXlsx, Buffer.from(await r.arrayBuffer()));
  }

  const wb = XLSX.read(fs.readFileSync(localXlsx));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Header row is row 2 (0-indexed). Build column → key map.
  const headerRow = rows[2] as string[];
  const colToSender: Record<number, string> = {};
  const colToReceiver: Record<number, { slug: string; name: string }> = {};
  for (let c = 0; c < headerRow.length; c++) {
    const h = headerRow[c];
    if (typeof h !== "string") continue;
    if (SENDERS[h]) colToSender[c] = SENDERS[h];
    if (RECEIVERS[h]) colToReceiver[c] = RECEIVERS[h];
  }

  console.log(
    `Senders detected: ${Object.values(colToSender).length} / ${Object.keys(SENDERS).length}`
  );
  console.log(
    `Receivers detected: ${Object.values(colToReceiver).length} / ${Object.keys(RECEIVERS).length}`
  );

  const entries: TransferEntry[] = [];
  let currentSubject = "";

  for (let r = 3; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[0]) continue;
    const a = String(row[0]).trim();
    // Subject section header (e.g. "Accounting") — only col 0 populated
    if (row.filter((v) => v != null && String(v).trim() !== "").length === 1) {
      currentSubject = a;
      continue;
    }

    const ccTitle = row[1] ? String(row[1]).trim() : "";

    for (const [scol, senderSlug] of Object.entries(colToSender)) {
      const senderCell = row[Number(scol)];
      if (!senderCell) continue;
      const senderCourse = String(senderCell).trim();
      if (!senderCourse || isPlaceholder(senderCourse)) continue;
      const senderParts = splitCourse(senderCourse);
      if (!senderParts) continue;

      for (const [rcol, recv] of Object.entries(colToReceiver)) {
        const receiverCell = row[Number(rcol)];
        if (!receiverCell) continue;
        const receiverCourse = String(receiverCell).trim();
        if (!receiverCourse || isPlaceholder(receiverCourse)) continue;
        const recvParts = splitCourse(receiverCourse);
        if (!recvParts) continue;

        entries.push({
          state: "la",
          cc_prefix: senderParts.prefix,
          cc_number: senderParts.number,
          cc_course: `${senderParts.prefix} ${senderParts.number}`,
          cc_title: ccTitle,
          cc_credits: "",
          university: recv.slug,
          university_name: recv.name,
          univ_course: `${recvParts.prefix} ${recvParts.number}`,
          univ_title: ccTitle, // statewide common title applies to both sides
          univ_credits: "",
          notes: currentSubject ? `Subject: ${currentSubject}` : "",
          no_credit: false,
          is_elective: false,
          sender_slug: senderSlug,
        });
      }
    }
  }

  const outPath = path.join(process.cwd(), "data", "la", "transfer-equiv.json");
  fs.writeFileSync(outPath, JSON.stringify(entries, null, 2));
  console.log(`\n✓ Wrote ${entries.length} transfer-equiv entries → ${outPath}`);

  // Quick breakdown
  const bySender: Record<string, number> = {};
  const byReceiver: Record<string, number> = {};
  for (const e of entries) {
    bySender[e.sender_slug] = (bySender[e.sender_slug] || 0) + 1;
    byReceiver[e.university] = (byReceiver[e.university] || 0) + 1;
  }
  console.log("\nBy sender:");
  for (const [s, n] of Object.entries(bySender).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${n}`);
  }
  console.log("\nBy receiver:");
  for (const [s, n] of Object.entries(byReceiver).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${n}`);
  }
}

main().catch((e) => {
  console.error("❌ LA Regents matrix scrape failed:", e);
  process.exit(1);
});
