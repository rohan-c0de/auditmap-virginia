/**
 * scrape-campusnexus.ts
 *
 * Scrapes course-section data from New Mexico colleges running
 * Anthology/CampusNexus Student "CMC Portal" (Common/CourseSchedule.aspx).
 *
 * Covers: Southeast New Mexico College (lionsden.senmc.edu)
 *
 * Mechanism: the portal is an ASP.NET WebForms page. The course-results table
 * (`#CourseList`) is rendered server-side as part of the postback response —
 * not via DataTables AJAX as initially hypothesized. (DataTables is loaded on
 * the result page only for client-side pagination over the already-rendered
 * `<tbody>`.) So this scraper:
 *
 *   1. GETs the form page, parses VIEWSTATE / VIEWSTATEGENERATOR /
 *      EVENTVALIDATION, the campus + term option list, and the full set of
 *      delivery-method / day-of-week checkbox names.
 *   2. POSTs the form with all checkboxes preserved (so the server doesn't
 *      filter out sections by delivery method) for each 2026+ term.
 *   3. Parses the rendered `<table id="CourseList">` rows out of the response.
 *
 * Direct HTTP (no Playwright) is materially faster and more robust than the
 * Playwright form-fill flow, which loses sections because Chromium's JS click
 * handlers mutate the checkbox state on load before submit.
 *
 * Usage:
 *   npx tsx scripts/nm/scrape-campusnexus.ts                      # all colleges
 *   npx tsx scripts/nm/scrape-campusnexus.ts --college southeast-new-mexico-college
 *   npx tsx scripts/nm/scrape-campusnexus.ts --term 2026FA        # filter to one standard term
 */

import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";
import { request as undiciRequest } from "undici";

// ---------------------------------------------------------------------------
// Types — match data/nm/courses/<college>/<TERM>.json shape
// ---------------------------------------------------------------------------

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

interface CollegeConfig {
  /** CampusNexus portal URL for the public CourseSchedule.aspx page. */
  portalUrl: string;
  /** Human-readable campus name for the `campus` field on sections. */
  campusName: string;
  /**
   * Optional: a hard-coded campus value to send. If omitted, the scraper
   * uses whichever value is `selected="selected"` in the form's cbCampus.
   */
  campusValueOverride?: string;
}

const COLLEGES: Record<string, CollegeConfig> = {
  "southeast-new-mexico-college": {
    portalUrl: "https://lionsden.senmc.edu/CMCPortal/Common/CourseSchedule.aspx",
    campusName: "Main",
  },
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Term mapping
// ---------------------------------------------------------------------------

function toStandardTerm(termLabel: string): string {
  const m = termLabel.match(/(\d{4})/);
  if (!m) return "XXXX";
  const year = m[1];
  const lower = termLabel.toLowerCase();
  if (lower.includes("fa") || lower.includes("fall")) return `${year}FA`;
  if (lower.includes("sp") || lower.includes("spring")) return `${year}SP`;
  if (lower.includes("su") || lower.includes("summer")) return `${year}SU`;
  if (lower.includes("wi") || lower.includes("winter")) return `${year}SP`;
  return `${year}XX`;
}

// ---------------------------------------------------------------------------
// Field parsers
// ---------------------------------------------------------------------------

function parseCourse(code: string): { prefix: string; number: string } | null {
  // SENMC codes: "MATH 1430G", "ENGL 1110G", "PSYC 1110", "BIOL 2110C"
  const m = code.trim().match(/^([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)/);
  return m ? { prefix: m[1], number: m[2] } : null;
}

function parseDateRange(text: string): string {
  // "8/19/2026 to 12/11/2026" -> "2026-08-19"
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  const [, mo, da, yr] = m;
  return `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
}

function parseDays(scheduleText: string): string {
  // "MWF 9:00 AM - 9:50 AM", "T R 1:00 PM - 2:15 PM", "No Scheduled Meetings"
  if (/no scheduled meetings/i.test(scheduleText)) return "";
  const dayPart = scheduleText.split(/\d/, 1)[0] || "";
  const out: string[] = [];
  const tokens = dayPart.toUpperCase().replace(/[,/]/g, " ").split(/\s+/).filter(Boolean);
  const twoLetter: Record<string, string> = {
    MO: "M", TU: "Tu", WE: "W", TH: "Th", FR: "F", SA: "Sa", SU: "Su",
  };
  const oneLetter: Record<string, string> = {
    M: "M", T: "Tu", W: "W", R: "Th", F: "F", S: "Sa", U: "Su",
  };
  for (const tok of tokens) {
    if (tok.length >= 2 && twoLetter[tok.slice(0, 2)]) {
      const v = twoLetter[tok.slice(0, 2)];
      if (!out.includes(v)) out.push(v);
      continue;
    }
    for (const ch of tok) {
      const v = oneLetter[ch];
      if (v && !out.includes(v)) out.push(v);
    }
  }
  return out.join("");
}

function parseTimeRange(scheduleText: string): { start: string; end: string } {
  const m = scheduleText.match(
    /(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
  );
  if (!m) return { start: "", end: "" };
  return { start: m[1].trim(), end: m[2].trim() };
}

function detectMode(delivery: string, schedule: string): CourseMode {
  const lower = `${delivery} ${schedule}`.toLowerCase();
  if (lower.includes("hybrid") || lower.includes("hyflex")) return "hybrid";
  if (lower.includes("zoom") || lower.includes("synchronous remote")) return "zoom";
  if (
    lower.includes("fully online") ||
    lower.includes("online") ||
    lower.includes("no scheduled meetings") ||
    lower.includes("distance")
  ) {
    return "online";
  }
  return "in-person";
}

function parseSeats(text: string): { open: number | null; total: number | null } {
  const both = text.match(/(\d+)\s*(?:of|\/)\s*(\d+)/);
  if (both) return { open: parseInt(both[1], 10), total: parseInt(both[2], 10) };
  const single = text.match(/(\d+)/);
  return single ? { open: parseInt(single[1], 10), total: null } : { open: null, total: null };
}

// ---------------------------------------------------------------------------
// Form scraping
// ---------------------------------------------------------------------------

interface FormState {
  viewstate: string;
  viewstateGenerator: string;
  eventValidation: string;
  campusValue: string;
  terms: Array<{ value: string; label: string }>;
  /** Names of all checkbox inputs in chbDeliveryMethod that are `checked`. */
  deliveryCheckboxes: string[];
  /** Names of any other server-rendered hidden inputs we should echo back. */
  hiddenInputs: Record<string, string>;
}

function captureCookies(setCookieHeader: string | string[] | undefined, jar: Map<string, string>) {
  if (!setCookieHeader) return;
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const sc of arr) {
    for (const part of sc.split(/,(?=[^;]+=[^;]+)/)) {
      const [kv] = part.split(";");
      const eq = kv.indexOf("=");
      if (eq > 0) jar.set(kv.slice(0, eq).trim(), kv.slice(eq + 1).trim());
    }
  }
}

async function loadForm(portalUrl: string, cookieJar: Map<string, string>): Promise<FormState> {
  // NOTE: Node's global `fetch` (undici-backed) silently triggers a 302→500
  // path on this Cloudflare-fronted ASP.NET app, but the `undici.request`
  // primitive works. Use it directly to keep the session sticky.
  const res = await undiciRequest(portalUrl, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
  });
  captureCookies(res.headers["set-cookie"] as string | string[] | undefined, cookieJar);
  const html = await res.body.text();
  const $ = cheerio.load(html);

  const hidden = (name: string) =>
    ($(`input[type="hidden"][name="${name}"]`).attr("value") || "");

  const viewstate = hidden("__VIEWSTATE");
  const viewstateGenerator = hidden("__VIEWSTATEGENERATOR");
  const eventValidation = hidden("__EVENTVALIDATION");

  if (!viewstate || !eventValidation) {
    throw new Error("Form page missing __VIEWSTATE or __EVENTVALIDATION — site layout may have changed");
  }

  const campusSelect = $('select[name="_ctl0:PlaceHolderMain:_ctl0:cbCampus"]');
  const campusValue =
    campusSelect.find('option[selected="selected"]').attr("value") ||
    campusSelect.find("option").first().attr("value") ||
    "";

  const terms: Array<{ value: string; label: string }> = [];
  $('select[name="_ctl0:PlaceHolderMain:_ctl0:cbTerm"] option').each((_i, el) => {
    const $el = $(el);
    const value = $el.attr("value") || "";
    const label = ($el.text() || "").trim();
    if (value && value !== "-1") terms.push({ value, label });
  });

  const deliveryCheckboxes: string[] = [];
  $('table#chbDeliveryMethod input[type="checkbox"]').each((_i, el) => {
    const $el = $(el);
    if ($el.attr("checked") !== undefined) {
      const name = $el.attr("name");
      if (name) deliveryCheckboxes.push(name);
    }
  });

  // Collect every other hidden input we haven't already captured. This
  // future-proofs us against the portal adding new state fields.
  const hiddenInputs: Record<string, string> = {};
  $('input[type="hidden"]').each((_i, el) => {
    const $el = $(el);
    const name = $el.attr("name");
    if (!name) return;
    if (name === "__VIEWSTATE" || name === "__VIEWSTATEGENERATOR" || name === "__EVENTVALIDATION") return;
    hiddenInputs[name] = $el.attr("value") || "";
  });

  return { viewstate, viewstateGenerator, eventValidation, campusValue, terms, deliveryCheckboxes, hiddenInputs };
}

function buildPostBody(
  form: FormState,
  campusValue: string,
  termValue: string,
): URLSearchParams {
  const body = new URLSearchParams();
  body.set("__EVENTTARGET", "");
  body.set("__EVENTARGUMENT", "");
  body.set("__LASTFOCUS", "");
  body.set("__VIEWSTATE", form.viewstate);
  body.set("__VIEWSTATEGENERATOR", form.viewstateGenerator);
  body.set("__EVENTVALIDATION", form.eventValidation);
  for (const [k, v] of Object.entries(form.hiddenInputs)) body.set(k, v);
  body.set("_ctl0:PlaceHolderMain:_ctl0:cbCampus", campusValue);
  body.set("_ctl0:PlaceHolderMain:_ctl0:cbTerm", termValue);
  body.set("_ctl0:PlaceHolderMain:_ctl0:txtKeyword", "");
  body.set("_ctl0:PlaceHolderMain:_ctl0:txtCode", "");
  body.set("_ctl0:PlaceHolderMain:_ctl0:cbLowTime", "0");
  body.set("_ctl0:PlaceHolderMain:_ctl0:cbHighTime", "23");
  body.set("_ctl0:PlaceHolderMain:_ctl0:cbCourseType", "");
  body.set("_ctl0:PlaceHolderMain:_ctl0:cbCourseAttribute", "");
  // rbOC = Open & Closed (capture full schedule).
  body.set("_ctl0:PlaceHolderMain:_ctl0:rbOC", "rbOpen");
  // Preserve all default-checked delivery method checkboxes so we get every section.
  for (const name of form.deliveryCheckboxes) body.append(name, "on");
  body.set("_ctl0:PlaceHolderMain:_ctl0:btnSearch", "Search");
  return body;
}

async function postTerm(
  portalUrl: string,
  form: FormState,
  campusValue: string,
  termValue: string,
  cookieJar: Map<string, string>,
): Promise<string> {
  const body = buildPostBody(form, campusValue, termValue);
  const cookies = Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await undiciRequest(portalUrl, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: portalUrl,
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: body.toString(),
  });
  captureCookies(res.headers["set-cookie"] as string | string[] | undefined, cookieJar);
  return res.body.text();
}

function parseCourseList(html: string, slug: string, cfg: CollegeConfig, standardTerm: string): CourseSection[] {
  const $ = cheerio.load(html);
  const table = $('table#CourseList');
  if (table.length === 0) return [];

  const sections: CourseSection[] = [];
  table.find("tr").each((_i, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 6) return;
    const cell = (i: number) =>
      $(tds[i]).text().replace(/\s+/g, " ").trim();
    const code = cell(0);
    const title = cell(1);
    const availability = cell(2);
    const dateRange = cell(3);
    const credits = cell(4);
    const schedule = cell(5);
    const instructor = cell(6);
    const delivery = cell(8);
    const seatsText = cell(11);

    const parsed = parseCourse(code);
    if (!parsed) return;

    const { start, end } = parseTimeRange(schedule);
    const { open, total } = parseSeats(seatsText);

    sections.push({
      college_code: slug,
      term: standardTerm,
      course_prefix: parsed.prefix,
      course_number: parsed.number,
      course_title: title,
      credits: parseFloat(credits) || 0,
      crn: availability, // SENMC exposes only a "section availability code" (e.g. W71, D21), not a 5-digit CRN.
      days: parseDays(schedule),
      start_time: start,
      end_time: end,
      start_date: parseDateRange(dateRange),
      location: "",
      campus: cfg.campusName,
      mode: detectMode(delivery, schedule),
      instructor: instructor || null,
      seats_open: open,
      seats_total: total,
      prerequisite_text: null,
      prerequisite_courses: [],
    });
  });
  return sections;
}

// ---------------------------------------------------------------------------
// Per-college orchestrator
// ---------------------------------------------------------------------------

async function scrapeCollege(
  slug: string,
  cfg: CollegeConfig,
  termFilter: string | null,
): Promise<{ termCounts: Record<string, number>; total: number }> {
  console.log(`\n=== Scraping ${slug} (CampusNexus) ===`);

  const cookieJar = new Map<string, string>();
  const form = await loadForm(cfg.portalUrl, cookieJar);
  console.log(`  Form loaded: ${form.terms.length} term options, ${form.deliveryCheckboxes.length} delivery checkboxes`);

  const campusValue = cfg.campusValueOverride || form.campusValue;
  if (!campusValue) throw new Error("No campus value resolved");

  const candidates = form.terms.filter((t) => {
    if (!/20(2[6-9]|30)/.test(t.label)) return false;
    if (termFilter) return toStandardTerm(t.label) === termFilter;
    return true;
  });
  console.log(`  Scraping ${candidates.length} terms`);

  const byTerm = new Map<string, CourseSection[]>();
  for (const t of candidates) {
    try {
      const html = await postTerm(cfg.portalUrl, form, campusValue, t.value, cookieJar);
      const std = toStandardTerm(t.label);
      const sections = parseCourseList(html, slug, cfg, std);
      console.log(`    ${t.label} (val=${t.value}): ${sections.length} sections`);
      const bucket = byTerm.get(std) || [];
      bucket.push(...sections);
      byTerm.set(std, bucket);
    } catch (err) {
      console.warn(`    ${t.label}: failed — ${(err as Error).message}`);
    }
  }

  const outDir = path.join(process.cwd(), "data", "nm", "courses", slug);
  fs.mkdirSync(outDir, { recursive: true });

  const termCounts: Record<string, number> = {};
  let total = 0;
  for (const [std, sections] of byTerm) {
    // Dedupe by (term, course, section-availability-code). Section codes are
    // unique within a course offering across sub-terms in practice.
    const seen = new Set<string>();
    const unique = sections.filter((s) => {
      const k = `${s.term}|${s.course_prefix}${s.course_number}|${s.crn}|${s.start_date}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const outFile = path.join(outDir, `${std}.json`);
    fs.writeFileSync(outFile, JSON.stringify(unique, null, 2));
    console.log(`  → wrote ${outFile} (${unique.length} sections)`);
    termCounts[std] = unique.length;
    total += unique.length;
  }

  return { termCounts, total };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const termIdx = args.indexOf("--term");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : null;
  const termFilter = termIdx >= 0 ? args[termIdx + 1] : null;

  const targets = Object.entries(COLLEGES).filter(
    ([slug]) => !collegeFilter || slug === collegeFilter,
  );
  if (targets.length === 0) {
    console.error(`No matching colleges. Available: ${Object.keys(COLLEGES).join(", ")}`);
    process.exit(1);
  }

  let grandTotal = 0;
  for (const [slug, cfg] of targets) {
    try {
      const { total } = await scrapeCollege(slug, cfg, termFilter);
      grandTotal += total;
    } catch (err) {
      console.error(`❌ ${slug} failed: ${(err as Error).message}`);
    }
  }
  console.log(`\n✓ Total sections across all colleges: ${grandTotal}`);
}

main().catch((err) => {
  console.error("❌ CampusNexus scraper failed:", err);
  process.exit(1);
});
