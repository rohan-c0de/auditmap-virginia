/**
 * scrape-transfer-core42.ts (MO)
 *
 * Builds Missouri's statewide CC→4-year transfer-equivalency dataset from the
 * Missouri Department of Higher Education & Workforce Development (MDHEWD)
 * CORE 42 course database — a single public Excel file that maps every public
 * institution's local course to a shared statewide MOTR course number.
 *
 * Source: https://dhewd.mo.gov/core42.php  (per-academic-year .xlsx files on a
 * Drupal gov site, no login, no CAPTCHA). The direct-binary path pattern
 * `/sites/g/files/zuston351/...` serves the file (the newer "media/file"
 * short links return an HTML landing page, so we hardcode the resolved
 * binary URL and a future re-scrape swaps the constant).
 *
 * Sheet "All IHE Courses": one row per (institution × MOTR course). Columns:
 *   0 MOTR COURSE NUMBER  3 TRANSFER CREDITS  7 INSTITUTION
 *   8 IHE COURSE NAME (title)  9 IHE COURSE NUMBER (local code)
 *
 * The equivalency model (same as NM CCNS):
 *   CORE 42 guarantees that any two MO public institutions whose courses map
 *   to the same MOTR number are transfer-equivalent. For each MOTR number we
 *   group the rows, then emit one CC→university pair for every (community-
 *   college sender × public-university receiver) combination, using each
 *   side's local IHE course number.
 *
 * Coverage note: CORE 42 is the statewide GENERAL-EDUCATION transfer core —
 * ~188 MOTR courses (composition, math, sciences, social sciences, humanities,
 * etc.). It does NOT cover major-specific equivalencies. This is the high-value
 * gen-ed backbone, not the full catalog.
 *
 * Sender / receiver classification (by exact INSTITUTION name):
 *   - RECEIVERS = the 13 public universities.
 *   - EXCLUDED  = the 6 private universities in the file (Avila, Central
 *     Methodist, Lindenwood, Logan, Missouri Baptist, Rockhurst) — the project
 *     models public-system transfers only.
 *   - SENDERS   = every remaining public institution (the 12 community
 *     colleges, State Technical College, and the 2-year MSU-West Plains
 *     campus).
 * All in-state by construction.
 *
 * Run:
 *   npx tsx scripts/mo/scrape-transfer-core42.ts
 * Writes: data/mo/transfer-equiv.json (overwrites; idempotent).
 * Then: npx tsx scripts/build-transfer-universities-cache.ts --state mo
 */

import * as fs from "fs";
import * as path from "path";
import XLSX from "xlsx";

const SOURCE_URL =
  "https://dhewd.mo.gov/sites/g/files/zuston351/files/media/file/2024/03/CorrectedPOSTAY2023-2024Database.xlsx";
const OUT_PATH = path.join(process.cwd(), "data", "mo", "transfer-equiv.json");
const LOCAL_XLSX = "/tmp/mo-core42.xlsx";

/** 13 MO public universities that receive transfers (exact INSTITUTION name). */
const RECEIVERS: Record<string, { slug: string; name: string }> = {
  "University of Missouri-Columbia": { slug: "mizzou", name: "University of Missouri" },
  "University of Missouri-Kansas City": { slug: "umkc", name: "University of Missouri–Kansas City" },
  "University of Missouri-St. Louis": { slug: "umsl", name: "University of Missouri–St. Louis" },
  "Missouri University of Science & Technology": { slug: "missouri-st", name: "Missouri University of Science & Technology" },
  "Missouri State University": { slug: "missouri-state", name: "Missouri State University" },
  "Missouri Western State University": { slug: "missouri-western", name: "Missouri Western State University" },
  "Missouri Southern State University": { slug: "missouri-southern", name: "Missouri Southern State University" },
  "Southeast Missouri State University": { slug: "semo", name: "Southeast Missouri State University" },
  "Northwest Missouri State University": { slug: "northwest-missouri", name: "Northwest Missouri State University" },
  "University of Central Missouri": { slug: "ucm", name: "University of Central Missouri" },
  "Truman State University": { slug: "truman", name: "Truman State University" },
  "Truman state University": { slug: "truman", name: "Truman State University" }, // data typo dup
  "Lincoln University": { slug: "lincoln", name: "Lincoln University" },
  "Harris-Stowe State University": { slug: "harris-stowe", name: "Harris-Stowe State University" },
};

/** Private universities present in the file — excluded (public-system only). */
const EXCLUDED = new Set<string>([
  "Avila University",
  "Central Methodist University",
  "Lindenwood University",
  "Logan University",
  "Missouri Baptist University",
  "Rockhurst University",
]);

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
}

/** Split a local course code "ANT 111" / "ANTH 0101" / "S/A 202" into prefix+number. */
function splitCourse(raw: string): { prefix: string; number: string } | null {
  if (!raw) return null;
  const cleaned = String(raw).trim().replace(/\s+/g, " ");
  const m = cleaned.match(/^([A-Za-z][A-Za-z/&]{0,5})\s*[- ]?\s*(\d{2,4}[A-Za-z]?)\b/);
  if (!m) return null;
  // Keep mid-token separators ("S/A", "SP&MS") but drop a dangling trailing
  // one ("MSC/" → "MSC") from codes like "MSC/ 1011".
  const prefix = m[1].toUpperCase().replace(/[/&]+$/, "");
  return { prefix, number: m[2].toUpperCase() };
}

async function main() {
  if (!fs.existsSync(LOCAL_XLSX)) {
    console.log(`Downloading CORE 42 database from ${SOURCE_URL}…`);
    const r = await fetch(SOURCE_URL, { headers: { "User-Agent": "Mozilla/5.0 cc-coursemap-scraper" } });
    if (!r.ok) throw new Error(`Download failed: HTTP ${r.status}`);
    fs.writeFileSync(LOCAL_XLSX, Buffer.from(await r.arrayBuffer()));
  }

  const wb = XLSX.read(fs.readFileSync(LOCAL_XLSX));
  const sheet = wb.Sheets["All IHE Courses"];
  if (!sheet) throw new Error(`Sheet "All IHE Courses" not found. Sheets: ${wb.SheetNames.join(", ")}`);
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Header is row index 1; data starts at row index 2.
  interface Row { motr: string; credits: string; inst: string; title: string; code: string; }
  const data: Row[] = [];
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0] || !r[7] || !r[9]) continue;
    data.push({
      motr: String(r[0]).trim(),
      credits: r[3] != null ? String(r[3]).trim() : "",
      inst: String(r[7]).trim(),
      title: r[8] != null ? String(r[8]).trim() : "",
      code: String(r[9]).trim(),
    });
  }

  // Group by MOTR number.
  const groups = new Map<string, Row[]>();
  for (const row of data) {
    let g = groups.get(row.motr);
    if (!g) groups.set(row.motr, (g = []));
    g.push(row);
  }

  const entries: TransferEntry[] = [];
  const seen = new Set<string>();
  let groupsWithBothSides = 0;

  for (const [motr, group] of groups) {
    const senders = group.filter((r) => !RECEIVERS[r.inst] && !EXCLUDED.has(r.inst));
    const receivers = group.filter((r) => RECEIVERS[r.inst]);
    if (senders.length === 0 || receivers.length === 0) continue;
    groupsWithBothSides++;

    for (const s of senders) {
      const sp = splitCourse(s.code);
      if (!sp) continue;
      for (const r of receivers) {
        const rp = splitCourse(r.code);
        if (!rp) continue;
        const recv = RECEIVERS[r.inst];
        const ccCourse = `${sp.prefix} ${sp.number}`;
        const univCourse = `${rp.prefix} ${rp.number}`;
        const dedup = `${ccCourse}|${recv.slug}|${univCourse}`;
        if (seen.has(dedup)) continue;
        seen.add(dedup);
        entries.push({
          state: "mo",
          cc_prefix: sp.prefix,
          cc_number: sp.number,
          cc_course: ccCourse,
          cc_title: s.title,
          cc_credits: s.credits,
          university: recv.slug,
          university_name: recv.name,
          univ_course: univCourse,
          univ_title: r.title,
          univ_credits: r.credits,
          notes: `Missouri CORE 42 transfer guarantee (${motr})`,
          no_credit: false,
          is_elective: false,
        });
      }
    }
  }

  entries.sort(
    (a, b) =>
      a.cc_prefix.localeCompare(b.cc_prefix) ||
      a.cc_number.localeCompare(b.cc_number) ||
      a.university.localeCompare(b.university) ||
      a.univ_course.localeCompare(b.univ_course)
  );

  fs.writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2));
  console.log(`\n✓ Wrote ${entries.length} transfer-equiv entries → ${OUT_PATH}`);
  console.log(`  MOTR groups: ${groups.size} (${groupsWithBothSides} had both CC + university sides)`);

  const byReceiver: Record<string, number> = {};
  for (const e of entries) byReceiver[e.university] = (byReceiver[e.university] || 0) + 1;
  console.log("\nBy receiving university:");
  for (const [s, n] of Object.entries(byReceiver).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${n}`);
  }
}

main().catch((e) => {
  console.error("❌ MO CORE 42 transfer scrape failed:", e);
  process.exit(1);
});
