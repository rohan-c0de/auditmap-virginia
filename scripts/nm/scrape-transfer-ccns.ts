/**
 * scrape-transfer-ccns.ts (NM)
 *
 * Builds New Mexico's statewide CC→4-year transfer-equivalency dataset from
 * the NM Higher Education Department's Common Course Numbering System (CCNS)
 * public JSON API.
 *
 * Source: https://ccns.nmhed.us/  (jQuery/DataTables front-end over a plain
 * REST/JSON backend, same-origin, no login, no CAPTCHA).
 *
 *   GET /allSchools                       → [{schoolCode, schoolName}]   (29 institutions)
 *   GET /allSubjects                      → [{subjectCode, subject}]     (200 subjects)
 *   GET /courses/%20/%20/<SUBJ>%20/*ALL*  → crosswalk rows for a subject
 *
 * Crosswalk row shape (one row per institution × common course):
 *   { NMCCNSSubject, NMCCNSNumber, NMCCNSTitle, SchoolName, SchoolCourseName }
 *
 * The equivalency model:
 *   New Mexico's Post-secondary Education Articulation Act guarantees that
 *   any two NM institutions whose local courses map to the same common
 *   number (NMCCNSSubject + NMCCNSNumber) are transfer-equivalent. So for
 *   each common number we group the rows, then emit one CC→university pair
 *   for every (2-year sender × 4-year receiver) combination, using each
 *   side's LOCAL course code (SchoolCourseName) — e.g. Doña Ana "OATS 120"
 *   → NMSU's local equivalent for common number ACCT 1115.
 *
 * Sender / receiver classification (by exact SchoolName):
 *   - RECEIVERS = the six 4-year public universities students transfer to
 *     (UNM, NMSU, NMHU, ENMU, NM Tech, WNMU). Branch campuses (e.g.
 *     "University of New Mexico: Gallup") are distinct strings and are
 *     treated as 2-year SENDERS, not receivers.
 *   - SENDERS = every other institution (community colleges, the 2-year
 *     branch campuses, Northern NM College, Diné College).
 *   - EXCLUDED = Navajo Technical University and the Institute of American
 *     Indian Arts: mixed 2-/4-year tribal institutions that don't cleanly
 *     fit either bucket. Documented gap — their pathways aren't modeled
 *     rather than risk a wrong classification.
 *
 * All data is in-state by construction (CCNS is an NM-only system), so the
 * project's in-state-only transfer rule is satisfied with no filtering.
 *
 * The UI consumes (cc_prefix, cc_number, university) state-wide and ignores
 * any per-sender field (see lib/transfer.ts), so — like GA — we emit no
 * sender_slug and dedupe on (cc_course, university, univ_course). Two senders
 * that share a local code for the same common number collapse to one row;
 * senders with distinct local codes stay distinct.
 *
 * Run:
 *   npx tsx scripts/nm/scrape-transfer-ccns.ts
 *
 * Writes: data/nm/transfer-equiv.json (overwrites; idempotent).
 * Then refresh data/nm/transfer-universities.json:
 *   npx tsx scripts/build-transfer-universities-cache.ts --state nm
 */

import * as fs from "fs";
import * as path from "path";

const BASE = "https://ccns.nmhed.us";
const OUT_PATH = path.join(process.cwd(), "data", "nm", "transfer-equiv.json");
const THROTTLE_MS = 400;

/** 4-year public universities that receive transfers (keyed by exact SchoolName). */
const RECEIVERS: Record<string, { slug: string; name: string }> = {
  "University of New Mexico": { slug: "unm", name: "University of New Mexico" },
  "New Mexico State University": { slug: "nmsu", name: "New Mexico State University" },
  "New Mexico Highlands University": { slug: "nmhu", name: "New Mexico Highlands University" },
  "Eastern New Mexico University": { slug: "enmu", name: "Eastern New Mexico University" },
  "New Mexico Tech": { slug: "nmt", name: "New Mexico Institute of Mining and Technology" },
  "Western New Mexico University": { slug: "wnmu", name: "Western New Mexico University" },
};

/** Mixed 2-/4-year tribal institutions excluded from both senders and receivers. */
const EXCLUDED = new Set<string>([
  "Navajo Technical University",
  "Institute of American Indian Arts",
]);

interface CcnsRow {
  NMCCNSSubject: string;
  NMCCNSNumber: string;
  NMCCNSTitle: string;
  SchoolName: string;
  SchoolCourseName: string;
}

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch JSON with retry/backoff — the CCNS backend intermittently 503s. */
async function fetchJson<T>(url: string, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "cc-coursemap-scraper" } });
      if (r.status === 503 || r.status === 502) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      lastErr = e;
      await sleep(800 * (i + 1));
    }
  }
  throw new Error(`fetch failed after ${attempts} attempts: ${url} (${lastErr})`);
}

/** Split a local course code "OATS 120" / "ACCT 1115" / "ACG 101A" into prefix+number. */
function splitCourse(raw: string): { prefix: string; number: string } | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\s+/g, " ");
  const m = cleaned.match(/^([A-Za-z]{2,5})\s*[- ]?\s*(\d{1,4}[A-Za-z]?)\b/);
  if (!m) return null;
  return { prefix: m[1].toUpperCase(), number: m[2].toUpperCase() };
}

async function main() {
  console.log("Fetching subject list…");
  const subjects = await fetchJson<{ subjectCode: string; subject: string }[]>(
    `${BASE}/allSubjects`
  );
  console.log(`  ${subjects.length} subjects.`);

  const entries: TransferEntry[] = [];
  const seen = new Set<string>();
  let groupsTotal = 0;
  let groupsWithBothSides = 0;
  let subjectsFetched = 0;

  for (const { subjectCode } of subjects) {
    const subj = subjectCode.trim();
    const url = `${BASE}/courses/%20/%20/${encodeURIComponent(subj)}%20/*ALL*`;
    let rows: CcnsRow[];
    try {
      rows = await fetchJson<CcnsRow[]>(url);
    } catch (e) {
      console.warn(`  ! ${subj}: ${(e as Error).message} — skipping`);
      await sleep(THROTTLE_MS);
      continue;
    }
    subjectsFetched++;

    // Group rows by common course number.
    const groups = new Map<string, CcnsRow[]>();
    for (const row of rows) {
      if (!row.NMCCNSNumber || !row.SchoolName || !row.SchoolCourseName) continue;
      const key = `${row.NMCCNSSubject} ${row.NMCCNSNumber}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(row);
    }

    for (const [commonKey, group] of groups) {
      groupsTotal++;
      const senders = group.filter(
        (r) => !RECEIVERS[r.SchoolName] && !EXCLUDED.has(r.SchoolName)
      );
      const receivers = group.filter((r) => RECEIVERS[r.SchoolName]);
      if (senders.length === 0 || receivers.length === 0) continue;
      groupsWithBothSides++;

      const title = group[0].NMCCNSTitle?.trim() || "";

      for (const s of senders) {
        const sp = splitCourse(s.SchoolCourseName);
        if (!sp) continue;
        for (const r of receivers) {
          const rp = splitCourse(r.SchoolCourseName);
          if (!rp) continue;
          const recv = RECEIVERS[r.SchoolName];
          const ccCourse = `${sp.prefix} ${sp.number}`;
          const univCourse = `${rp.prefix} ${rp.number}`;
          const dedup = `${ccCourse}|${recv.slug}|${univCourse}`;
          if (seen.has(dedup)) continue;
          seen.add(dedup);
          entries.push({
            state: "nm",
            cc_prefix: sp.prefix,
            cc_number: sp.number,
            cc_course: ccCourse,
            cc_title: title,
            cc_credits: "",
            university: recv.slug,
            university_name: recv.name,
            univ_course: univCourse,
            univ_title: title,
            univ_credits: "",
            notes: `NM Common Course: ${commonKey}`,
            no_credit: false,
            is_elective: false,
          });
        }
      }
    }
    await sleep(THROTTLE_MS);
  }

  // Stable sort for clean diffs.
  entries.sort(
    (a, b) =>
      a.cc_prefix.localeCompare(b.cc_prefix) ||
      a.cc_number.localeCompare(b.cc_number) ||
      a.university.localeCompare(b.university) ||
      a.univ_course.localeCompare(b.univ_course)
  );

  fs.writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2));
  console.log(`\n✓ Wrote ${entries.length} transfer-equiv entries → ${OUT_PATH}`);
  console.log(
    `  subjects fetched: ${subjectsFetched}/${subjects.length}, ` +
      `common-number groups: ${groupsTotal} (${groupsWithBothSides} had both CC + university sides)`
  );

  const byReceiver: Record<string, number> = {};
  for (const e of entries) byReceiver[e.university] = (byReceiver[e.university] || 0) + 1;
  console.log("\nBy receiving university:");
  for (const [s, n] of Object.entries(byReceiver).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${n}`);
  }
}

main().catch((e) => {
  console.error("❌ NM CCNS transfer scrape failed:", e);
  process.exit(1);
});
