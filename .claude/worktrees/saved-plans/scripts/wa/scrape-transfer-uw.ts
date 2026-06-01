/**
 * scrape-transfer-uw.ts — Washington CC → University of Washington equivalencies
 *
 * The UW Admissions office maintains a per-college equivalency guide hosted
 * as WordPress pages at admit.washington.edu/apply/transfer/equivalency-guide/.
 * The WordPress REST API returns the full rendered HTML in `content.rendered`
 * without requiring a browser.
 *
 * API:
 *   Parent page id = 503 (equivalency guide root)
 *   College pages:
 *     GET https://admit.washington.edu/wp-json/wp/v2/pages/{id}?_fields=content
 *
 * Table structure inside content.rendered:
 *   <td class="cccourse">CC COURSE (credits) [notes]</td>
 *   <td class="uwequiv">UW COURSE (credits) [notes]</td>
 *   <td class="uwreqs">GEN-ED CODES</td>
 *   <td class="effdate">QUARTER YEAR</td>
 *
 * Coverage: 33 WA CCs (Seattle Colleges page covers North/Central/South).
 * Destination: University of Washington (Seattle) only.
 *
 * CCN note: WA uses Common Course Numbering — courses with "&" suffix
 * (e.g. ENGL& 101, MATH& 141) are identical across all WA CCs. A
 * UW mapping for a CCN course applies to every college that offers it.
 *
 * Usage:
 *   npx tsx scripts/wa/scrape-transfer-uw.ts
 *   npx tsx scripts/wa/scrape-transfer-uw.ts --college green-river-college
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const STATE = "wa";
const UNIV_SLUG = "university-of-washington";
const UNIV_NAME = "University of Washington";
const WP_API = "https://admit.washington.edu/wp-json/wp/v2/pages";
const UA = "Mozilla/5.0 (compatible; CommunityCollegePathBot/1.0)";
const REQUEST_DELAY_MS = 400;

// All WA CC equivalency guide pages (parent = 503).
// "slug" is the WP page slug; "slugs" maps to our institution.json slugs.
// Seattle Colleges page covers 3 sub-colleges.
const COLLEGE_PAGES: Array<{ wpId: number; wpSlug: string; slugs: string[] }> = [
  { wpId: 505, wpSlug: "bates-technical-college",  slugs: ["bates-technical-college"] },
  { wpId: 507, wpSlug: "bellevue",                  slugs: ["bellevue-college"] },
  { wpId: 509, wpSlug: "bellingham",                slugs: ["bellingham-technical-college"] },
  { wpId: 511, wpSlug: "big-bend",                  slugs: ["big-bend-community-college"] },
  { wpId: 514, wpSlug: "cascadia",                  slugs: ["cascadia-college"] },
  { wpId: 516, wpSlug: "centralia",                 slugs: ["centralia-college"] },
  { wpId: 518, wpSlug: "clark",                     slugs: ["clark-college"] },
  { wpId: 520, wpSlug: "clover-park",               slugs: ["clover-park-technical-college"] },
  { wpId: 522, wpSlug: "columbia-basin",            slugs: ["columbia-basin-college"] },
  { wpId: 524, wpSlug: "edmonds",                   slugs: ["edmonds-college"] },
  { wpId: 526, wpSlug: "everett",                   slugs: ["everett-community-college"] },
  { wpId: 528, wpSlug: "grays-harbor",              slugs: ["grays-harbor-college"] },
  { wpId: 530, wpSlug: "green-river",               slugs: ["green-river-college"] },
  { wpId: 532, wpSlug: "highline",                  slugs: ["highline-college"] },
  { wpId: 534, wpSlug: "lake-washington",           slugs: ["lake-washington-institute-of-technology"] },
  { wpId: 536, wpSlug: "lower-columbia",            slugs: ["lower-columbia-college"] },
  { wpId: 540, wpSlug: "northwest-indian",          slugs: ["northwest-indian-college"] },
  { wpId: 542, wpSlug: "olympic",                   slugs: ["olympic-college"] },
  { wpId: 544, wpSlug: "peninsula",                 slugs: ["peninsula-college"] },
  { wpId: 546, wpSlug: "pierce",                    slugs: ["pierce-college-district"] },
  { wpId: 548, wpSlug: "renton",                    slugs: ["renton-technical-college"] },
  // Seattle Colleges page covers all three sub-colleges
  { wpId: 538, wpSlug: "seattle",                   slugs: ["seattle-central-college", "north-seattle-college", "south-seattle-college"] },
  { wpId: 554, wpSlug: "shoreline",                 slugs: ["shoreline-community-college"] },
  { wpId: 552, wpSlug: "skagit-valley",             slugs: ["skagit-valley-college"] },
  { wpId: 550, wpSlug: "south-puget-sound",         slugs: ["south-puget-sound-community-college"] },
  { wpId: 556, wpSlug: "spokane",                   slugs: ["spokane-community-college", "spokane-falls-community-college"] },
  { wpId: 558, wpSlug: "tacoma",                    slugs: ["tacoma-community-college"] },
  { wpId: 560, wpSlug: "wallawalla",                slugs: ["walla-walla-community-college"] },
  { wpId: 562, wpSlug: "wenatcheevalley",           slugs: ["wenatchee-valley-college"] },
  { wpId: 564, wpSlug: "whatcom",                   slugs: ["whatcom-community-college"] },
  { wpId: 566, wpSlug: "yakima-valley",             slugs: ["yakima-valley-college"] },
];

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

async function fetchPage(wpId: number): Promise<string> {
  const url = `${WP_API}/${wpId}?_fields=content`;
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for page ${wpId}`);
  const json = await r.json() as { content: { rendered: string } };
  return json.content.rendered;
}

// Parse "ENGL& 101 (5)" → { prefix: "ENGL&", number: "101", credits: "5" }
function parseCourseCell(raw: string): { prefix: string; number: string; credits: string; rest: string } {
  // Remove § (no-longer-offered marker), * (foreign lang), leading whitespace
  const text = raw.replace(/^[§*\s]+/, "").trim();
  // Match: PREFIX& NUMBER (credits) or PREFIX NUMBER (credits)
  const m = /^([A-Z][A-Z\s&]{0,10})\s+(\d+[A-Z]?)\s*(?:\((\d+(?:,\s*\d+)*)\))?(.*)/.exec(text);
  if (!m) return { prefix: "", number: "", credits: "", rest: text };
  return {
    prefix: m[1].trim(),
    number: m[2].trim(),
    credits: m[3] ?? "",
    rest: (m[4] ?? "").trim(),
  };
}

// Parse UW equiv cell: may be blank (combined entry), "UW COURSE (credits)", "ELECTIVE", "No credit"
function parseUwCell(raw: string): { course: string; title: string; credits: string; no_credit: boolean; is_elective: boolean } {
  const text = raw.trim();
  if (!text) return { course: "", title: "", credits: "", no_credit: false, is_elective: false };

  const noCredit = /no\s*credit|NC\b/i.test(text);
  if (noCredit) return { course: "", title: text, credits: "", no_credit: true, is_elective: false };

  // Elective patterns: "ELECTIVE", "2XX", "DEPT 2XX", "DEPT NNN(credits)"
  const isElective = /\bXX\b|ELECTIVE|ELEC\b|\bLDT\b|\bUDT\b/i.test(text);

  // Extract UW course code: "ACCTG 215 (5)" → course = "ACCTG 215", credits = "5"
  const m = /^([A-Z][A-Z\s]{1,9})\s+(\d+[A-Z]{0,2}[Xx]*)\s*(?:\((\d+)\))?/.exec(text);
  if (m) {
    return {
      course: `${m[1].trim()} ${m[2].trim()}`,
      title: "",
      credits: m[3] ?? "",
      no_credit: false,
      is_elective: isElective,
    };
  }

  return { course: "", title: text.slice(0, 120), credits: "", no_credit: false, is_elective: isElective };
}

// ---------------------------------------------------------------------------
// Parse HTML for one college page
// ---------------------------------------------------------------------------

function parseCollegePage(html: string, collegeSlug: string): TransferMapping[] {
  const $ = cheerio.load(html);
  const mappings: TransferMapping[] = [];

  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 2) return;

    const ccRaw = $(cells[0]).text().trim();
    const uwRaw = $(cells[1]).text().trim();

    if (!ccRaw || !ccRaw.match(/^[A-Z§*]/)) return;

    const cc = parseCourseCell(ccRaw);
    if (!cc.prefix || !cc.number) return;

    const uw = parseUwCell(uwRaw);

    mappings.push({
      state: STATE,
      cc_prefix: cc.prefix,
      cc_number: cc.number,
      cc_course: `${cc.prefix} ${cc.number}`,
      cc_title: cc.rest.replace(/^[-–,;]+\s*/, "").slice(0, 120),
      cc_credits: cc.credits,
      university: UNIV_SLUG,
      university_name: UNIV_NAME,
      univ_course: uw.course,
      univ_title: uw.title,
      univ_credits: uw.credits,
      notes: "",
      no_credit: uw.no_credit,
      is_elective: uw.is_elective,
    });
  });

  return mappings;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let collegeFilter: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--college" && args[i + 1]) { collegeFilter = args[i + 1]; i++; }
  }
  return { collegeFilter };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { collegeFilter } = parseArgs();
  const outFile = path.join(process.cwd(), "data", STATE, "transfer-equiv.json");

  const pages = COLLEGE_PAGES.filter((p) =>
    !collegeFilter || p.slugs.some((s) => s === collegeFilter) || p.wpSlug === collegeFilter
  );

  if (pages.length === 0) {
    console.error(`No college matched "${collegeFilter}".`);
    process.exit(1);
  }

  // Load existing file to merge (we only write UW data; other universities stay)
  let existing: TransferMapping[] = [];
  if (fs.existsSync(outFile) && !collegeFilter) {
    try { existing = JSON.parse(fs.readFileSync(outFile, "utf8")); } catch {}
    existing = existing.filter((m) => m.university !== UNIV_SLUG);
  }

  const all: TransferMapping[] = [...existing];
  let totalMappings = 0;

  for (const page of pages) {
    const t0 = Date.now();
    try {
      const html = await fetchPage(page.wpId);
      const mappings = parseCollegePage(html, page.wpSlug);

      // Replicate mappings across all institution slugs for multi-college pages
      for (const slug of page.slugs) {
        const stamped = mappings.map((m) => ({ ...m })); // each slug gets its own copy
        all.push(...stamped);
        totalMappings += stamped.length;
      }

      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[${page.wpSlug}] ${mappings.length} mappings → ${page.slugs.join(", ")} — ${dt}s`);
    } catch (e) {
      console.error(`[${page.wpSlug}] ERROR:`, (e as Error).message);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(all, null, 2));
  console.log(`\nDone — ${totalMappings} UW mappings across ${pages.length} pages → ${outFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
