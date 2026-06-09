/**
 * Dallas College — bespoke Playwright + cheerio scrape
 *
 * Dallas College (the former Dallas County Community College District, ~70k
 * students, 7 campuses) publishes its public Credit Class Schedule via an
 * eConnect-style server-rendered app at:
 *
 *   https://schedule.dallascollege.edu/
 *
 * Access note: the site sits behind an AWS WAF that 403s plain curl/fetch
 * with a JS challenge. A REAL headless Chromium passes the challenge, so the
 * whole scrape runs inside Playwright. ONE browser context is reused so the
 * WAF cookie persists across every navigation.
 *
 * App structure (no XHR/JSON API — pure server-rendered HTML):
 *   /                       landing page; term tiles <a class="featuretitle">
 *                           link to /Summer, /Fall (clean URL paths). The
 *                           tile text ("Summer 2026") carries the year.
 *   /{TERM}/ByPrefix        flat list of every course-prefix link of the form
 *                           /{TERM}/Prefix/{XXX}
 *   /{TERM}/Prefix/{XXX}    every section for that prefix, grouped into
 *                           ".panel" blocks (one per course). Each panel has:
 *                             <h2 class="panel-title"> ENGL 1301 Composition I
 *                                3 Credit Hours (157 classes) </h2>
 *                           and 1-2 <table class="sectionRowsTable"> (captions
 *                           "Campus Based Classes" / "100% On-Line Classes").
 *
 * Section row anatomy (<tr id="{regNum}" class="jq_ResultRecord {CAMPUS}
 * [jq_full] ...">):
 *   - th               <a>ENGL-1301-17</a><br>Composition I   (section code;
 *                      the <tr id> attribute is the registration number = CRN)
 *   - td[0] .sectionMeetingBlock  one+ blocks of
 *                        .mtgRoom (J105) .mtgInst (mode) .mtgDays (M T W R)
 *                        .mtgTime (07:30 AM - 09:30 AM)
 *   - td[1]            faculty: first <a> text "Clark, Steve"
 *   - td[2]            <abbr>BHC</abbr><br>3   (campus + credits)
 *   - td[3]            "Jun 8, 2026 / Jul 9, 2026 / (5 weeks) /
 *                       Open Seats: 11 / Capacity: 15"  — a full/started class
 *                       shows "Class Started" (no numbers) → open seats 0.
 *   - rows with class jq_ResultRecordComment are co-requisite annotations and
 *     are skipped.
 *
 * Each row maps to the shared CourseSection schema used by every other state's
 * course scraper. Sections are grouped by term and written to
 * data/tx/courses/dallas-college/{TERMCODE}.json (e.g. 2026FA.json).
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-dallas.ts                  # full sweep
 *   npx tsx scripts/tx/scrape-dallas.ts --max-prefixes 3 # smoke (3 prefixes/term)
 *   npx tsx scripts/tx/scrape-dallas.ts --term SUMMER    # one term only
 */
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import { chromium, type Browser, type Page } from "playwright";

const SLUG = "dallas-college";
const STATE = "tx";
const BASE = "https://schedule.dallascollege.edu";
const OUT_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

type CourseMode = "in-person" | "online" | "hybrid" | "zoom";

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  crn: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  location: string;
  campus: string;
  mode: CourseMode;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** "Summer 2026" → "2026SU"; "Fall 2026" → "2026FA"; "Spring 2027" → "2027SP". */
function termTextToCode(text: string): string | null {
  const m = text.match(/(Fall|Spring|Summer|Winter)\s+(\d{4})/i);
  if (!m) return null;
  const map: Record<string, string> = {
    FALL: "FA",
    SPRING: "SP",
    SUMMER: "SU",
    WINTER: "WI",
  };
  return `${m[2]}${map[m[1].toUpperCase()]}`;
}

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

/**
 * "Jun 8, 2026" → "2026-06-08". Returns "" if it can't parse.
 * The Supabase `courses.start_date` column is a real DATE and rejects
 * human-formatted strings, so this conversion is load-bearing.
 */
function toISODate(s: string): string {
  if (!s) return "";
  const m = s.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return "";
  const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!mon) return "";
  const day = m[2].padStart(2, "0");
  return `${m[3]}-${mon}-${day}`;
}

/** "M T W R " (eConnect day letters) → "MTWR". Letters already match our
 * canonical scheme: M Tu W Th F Sa Su → M T W R F S U. eConnect uses single
 * letters with a trailing space, including R for Thursday and U for Sunday.
 * Multiple meeting blocks (lecture + lab) can repeat the same days, so we
 * de-duplicate and emit in canonical week order. */
const DAY_ORDER = "MTWRFSU";
function normalizeDays(s: string): string {
  if (!s) return "";
  const present = new Set(s.replace(/[^MTWRFSU]/g, "").split(""));
  return [...DAY_ORDER].filter((d) => present.has(d)).join("");
}

/** Classify mode from the meeting-instruction text and the table caption. */
function classifyMode(instrText: string, online: boolean): CourseMode {
  const v = instrText.toLowerCase();
  if (/hybrid|blended/.test(v)) return "hybrid";
  if (/zoom|synchronous|virtual|remote/.test(v)) return "zoom";
  if (online || /online|on-line|distance|internet|web/.test(v)) return "online";
  return "in-person";
}

interface ParsedSection {
  prefix: string;
  number: string;
  title: string;
  credits: number;
  section: ParsedRow;
}
interface ParsedRow {
  regNum: string;
  sectionCode: string;
  days: string;
  startTime: string;
  endTime: string;
  startDate: string;
  room: string;
  campus: string;
  mode: CourseMode;
  instructor: string | null;
  seatsOpen: number | null;
  seatsTotal: number | null;
}

/** Parse one prefix page's HTML into flat ParsedSection rows. */
function parsePrefixPage(html: string): ParsedSection[] {
  const $ = cheerio.load(html);
  const out: ParsedSection[] = [];

  $(".panel").each((_, panelEl) => {
    const $panel = $(panelEl);
    const titleRaw = $panel.find(".panel-title").first().text().replace(/\s+/g, " ").trim();
    if (!titleRaw) return;

    // "ENGL 1301 Composition I 3 Credit Hours (157 classes)"
    const tm = titleRaw.match(/^([A-Z]{2,5})\s+([A-Z0-9]{3,5})\s+(.*?)\s+([\d.]+)\s+Credit\s+Hour/i);
    if (!tm) return;
    const prefix = tm[1].toUpperCase();
    const number = tm[2].toUpperCase();
    const title = tm[3].trim();
    const credits = parseFloat(tm[4]) || 0;

    $panel.find("table.sectionRowsTable").each((_, tblEl) => {
      const $tbl = $(tblEl);
      const captionTxt = $tbl.find("caption").first().text().toLowerCase();
      const onlineTable = /on-?line|online/.test(captionTxt);

      $tbl.find("tr.jq_ResultRecord").each((_, trEl) => {
        const $tr = $(trEl);
        const cls = $tr.attr("class") || "";
        // Skip co-requisite annotation rows.
        if (/jq_ResultRecordComment/.test(cls)) return;
        const regNum = ($tr.attr("id") || "").trim();
        // A genuine section row carries the registration number in its id and
        // a section-code anchor in the header cell. Header/legend rows lack id.
        const $th = $tr.find("th").first();
        const sectionCode = ($th.find("a").first().text() || $th.text())
          .replace(/\s+/g, " ")
          .trim()
          .split("\n")[0]
          .trim();
        if (!sectionCode || !/^[A-Z]{2,5}-/i.test(sectionCode)) return;

        const $tds = $tr.children("td");
        const $meet = $tds.eq(0);

        // Combine days across every meeting block (lecture + lab); take the
        // first block's start/end time (mirrors the Collin reference, which
        // reads the first meeting pattern).
        const dayChunks: string[] = [];
        $meet.find(".mtgDays").each((_, d) => {
          dayChunks.push($(d).text());
        });
        const days = normalizeDays(dayChunks.join(" "));
        const firstTime = $meet.find(".mtgTime").first().text().replace(/\s+/g, " ").trim();
        let startTime = "";
        let endTime = "";
        const tmt = firstTime.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
        if (tmt) {
          startTime = tmt[1].replace(/\s+/g, " ").trim();
          endTime = tmt[2].replace(/\s+/g, " ").trim();
        }
        const room = $meet.find(".mtgRoom").first().text().replace(/\s+/g, " ").trim();
        const instrText = $meet.find(".mtgInst").first().text().replace(/\s+/g, " ").trim();

        // Faculty cell: first anchor text "Last, First".
        const instructor =
          $tds.eq(1).find("a").first().text().replace(/\s+/g, " ").trim() || null;

        // Loc/Credits cell: <abbr>BHC</abbr>.
        const campus = $tds.eq(2).find("abbr").first().text().replace(/\s+/g, " ").trim();

        // Dates/Seats cell.
        const datesText = $tds.eq(3).text().replace(/\s+/g, " ").trim();
        const startDate = toISODate(datesText);
        let seatsOpen: number | null = null;
        let seatsTotal: number | null = null;
        const openM = datesText.match(/Open Seats:\s*(\d+)/i);
        const capM = datesText.match(/Capacity:\s*(\d+)/i);
        if (capM) seatsTotal = parseInt(capM[1], 10);
        if (openM) seatsOpen = parseInt(openM[1], 10);
        else if (
          /Class\s+(Started|Ended|Closed|Full|Waitlisted|Cancell?ed)|Section\s+Full|Waitlist/i.test(
            datesText
          )
        ) {
          // Started / ended / closed / full / waitlisted section: no open seats.
          seatsOpen = 0;
        }

        const mode = classifyMode(instrText, onlineTable);
        const location = onlineTable ? "Online" : room || campus;

        out.push({
          prefix,
          number,
          title,
          credits,
          section: {
            regNum,
            sectionCode,
            days,
            startTime,
            endTime,
            startDate,
            room: location,
            campus: onlineTable ? "Online" : campus,
            mode,
            instructor,
            seatsOpen,
            seatsTotal,
          },
        });
      });
    });
  });

  return out;
}

function toCourseSection(p: ParsedSection, termCode: string): CourseSection {
  const s = p.section;
  const crn =
    s.regNum && /^\d+$/.test(s.regNum)
      ? s.regNum
      : s.sectionCode || `${p.prefix}-${p.number}-${s.sectionCode}`;
  return {
    college_code: SLUG,
    term: termCode,
    course_prefix: p.prefix,
    course_number: p.number,
    course_title: p.title,
    credits: p.credits,
    crn,
    days: s.days,
    start_time: s.startTime,
    end_time: s.endTime,
    start_date: s.startDate,
    location: s.room,
    campus: s.campus,
    mode: s.mode,
    instructor: s.instructor,
    seats_open: s.seatsOpen,
    seats_total: s.seatsTotal,
    prerequisite_text: null,
    prerequisite_courses: [],
  };
}

/** True when the response is an AWS-WAF block / rate-limit / JS challenge
 * rather than a real schedule page. The WAF answers a too-fast burst with
 * 405/403/429 and a tiny non-schedule body. */
function isWafBlock(status: number, html: string): boolean {
  if (status === 403 || status === 405 || status === 429) return true;
  if (/awswaf|just a moment|verifying you are human|challenge-container/i.test(html)) {
    return true;
  }
  // A genuine schedule page always carries this chrome; its absence on a
  // 200 means we got an interstitial.
  if (status >= 400) return true;
  return false;
}

/** Re-load the landing page to refresh the AWS-WAF cookie after a block. The
 * token is issued by the JS challenge that runs on a real Chromium page load. */
async function warmCookie(page: Page): Promise<void> {
  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(1200);
  } catch {
    /* best-effort */
  }
}

/**
 * Navigate to a schedule URL and return its HTML, or throw on a WAF block.
 *
 * The section tables are server-rendered, so we wait only for
 * `domcontentloaded` (NOT networkidle — the page keeps third-party
 * analytics/bookstore sockets open and would ride the 60s timeout otherwise).
 *
 * Crucially, the AWS-WAF block is *rate-window* driven: once it trips around
 * the ~25-30th request of a burst, hammering the same context (even with a
 * cookie re-warm) does NOT clear it within seconds — only letting the window
 * cool does. So pass 1 fails FAST (a couple of quick attempts) and hands the
 * prefix to the deferred-retry pass, which waits out the window. This keeps the
 * sweep from burning ~40s per blocked page on retries that can't succeed.
 */
async function gotoWithRetry(
  page: Page,
  url: string,
  opts: { attempts?: number; baseBackoffMs?: number; rewarm?: boolean } = {}
): Promise<string> {
  const attempts = opts.attempts ?? 2;
  const baseBackoff = opts.baseBackoffMs ?? 1500;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      const status = resp?.status() ?? 0;
      const html = await page.content();
      if (!isWafBlock(status, html)) return html;
      lastErr = new Error(`status ${status} / WAF block at ${url}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts) {
      if (opts.rewarm) await warmCookie(page);
      await sleep(baseBackoff * i + Math.floor(Math.random() * 600));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function discoverTerms(page: Page): Promise<{ pathSeg: string; code: string; text: string }[]> {
  // The landing page can come back WAF-soft-blocked (200 but no term tiles).
  // An empty tile list is a miss, not "no terms" — retry with a cooldown.
  for (let attempt = 1; attempt <= 4; attempt++) {
    await gotoWithRetry(page, `${BASE}/`, { attempts: 3, baseBackoffMs: 3000, rewarm: true });
    const tiles = await page.evaluate(() =>
      (Array.from(document.querySelectorAll("a.featuretitle")) as HTMLAnchorElement[]).map((a) => ({
        text: a.textContent?.trim() || "",
        href: a.getAttribute("href") || "",
      }))
    );
    const terms: { pathSeg: string; code: string; text: string }[] = [];
    for (const t of tiles) {
      const code = termTextToCode(t.text);
      const seg = t.href.replace(/^\//, "").trim();
      if (code && seg) terms.push({ pathSeg: seg, code, text: t.text });
    }
    if (terms.length > 0) return terms;
    console.log(`   ⏳ term discovery empty (attempt ${attempt}) — cooling down`);
    await sleep(10000);
  }
  return [];
}

async function discoverPrefixes(page: Page, pathSeg: string): Promise<string[]> {
  // A blocked/soft-failed ByPrefix page yields zero links. Treat an empty list
  // as a WAF miss and retry with cooldown — otherwise the whole term silently
  // scrapes as 0 sections (the bug that ate Summer on an earlier run).
  const re = new RegExp(`/${pathSeg}/Prefix/([A-Z]{2,5})$`, "i");
  for (let attempt = 1; attempt <= 5; attempt++) {
    let html = "";
    try {
      html = await gotoWithRetry(page, `${BASE}/${pathSeg}/ByPrefix`, {
        attempts: 3,
        baseBackoffMs: 3000,
        rewarm: true,
      });
    } catch (e) {
      console.log(`   ⏳ ${pathSeg}/ByPrefix blocked (attempt ${attempt}): ${(e as Error).message}`);
    }
    if (html) {
      const $ = cheerio.load(html);
      const set = new Set<string>();
      $("a").each((_, a) => {
        const m = ($(a).attr("href") || "").match(re);
        if (m) set.add(m[1].toUpperCase());
      });
      if (set.size > 0) return Array.from(set).sort();
    }
    console.log(`   ⏳ ${pathSeg}: prefix list empty (attempt ${attempt}) — cooling ${10}s`);
    await warmCookie(page);
    await sleep(10000);
  }
  return [];
}

async function main() {
  const args = process.argv.slice(2);
  const maxPrefArg = args.find((a) => a.startsWith("--max-prefixes="))?.split("=")[1];
  const maxPrefixes = maxPrefArg ? parseInt(maxPrefArg, 10) : Infinity;
  const onlyTerm = args.find((a) => a.startsWith("--term="))?.split("=")[1]?.toUpperCase();

  console.log(`🐂 Dallas College — eConnect schedule sweep (Playwright)`);
  console.log(`   ${BASE}`);

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ args: ["--disable-blink-features=AutomationControlled"] });
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(() =>
      Object.defineProperty(navigator, "webdriver", { get: () => undefined })
    );
    const page = await ctx.newPage();

    let terms = await discoverTerms(page);
    if (onlyTerm) terms = terms.filter((t) => t.pathSeg.toUpperCase() === onlyTerm);
    if (terms.length === 0) {
      throw new Error("No credit terms discovered on the landing page.");
    }
    console.log(`   terms: ${terms.map((t) => `${t.text} → ${t.code}`).join(", ")}`);

    const byTerm = new Map<string, CourseSection[]>();
    let totalSkipped = 0;

    /** Fetch + parse one prefix; returns sections or null on WAF-block failure.
     * Pass 1 fails fast (2 quick tries); the deferred pass uses the slower,
     * cookie-re-warming retry profile that actually rides out the rate window. */
    async function fetchPrefix(
      pathSeg: string,
      code: string,
      pref: string,
      slow = false
    ): Promise<CourseSection[] | null> {
      let html: string;
      try {
        html = await gotoWithRetry(
          page,
          `${BASE}/${pathSeg}/Prefix/${pref}`,
          slow
            ? { attempts: 4, baseBackoffMs: 4000, rewarm: true }
            : { attempts: 2, baseBackoffMs: 1500, rewarm: false }
        );
      } catch {
        return null;
      }
      return parsePrefixPage(html).map((p) => toCourseSection(p, code));
    }

    for (const term of terms) {
      const prefixes = (await discoverPrefixes(page, term.pathSeg)).slice(0, maxPrefixes);
      console.log(`\n   [${term.text}] ${prefixes.length} prefixes`);
      const sections: CourseSection[] = [];
      const failed: string[] = [];
      let consecutiveBlocks = 0;
      let sinceRest = 0;

      for (let i = 0; i < prefixes.length; i++) {
        const pref = prefixes[i];
        const got = await fetchPrefix(term.pathSeg, term.code, pref);
        if (got === null) {
          failed.push(pref);
          consecutiveBlocks++;
          sinceRest = 0; // a block means the bucket is already drained
          console.log(`      ⚠️  ${pref}: WAF block — deferring to retry pass`);
          // Reactive safety net: if the proactive rest below didn't keep us
          // under the limit and we trip anyway, pause for the full penalty
          // window (~1-2 min) before resuming. With proactive resting this
          // should rarely fire.
          if (consecutiveBlocks >= 2) {
            const cool = 90000;
            console.log(`      ⏸  cooling down ${cool / 1000}s (WAF penalty window)`);
            await warmCookie(page);
            await sleep(cool);
            consecutiveBlocks = 0;
          }
        } else {
          sections.push(...got);
          consecutiveBlocks = 0;
          sinceRest++;
        }
        if ((i + 1) % 20 === 0 || i + 1 === prefixes.length) {
          console.log(`      ${i + 1}/${prefixes.length} prefixes · ${sections.length} sections so far`);
        }
        // PROACTIVE rest: the WAF is a token bucket that allows ~37-40 requests
        // before a ~1-2 min penalty (probed). Rather than sprint into that wall
        // and pay the penalty reactively, rest for 60s after every REST_EVERY
        // successful fetches — this keeps the bucket refilled and avoids blocks
        // almost entirely, making the sweep's runtime predictable.
        const REST_EVERY = 25;
        if (sinceRest >= REST_EVERY && i + 1 < prefixes.length) {
          console.log(`      ⏸  proactive rest 60s after ${sinceRest} requests (keep WAF bucket healthy)`);
          await sleep(60000);
          sinceRest = 0;
        }
        // Base spacing toward the sustainable steady-state rate.
        await sleep(2000 + Math.floor(Math.random() * 500));
      }

      // Second pass: prefixes the WAF hard-blocked in pass 1. A long cooldown
      // fully clears the rate window, and we space these out generously so the
      // sweep loses no subject. Up to two re-pass rounds.
      let round = 0;
      let pending = failed;
      while (pending.length > 0 && round < 2) {
        round++;
        console.log(
          `\n   [${term.text}] pass ${round + 1}: retrying ${pending.length} blocked prefix(es) — ${pending.join(", ")}`
        );
        await warmCookie(page);
        await sleep(90000); // let the WAF penalty window (~1-2 min) reset fully
        const stillFailed: string[] = [];
        for (const pref of pending) {
          const got = await fetchPrefix(term.pathSeg, term.code, pref, true);
          if (got === null) {
            stillFailed.push(pref);
            console.log(`      ⚠️  ${pref}: still blocked`);
          } else {
            sections.push(...got);
            console.log(`      ✓ ${pref}: recovered (${got.length} sections)`);
          }
          await sleep(1500 + Math.floor(Math.random() * 600));
        }
        pending = stillFailed;
      }
      totalSkipped += pending.length;
      if (pending.length > 0) {
        console.log(`   ⚠️  [${term.text}] gave up on: ${pending.join(", ")}`);
      }

      byTerm.set(term.code, sections);
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    let grandTotal = 0;
    const summary: Array<{ term: string; sections: number }> = [];
    const emptyTerms: string[] = [];
    for (const [code, secs] of [...byTerm.entries()].sort()) {
      // Never persist an empty term: a fully WAF-blocked term scraping as 0
      // sections must not overwrite real data with []. Leave the file as-is.
      if (secs.length === 0) {
        emptyTerms.push(code);
        console.log(`   ⏭  ${code}: 0 sections (term blocked) — NOT writing, leaving any existing file untouched`);
        continue;
      }
      const outFile = path.join(OUT_DIR, `${code}.json`);
      fs.writeFileSync(outFile, JSON.stringify(secs, null, 2) + "\n");
      console.log(`   ✓ ${code}: ${secs.length} sections → ${outFile}`);
      summary.push({ term: code, sections: secs.length });
      grandTotal += secs.length;
    }
    console.log(
      `\n✅ ${grandTotal} sections across ${summary.length} terms.` +
        (totalSkipped > 0 ? ` (${totalSkipped} prefix(es) unrecoverable)` : ``)
    );
    if (emptyTerms.length > 0) {
      console.log(`⚠️  terms that came back empty (not written): ${emptyTerms.join(", ")}`);
      process.exitCode = 2;
    }
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((e) => {
  console.error("❌ Dallas scraper failed:", e);
  process.exit(1);
});
