/**
 * scrape-transfer-wsu.ts — Washington CC → Washington State University
 * equivalencies.
 *
 * WSU's Transfer Credit Equivalencies tool is a public PeopleSoft
 * Community Access page (no login):
 *   https://pub.my.wsu.edu/psc/wsucsprd/EMPLOYEE/SA/c/COMMUNITY_ACCESS.XXRE_XFRART_DSPLY.GBL
 *
 * Flow (all JS-rendered, so Playwright drives a real page):
 *   "Transfer Course Search" link → Country=USA → State=Washington →
 *   Institution (EXT_ORG_ID) → Career=Undergraduate → Search → Search again
 *   with Subject blank ("Leave Subject Blank to Display All Subjects").
 *   The second click needs a fresh DOM handle — PeopleSoft re-renders the
 *   page after every IC action.
 *
 * Result grid row fields (id="FIELD$<row>"):
 *   W_XFRART_RSL_MV_DESCR254C — incoming CC course ("ACCT& 201", "A A 1##")
 *   W_XFRART_RSL_MV_DESCR254A — WSU equivalent  ("ACCTG 230", "ELECTIVE 1XX")
 *   W_XFRART_RSL_MV_DESCR254B — WSU equivalent title
 *   W_XFRART_RSL_MV_DESCR100  — effective dates "MM-DD-YYYY - MM-DD-YYYY"
 *
 * Row filtering:
 *   - wildcard incoming courses ("ACCT& 1##") never match a real catalog
 *     course — skipped
 *   - multi-course combos ("ACCT& 201 and ACCT& 202") are supplementary:
 *     each component also has its own single-course row, so combos are
 *     skipped rather than emitted misleadingly
 *   - rows whose effective range has ended are skipped
 *
 * NOTE on page.evaluate: tsx/esbuild injects a `__name` helper into
 * functions containing inner function declarations, which breaks Playwright
 * serialization (`__name is not defined`). All evaluate bodies are passed
 * as STRINGS to avoid this.
 *
 * Usage:
 *   npx tsx scripts/wa/scrape-transfer-wsu.ts
 *   npx tsx scripts/wa/scrape-transfer-wsu.ts --college bellevue-college
 */

import * as fs from "fs";
import * as path from "path";
import { chromium, type Page } from "playwright";

const STATE = "wa";
const UNIV_SLUG = "washington-state-university";
const UNIV_NAME = "Washington State University";
const TOOL_URL =
  "https://pub.my.wsu.edu/psc/wsucsprd/EMPLOYEE/SA/c/COMMUNITY_ACCESS.XXRE_XFRART_DSPLY.GBL";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// WSU EXT_ORG_ID → our institutions.json college_slug. Extracted from the
// tool's Washington institution dropdown 2026-06-10 (WSU still uses several
// colleges' pre-rename "Community College" names). Covers all 34 WA CCs.
const COLLEGES: Array<{ orgId: string; slug: string; wsuName: string }> = [
  { orgId: "011316426", slug: "bates-technical-college", wsuName: "Bates Technical College" },
  { orgId: "011284356", slug: "bellevue-college", wsuName: "Bellevue College" },
  { orgId: "011315398", slug: "bellingham-technical-college", wsuName: "Bellingham Technical College" },
  { orgId: "011284357", slug: "big-bend-community-college", wsuName: "Big Bend Community College" },
  { orgId: "011317895", slug: "cascadia-college", wsuName: "Cascadia Community College" },
  { orgId: "011284358", slug: "centralia-college", wsuName: "Centralia College" },
  { orgId: "011284360", slug: "clark-college", wsuName: "Clark College" },
  { orgId: "011315739", slug: "clover-park-technical-college", wsuName: "Clover Park Technical College" },
  { orgId: "011284361", slug: "columbia-basin-college", wsuName: "Columbia Basin College" },
  { orgId: "011284378", slug: "edmonds-college", wsuName: "Edmonds Community College" },
  { orgId: "011284362", slug: "everett-community-college", wsuName: "Everett Community College" },
  { orgId: "011284364", slug: "grays-harbor-college", wsuName: "Grays Harbor College" },
  { orgId: "011284363", slug: "green-river-college", wsuName: "Green River Community College" },
  { orgId: "011284365", slug: "highline-college", wsuName: "Highline Community College" },
  { orgId: "011284367", slug: "lake-washington-institute-of-technology", wsuName: "Lake Washington Institute of Technology" },
  { orgId: "011284366", slug: "lower-columbia-college", wsuName: "Lower Columbia College" },
  { orgId: "011284380", slug: "north-seattle-college", wsuName: "North Seattle Community College" },
  { orgId: "011314592", slug: "northwest-indian-college", wsuName: "Northwest Indian College" },
  { orgId: "011284370", slug: "olympic-college", wsuName: "Olympic College" },
  { orgId: "011284371", slug: "peninsula-college", wsuName: "Peninsula College" },
  { orgId: "011284359", slug: "pierce-college-district", wsuName: "Pierce College" },
  { orgId: "011284153", slug: "renton-technical-college", wsuName: "Renton Technical College" },
  { orgId: "011284381", slug: "seattle-central-college", wsuName: "Seattle Central Community College" },
  { orgId: "011284373", slug: "shoreline-community-college", wsuName: "Shoreline Community College" },
  { orgId: "011284368", slug: "skagit-valley-college", wsuName: "Skagit Valley College" },
  { orgId: "011284384", slug: "south-puget-sound-community-college", wsuName: "South Puget Sound Community College" },
  { orgId: "011284382", slug: "south-seattle-college", wsuName: "South Seattle Community College" },
  { orgId: "011284372", slug: "spokane-community-college", wsuName: "Spokane Community College" },
  { orgId: "011284379", slug: "spokane-falls-community-college", wsuName: "Spokane Falls Community College" },
  { orgId: "011284375", slug: "tacoma-community-college", wsuName: "Tacoma Community College" },
  { orgId: "011284377", slug: "walla-walla-community-college", wsuName: "Walla Walla Community College" },
  { orgId: "011284374", slug: "wenatchee-valley-college", wsuName: "Wenatchee Valley College" },
  { orgId: "011284383", slug: "whatcom-community-college", wsuName: "Whatcom Community College" },
  { orgId: "011284376", slug: "yakima-valley-college", wsuName: "Yakima Valley Community College" },
];

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

interface RawRow {
  incoming: string;
  equiv: string;
  equivTitle: string;
  dates: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** "ACCT&  201" → { prefix: "ACCT&", number: "201" }. Multi-token prefixes
 *  ("A A 101") keep their internal space, matching ctcLink display. */
function splitIncoming(raw: string): { prefix: string; number: string } | null {
  const tokens = raw.replace(/\s+/g, " ").trim().split(" ");
  if (tokens.length < 2) return null;
  const number = tokens[tokens.length - 1];
  if (!/^\d{1,4}[A-Z]?$/.test(number)) return null;
  const prefix = tokens.slice(0, -1).join(" ").toUpperCase();
  if (!/^[A-Z&_ ]{1,10}$/.test(prefix)) return null;
  return { prefix, number };
}

function isActive(dates: string): boolean {
  // "08-01-2006 - 12-31-9999"
  const m = dates.match(/-\s*(\d{2})-(\d{2})-(\d{4})\s*$/);
  if (!m) return true; // unparseable → keep
  const end = new Date(`${m[3]}-${m[1]}-${m[2]}`);
  return end.getTime() >= Date.now();
}

function toMapping(row: RawRow): TransferMapping | null {
  const incoming = row.incoming.replace(/\s+/g, " ").trim();
  if (!incoming || incoming.includes("#")) return null; // wildcard
  if (/\band\b/i.test(incoming)) return null; // multi-course combo
  if (!isActive(row.dates)) return null;
  const split = splitIncoming(incoming);
  if (!split) return null;

  const equiv = row.equiv.replace(/\s+/g, " ").trim();
  const equivTitle = row.equivTitle.replace(/\s+/g, " ").trim();
  const noCredit = /NON.?T/i.test(equiv) || /non-?transferable/i.test(equivTitle);
  const isElective =
    !noCredit && (/(\d|X)XX?\b/i.test(equiv.split(" ").pop() ?? "") || /^ELECTIVE/i.test(equiv) || /elective/i.test(equivTitle));

  return {
    state: STATE,
    cc_prefix: split.prefix,
    cc_number: split.number,
    cc_course: `${split.prefix} ${split.number}`,
    cc_title: "",
    cc_credits: "",
    university: UNIV_SLUG,
    university_name: UNIV_NAME,
    univ_course: noCredit ? "" : equiv,
    univ_title: noCredit ? "" : equivTitle,
    univ_credits: "",
    notes: noCredit ? "Non-transferable per WSU Transfer Credit Equivalencies" : "",
    no_credit: noCredit,
    is_elective: isElective,
  };
}

async function selectByText(page: Page, selector: string, text: string): Promise<boolean> {
  const opt = page.locator(`${selector} option`, { hasText: text }).first();
  const val = await opt.getAttribute("value").catch(() => null);
  if (val === null) return false;
  await page.locator(selector).selectOption(val);
  return true;
}

async function scrapeCollege(page: Page, college: (typeof COLLEGES)[number]): Promise<RawRow[]> {
  await page.goto(TOOL_URL, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(2_000);
  await page.click("#XXRE_XFRART_WRK_LINK2");
  await page.waitForSelector("#XXRE_XFRART_WRK_COUNTRY", { timeout: 30_000 });
  await page.waitForTimeout(1_500);

  if (!(await selectByText(page, "#XXRE_XFRART_WRK_COUNTRY", "United States"))) {
    throw new Error("country option not found");
  }
  await page.waitForTimeout(2_500);
  if (!(await selectByText(page, "#XXRE_XFRART_WRK_STATE", "Washington"))) {
    throw new Error("state option not found");
  }
  await page.waitForTimeout(3_000);
  await page.locator("#XXRE_XFRART_WRK_EXT_ORG_ID").selectOption(college.orgId);
  await page.waitForTimeout(2_500);
  if (!(await selectByText(page, "#XXRE_XFRART_WRK_ACAD_CAREER", "Undergraduate"))) {
    throw new Error("no Undergraduate career offered");
  }
  await page.waitForTimeout(2_500);

  // First search populates the subject list; second (subject blank) renders
  // the full grid. Click via getElementById — PeopleSoft re-renders the DOM
  // after each IC action, detaching Playwright element handles.
  await page.evaluate(`document.getElementById("XXRE_XFRART_WRK_SEARCH_BTN")?.click()`);
  await page.waitForTimeout(8_000);
  await page.evaluate(`document.getElementById("XXRE_XFRART_WRK_SEARCH_BTN")?.click()`);
  await page
    .waitForFunction(
      `document.querySelectorAll("[id^='W_XFRART_RSL_MV_DESCR254A']").length > 10`,
      { timeout: 180_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(3_000);

  return (await page.evaluate(`(() => {
    const n = document.querySelectorAll("[id^='W_XFRART_RSL_MV_DESCR254A']").length;
    const get = (f, i) => {
      const el = document.getElementById(f + "$" + i);
      return el ? el.textContent.trim() : "";
    };
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push({
        incoming: get("W_XFRART_RSL_MV_DESCR254C", i),
        equiv: get("W_XFRART_RSL_MV_DESCR254A", i),
        equivTitle: get("W_XFRART_RSL_MV_DESCR254B", i),
        dates: get("W_XFRART_RSL_MV_DESCR100", i),
      });
    }
    return rows;
  })()`)) as RawRow[];
}

function parseArgs() {
  const args = process.argv.slice(2);
  let collegeFilter: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--college" && args[i + 1]) {
      collegeFilter = args[i + 1];
      i++;
    }
  }
  return { collegeFilter };
}

async function main() {
  const { collegeFilter } = parseArgs();
  const outFile = path.join(process.cwd(), "data", STATE, "transfer-equiv.json");

  const colleges = COLLEGES.filter(
    (c) => !collegeFilter || c.slug.includes(collegeFilter),
  );
  if (colleges.length === 0) {
    console.error(`No college matched "${collegeFilter}".`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  // Statewide dedup (CCN courses repeat across colleges; date-span splits
  // repeat within one college).
  const seen = new Set<string>();
  const mappings: TransferMapping[] = [];
  let skippedWildcard = 0;
  let skippedCombo = 0;
  let failedColleges = 0;

  try {
    for (const college of colleges) {
      const t0 = Date.now();
      try {
        const rows = await scrapeCollege(page, college);
        let added = 0;
        for (const row of rows) {
          const inc = row.incoming;
          if (inc.includes("#")) skippedWildcard++;
          else if (/\band\b/i.test(inc)) skippedCombo++;
          const m = toMapping(row);
          if (!m) continue;
          const key = `${m.cc_course}|${m.univ_course}|${m.no_credit}`;
          if (seen.has(key)) continue;
          seen.add(key);
          mappings.push(m);
          added++;
        }
        console.log(
          `[${college.slug}] ${rows.length} rows → +${added} new (total ${mappings.length}) — ${((Date.now() - t0) / 1000).toFixed(0)}s`,
        );
      } catch (e) {
        failedColleges++;
        console.error(`[${college.slug}] ERROR: ${(e as Error).message}`);
      }
      await sleep(1_000);
    }
  } finally {
    await browser.close();
  }

  console.log(
    `\nParsed ${mappings.length} unique WSU mappings (skipped ${skippedWildcard} wildcard + ${skippedCombo} combo rows; ${failedColleges} colleges failed)`,
  );

  // --college runs are smoke tests: preview to /tmp, never touch real data.
  if (collegeFilter) {
    const preview = "/tmp/wsu-transfer-preview.json";
    fs.writeFileSync(preview, JSON.stringify(mappings, null, 2));
    console.log(`(smoke test) wrote ${mappings.length} mappings → ${preview}`);
    return;
  }

  // Never replace good data with a hollow run.
  if (mappings.length < 1_000) {
    console.error(
      `✗ Refusing to write: only ${mappings.length} mappings (floor 1000).`,
    );
    process.exit(1);
  }

  // Merge: keep every other university's rows, replace WSU's.
  let existing: TransferMapping[] = [];
  if (fs.existsSync(outFile)) {
    try {
      existing = JSON.parse(fs.readFileSync(outFile, "utf8"));
    } catch {}
  }
  const others = existing.filter((m) => m.university !== UNIV_SLUG);
  const all = [...others, ...mappings];

  fs.writeFileSync(outFile, JSON.stringify(all, null, 2));
  console.log(`✓ Wrote ${all.length} total mappings (${mappings.length} WSU) → ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
