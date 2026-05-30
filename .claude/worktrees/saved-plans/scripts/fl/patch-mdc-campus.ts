/**
 * One-shot: re-derive `campus` on existing MDC section JSONs from the
 * `location` prefix (e.g. "Kendall-Bldg 15, Room R446-00" → "Kendall").
 *
 * The 2026-05-29 first-cut scrape left every campus="" because PS Class
 * Search's result table doesn't expose a campus column for MDC. Most rows
 * still carry the campus name as the first hyphen-separated chunk of the
 * room field, so we can recover ~21% coverage without re-scraping.
 *
 * Run:
 *   npx tsx scripts/fl/patch-mdc-campus.ts
 */
import * as fs from "fs";
import * as path from "path";

const KNOWN_CAMPUSES = new Set([
  "Kendall", "Wolfson", "Hialeah", "Medical", "Padron", "Homestead",
  "North", "West", "Online", "MDC Online",
]);

function deriveCampus(location: string): string {
  if (!location) return "";
  const first = location.split(/\n/)[0] || "";
  const prefix = first.split(/[-,]/)[0]?.trim() ?? "";
  return KNOWN_CAMPUSES.has(prefix) ? prefix : "";
}

const dir = path.join(process.cwd(), "data", "fl", "courses", "mdc");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.includes("partial"));
for (const f of files) {
  const p = path.join(dir, f);
  const data = JSON.parse(fs.readFileSync(p, "utf8")) as Array<Record<string, unknown>>;
  let patched = 0;
  for (const s of data) {
    const c = deriveCampus(String(s.location || ""));
    if (c && s.campus !== c) {
      s.campus = c;
      patched++;
    }
  }
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
  console.log(`${f}: ${data.length} sections, ${patched} patched`);
}
