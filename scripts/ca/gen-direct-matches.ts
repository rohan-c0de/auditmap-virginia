/**
 * gen-direct-matches.ts
 * Converts ASSIST Phase B fixtures into transfer-equiv.json entries
 * with is_elective: false (direct matches) for the top 5 UCs.
 *
 * Usage: npx tsx /tmp/gen-direct-matches.ts
 * Output: /tmp/ca-direct-matches.json (to be merged into data/ca/transfer-equiv.json)
 */

import * as fs from "fs";
import * as path from "path";
import { parseAssistArticulation } from "./parse-assist-articulation.js";

const FIXTURES_DIR = path.join(process.cwd(), "scripts/ca/fixtures/articulation");
const OUT = "/tmp/ca-direct-matches.json";

const UC_SLUGS: Record<string, string> = {
  "university-of-california-berkeley":    "UC Berkeley",
  "university-of-california-los-angeles": "UCLA",
  "university-of-california-san-diego":   "UC San Diego",
  "university-of-california-davis":       "UC Davis",
  "university-of-california-irvine":      "UC Irvine",
};

const files = fs.readdirSync(FIXTURES_DIR)
  .filter(f => f.endsWith(".json") && f !== "_index.json")
  .sort();

console.log(`Processing ${files.length} fixtures...`);

const rows: object[] = [];
let skipped = 0;

for (const file of files) {
  const [ccSlug, uniSlug, ...majorParts] = file.replace(".json","").split("__");
  if (!UC_SLUGS[uniSlug]) { skipped++; continue; }
  const uniName = UC_SLUGS[uniSlug];
  const majorName = majorParts.join("__").replace(/-/g, " ");

  let raw: object;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8"));
  } catch { skipped++; continue; }

  let parsed: ReturnType<typeof parseAssistArticulation>;
  try {
    parsed = parseAssistArticulation(raw as Parameters<typeof parseAssistArticulation>[0]);
  } catch { skipped++; continue; }

  for (const group of parsed.requirement_groups ?? []) {
    for (const req of group.requirements ?? []) {
      const receivingLabel = req.receiving_label ?? "";
      const receivingCourses = req.receiving_courses ?? [];

      if (req.no_articulation_reason) continue; // no articulation

      const sending = req.sending ?? [];
      for (const sendingGroup of sending) {
        for (const course of sendingGroup.courses ?? []) {
          rows.push({
            state: "ca",
            cc_prefix: course.prefix,
            cc_number: course.number,
            cc_course: `${course.prefix} ${course.number}`,
            cc_title: course.title ?? "",
            cc_credits: String(course.min_units ?? ""),
            university: uniSlug,
            university_name: uniName,
            univ_course: receivingCourses.map((c: {prefix:string;number:string}) => `${c.prefix} ${c.number}`).join(", ") || receivingLabel,
            univ_title: receivingLabel,
            univ_credits: "",
            notes: `[${ccSlug}] ${majorName} major at ${uniName}`,
            no_credit: false,
            is_elective: false,
          });
        }
      }
    }
  }
}

// Dedup by (cc_course, university, univ_course)
const seen = new Set<string>();
const deduped = rows.filter(r => {
  const row = r as Record<string,string>;
  const key = `${row.cc_course}||${row.university}||${row.univ_course}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

fs.writeFileSync(OUT, JSON.stringify(deduped, null, 2) + "\n");
console.log(`\nWrote ${deduped.length} direct-match rows to ${OUT} (${rows.length - deduped.length} dupes removed, ${skipped} fixtures skipped)`);
