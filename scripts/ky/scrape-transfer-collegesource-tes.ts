/**
 * scrape-transfer-collegesource-tes.ts — KY transfer equivalencies from
 * CollegeSource TES (Transfer Evaluation System) public-view URLs.
 *
 * Kentucky has no statewide articulation portal. Each receiving university
 * publishes its KCTCS-equivalency table via CollegeSource's "TES_publicview01"
 * ASP.NET WebForms app. The public view is gated behind a math/image CAPTCHA
 * (no login required). We solve the math captcha (simple arithmetic question
 * rendered as text — no OCR) and walk the resulting search UI per receiver.
 *
 * Session flow per receiver (rid/aid pair):
 *   1. GET /publicview/TES_publicview01.aspx?rid=...&aid=...
 *      → extract __VIEWSTATE, _VSTATE, __EVENTVALIDATION, Captcha1$hfToken
 *   2. POST __EVENTTARGET=Captcha1$rblMode$1 → switch to math mode
 *      → response is a Microsoft AJAX delta; parse new state + math question
 *   3. POST Captcha1$txtAnswer=<solved>, btnCaptchaSubmit=Submit
 *      → full HTML response with the search UI
 *   4. POST tbxSearchTransferCollege=KCTCS, __EVENTTARGET=btnSearchTransferCollege
 *      → search results listing 1 institution (KCTCS aggregate)
 *   5. POST __EVENTTARGET=gdvInstWithEQ$ctl02$btnCreditFromInstName
 *      → equivalency grid page 1
 *   6. POST ddlRecordsPerPage=200, __EVENTTARGET=ddlRecordsPerPage
 *      → re-rendered grid with 200 rows/page
 *   7. Walk pages 1..N via POST gdvCourseEQ, Page$N
 *      → parse each page's gdvCourseEQ table
 *
 * KCTCS uses common course numbers across all 16 colleges, and receivers
 * treat KCTCS as a single sending institution. So one TransferMapping per
 * (KCTCS course × receiver) — not per (KCTCS college × course × receiver).
 *
 * Throttled at 2000ms between requests to be a polite citizen of
 * CollegeSource's shared infrastructure (TES serves hundreds of universities).
 *
 * Usage:
 *   npx tsx scripts/ky/scrape-transfer-collegesource-tes.ts
 *   npx tsx scripts/ky/scrape-transfer-collegesource-tes.ts --receiver uky
 *   npx tsx scripts/ky/scrape-transfer-collegesource-tes.ts --no-import
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const STATE = "ky";
const BASE = "https://tes.collegesource.com";
const DELAY_MS = 2000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

// One entry per KY public 4-year university with a CollegeSource TES
// public view. rid/aid sourced by inspection of each university's
// transfer-credit page (2026-05-24). KSU is excluded — KSU has no TES
// public view; their site only links to marketing pathways.
const RECEIVERS: { slug: string; name: string; rid: string; aid: string }[] = [
  {
    slug: "uky",
    name: "University of Kentucky",
    rid: "31ba73f5-92a5-44e2-8a78-fdf1ad25020b",
    aid: "562e673f-5952-4f6d-9225-b55e1c58fc79",
  },
  {
    slug: "uofl",
    name: "University of Louisville",
    rid: "dfbeb9e1-e048-49ca-b901-d8ba6666eb39",
    aid: "39380d65-2ca9-4bd4-8a40-421d48832187",
  },
  {
    slug: "eku",
    name: "Eastern Kentucky University",
    rid: "0dd71d48-5d54-4356-ab31-67ccf24f257e",
    aid: "181ee2d5-71aa-4502-8477-f28fde1a6ada",
  },
  {
    slug: "nku",
    name: "Northern Kentucky University",
    rid: "251cc7b1-b988-4068-a28d-6aadcc8fbd25",
    aid: "8d00e53f-3332-4b37-a280-ef500afb9758",
  },
  {
    slug: "morehead",
    name: "Morehead State University",
    rid: "21a4bd12-57d5-4bc3-a743-1ffb698e5015",
    aid: "922f8e25-4a5e-42af-b226-899d12552526",
  },
  {
    slug: "wku",
    name: "Western Kentucky University",
    rid: "158f9fbf-76e1-4bff-af63-ce29ade55a59",
    aid: "2b928b63-50f8-4225-9ead-2291ba7c9f34",
  },
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────
// Session: cookie jar + viewstate fields, carried forward across postbacks.
// ─────────────────────────────────────────────────────────────────────────

interface Session {
  cookies: Map<string, string>;
  // Latest hidden-field state extracted from the most recent response.
  state: Record<string, string>;
  url: string;
}

function newSession(url: string): Session {
  return { cookies: new Map(), state: {}, url };
}

function cookieHeader(s: Session): string {
  return Array.from(s.cookies.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

function ingestSetCookies(s: Session, headers: Headers): void {
  // Node's fetch surfaces Set-Cookie as a comma-joined string; split on
  // ", " followed by a cookie name=value pattern. Simpler: take everything
  // up to the first ";" of each `name=value` segment.
  const raw = headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const segment = line.split(";")[0];
    const eq = segment.indexOf("=");
    if (eq > 0) {
      s.cookies.set(segment.slice(0, eq).trim(), segment.slice(eq + 1).trim());
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────

async function httpGet(s: Session): Promise<string> {
  const res = await fetch(s.url, {
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml",
      "Cookie": cookieHeader(s),
    },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`GET ${s.url} → HTTP ${res.status}`);
  ingestSetCookies(s, res.headers);
  return await res.text();
}

async function httpPost(
  s: Session,
  formFields: Record<string, string>,
  opts: { ajax?: boolean; label?: string; attempt?: number } = {},
): Promise<string> {
  const attempt = opts.attempt ?? 0;
  const body = new URLSearchParams(formFields).toString();
  const headers: Record<string, string> = {
    "User-Agent": UA,
    "Accept": opts.ajax
      ? "*/*"
      : "text/html,application/xhtml+xml",
    "Cookie": cookieHeader(s),
    "Content-Type": "application/x-www-form-urlencoded",
    "Referer": s.url,
    "Origin": BASE,
  };
  if (opts.ajax) headers["X-MicrosoftAjax"] = "Delta=true";
  try {
    const res = await fetch(s.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      // 405 / 429 / 5xx — transient on TES's shared infra. Back off and retry.
      if ((res.status === 405 || res.status === 429 || res.status >= 500) && attempt < 3) {
        const wait = 5000 * Math.pow(2, attempt);
        await sleep(wait);
        return httpPost(s, formFields, { ...opts, attempt: attempt + 1 });
      }
      const errBody = await res.text();
      try { fs.writeFileSync(`/tmp/ky-error-${opts.label || "post"}.html`, errBody); } catch {}
      throw new Error(`POST → HTTP ${res.status} (saved /tmp/ky-error-${opts.label || "post"}.html, body len=${errBody.length})`);
    }
    ingestSetCookies(s, res.headers);
    return await res.text();
  } catch (e) {
    if (attempt < 3 && /timeout|network|ECONN/i.test(String(e))) {
      await sleep(5000 * Math.pow(2, attempt));
      return httpPost(s, formFields, { ...opts, attempt: attempt + 1 });
    }
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// State extraction
// ─────────────────────────────────────────────────────────────────────────

const STATE_FIELDS = [
  "__VIEWSTATE",
  "__VIEWSTATEENCRYPTED",
  "__EVENTVALIDATION",
  "_VSTATE",
  "Captcha1$hfToken",
];

function extractHiddenFromHtml(html: string, s: Session): void {
  const $ = cheerio.load(html);
  for (const f of STATE_FIELDS) {
    const val = $(`input[name="${f}"]`).attr("value");
    if (val !== undefined) {
      s.state[f] = val;
    } else {
      // Field absent from this response (e.g. Captcha1$hfToken disappears
      // after the captcha is solved). Drop it so we don't keep sending a
      // stale value, which ASP.NET event validation rejects.
      delete s.state[f];
    }
  }
}

/**
 * Parse a Microsoft AJAX partial-response body. Format:
 *   <len>|<type>|<name>|<value>|<len>|<type>|...
 *
 * We only care about hiddenField updates here; values are length-prefixed
 * so they're parsed cleanly even when they contain '|'.
 */
function parseAjaxDelta(body: string, s: Session): void {
  let pos = 0;
  while (pos < body.length) {
    const lenEnd = body.indexOf("|", pos);
    if (lenEnd < 0) break;
    const len = Number(body.slice(pos, lenEnd));
    if (!Number.isFinite(len)) {
      pos = lenEnd + 1;
      continue;
    }
    const typeStart = lenEnd + 1;
    const typeEnd = body.indexOf("|", typeStart);
    if (typeEnd < 0) break;
    const ftype = body.slice(typeStart, typeEnd);
    const nameStart = typeEnd + 1;
    const nameEnd = body.indexOf("|", nameStart);
    if (nameEnd < 0) break;
    const name = body.slice(nameStart, nameEnd);
    const valStart = nameEnd + 1;
    const valEnd = valStart + len;
    if (valEnd > body.length) break;
    const value = body.slice(valStart, valEnd);
    if (ftype === "hiddenField" && STATE_FIELDS.includes(name)) {
      s.state[name] = value;
    }
    pos = valEnd + 1; // skip trailing '|'
  }
}

function buildPost(
  s: Session,
  overrides: Record<string, string>,
): Record<string, string> {
  const base: Record<string, string> = {
    __EVENTTARGET: "",
    __EVENTARGUMENT: "",
    __LASTFOCUS: "",
    __VIEWSTATE: s.state["__VIEWSTATE"] || "",
    __VIEWSTATEENCRYPTED: s.state["__VIEWSTATEENCRYPTED"] || "",
    __EVENTVALIDATION: s.state["__EVENTVALIDATION"] || "",
    _VSTATE: s.state["_VSTATE"] || "",
    __SCROLLPOSITIONX: "0",
    __SCROLLPOSITIONY: "0",
  };
  // Captcha1$hfToken is only present pre-captcha; including it post-solve
  // breaks ASP.NET event validation (the hidden field no longer exists in
  // the form).
  if (s.state["Captcha1$hfToken"]) {
    base["Captcha1$hfToken"] = s.state["Captcha1$hfToken"];
  }
  return { ...base, ...overrides };
}

// ─────────────────────────────────────────────────────────────────────────
// Captcha math solver
// ─────────────────────────────────────────────────────────────────────────

function solveMathQuestion(html: string): number {
  // The math question appears in either the AJAX delta body OR the full
  // HTML — same span id either way.
  const m = html.match(/Captcha1_lblMath[^>]*>([^<]+)</);
  if (!m) throw new Error("Math captcha question not found in response");
  const text = m[1];
  // Examples: "Solve: 2 + 5 = ?", "Solve: 12 - 7 = ?", "Solve: 4 * 3 = ?"
  const expr = text.match(/(\d+)\s*([+\-*])\s*(\d+)/);
  if (!expr) throw new Error(`Cannot parse math question: ${text}`);
  const a = Number(expr[1]);
  const b = Number(expr[3]);
  switch (expr[2]) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    default:
      throw new Error(`Unknown operator ${expr[2]}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Course-cell parsers
// ─────────────────────────────────────────────────────────────────────────

const COURSE_RE = /^([A-Z][A-Z0-9\-]{0,5})\s+([A-Z0-9\-]{2,8})\s*(.+?)?\s*\(([\d.\-]+)\)\s*$/;

function parseCourseCell(raw: string): {
  prefix: string;
  number: string;
  title: string;
  credits: string;
} | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const m = cleaned.match(COURSE_RE);
  if (!m) return null;
  return {
    prefix: m[1],
    number: m[2],
    title: (m[3] || "").trim(),
    credits: m[4],
  };
}

function classifyReceiverCell(raw: string): {
  univ_course: string;
  univ_title: string;
  univ_credits: string;
  no_credit: boolean;
  is_elective: boolean;
} {
  const text = raw.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  if (!text || /no\s+equivalent|no\s+credit|not\s+transferable|non\s*transferable/.test(lower)) {
    return { univ_course: "", univ_title: text, univ_credits: "", no_credit: true, is_elective: false };
  }
  // "DEPARTMENTAL CREDIT AT THE 200+ LEVEL" — elective.
  if (/departmental\s+credit|dept\s+elective|elective\s+credit/i.test(lower)) {
    const parsed = parseCourseCell(text);
    return {
      univ_course: parsed ? `${parsed.prefix} ${parsed.number}` : "",
      univ_title: parsed?.title || text,
      univ_credits: parsed?.credits || "",
      no_credit: false,
      is_elective: true,
    };
  }
  const parsed = parseCourseCell(text);
  if (parsed) {
    return {
      univ_course: `${parsed.prefix} ${parsed.number}`,
      univ_title: parsed.title,
      univ_credits: parsed.credits,
      no_credit: false,
      is_elective: false,
    };
  }
  // Multi-course cell ("A-S 102 TWO-D … (3) AH ACR …"): grab the first
  // course code and keep the full text as the title for context.
  const firstCode = text.match(/^([A-Z][A-Z0-9\-]{0,5})\s+([A-Z0-9\-]{2,8})/);
  if (firstCode) {
    return {
      univ_course: `${firstCode[1]} ${firstCode[2]}`,
      univ_title: text,
      univ_credits: "",
      no_credit: false,
      is_elective: false,
    };
  }
  return { univ_course: "", univ_title: text, univ_credits: "", no_credit: false, is_elective: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Page parsers
// ─────────────────────────────────────────────────────────────────────────

function parsePaginationInfo(html: string): { current: number; total: number } | null {
  const m = html.match(/PAGE\s+(\d+)\s+OF\s+(\d+)/i);
  if (!m) return null;
  return { current: Number(m[1]), total: Number(m[2]) };
}

function parseEquivalencyGrid(
  html: string,
  receiver: { slug: string; name: string },
): TransferMapping[] {
  const $ = cheerio.load(html);
  const out: TransferMapping[] = [];
  const table = $("#gdvCourseEQ").first();
  if (!table.length) return out;

  table.find("tr").slice(1).each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length < 2) return;
    const ccText = $(tds[0]).text();
    const recvText = $(tds[1]).text();
    const note = tds.length > 2 ? $(tds[2]).text().trim() : "";

    const cc = parseCourseCell(ccText);
    if (!cc) return;
    const recv = classifyReceiverCell(recvText);

    out.push({
      state: STATE,
      cc_prefix: cc.prefix,
      cc_number: cc.number,
      cc_course: `${cc.prefix} ${cc.number}`,
      cc_title: cc.title,
      cc_credits: cc.credits,
      university: receiver.slug,
      university_name: receiver.name,
      univ_course: recv.univ_course,
      univ_title: recv.univ_title,
      univ_credits: recv.univ_credits,
      notes: note,
      no_credit: recv.no_credit,
      is_elective: recv.is_elective,
    });
  });

  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-receiver scrape
// ─────────────────────────────────────────────────────────────────────────

async function scrapeReceiver(
  receiver: { slug: string; name: string; rid: string; aid: string },
): Promise<TransferMapping[]> {
  console.log(`\n=== ${receiver.slug} (${receiver.name}) ===`);
  const url = `${BASE}/publicview/TES_publicview01.aspx?rid=${receiver.rid}&aid=${receiver.aid}`;
  const s = newSession(url);

  // 1) GET landing → captcha gate
  console.log(`  [1/7] GET landing`);
  const landing = await httpGet(s);
  extractHiddenFromHtml(landing, s);
  await sleep(DELAY_MS);

  // 2) Switch to math mode (AJAX postback)
  console.log(`  [2/7] Switch captcha to math mode`);
  const mathDelta = await httpPost(
    s,
    buildPost(s, {
      __EVENTTARGET: "Captcha1$rblMode$1",
      "Captcha1$rblMode": "math",
      "Captcha1$txtAnswer": "",
    }),
    { ajax: true, label: `${receiver.slug}-math` },
  );
  parseAjaxDelta(mathDelta, s);
  // The new Captcha1$hfToken is rendered INSIDE the AJAX updatePanel HTML
  // (not as a hiddenField delta), so parseAjaxDelta misses it. Pull it out
  // directly without touching other session fields (which would clobber
  // what parseAjaxDelta just set, since the AJAX body doesn't contain
  // <input name="__VIEWSTATE"> etc.).
  const hfMatch = mathDelta.match(/name="Captcha1\$hfToken"[^>]*value="([^"]*)"/);
  if (hfMatch) s.state["Captcha1$hfToken"] = hfMatch[1];

  // 3) Solve + submit captcha
  const answer = solveMathQuestion(mathDelta);
  console.log(`  [3/7] Submit captcha answer = ${answer}`);
  await sleep(DELAY_MS);
  const afterCaptcha = await httpPost(
    s,
    buildPost(s, {
      "Captcha1$rblMode": "math",
      "Captcha1$txtAnswer": String(answer),
      btnCaptchaSubmit: "Submit",
    }),
  );
  try { fs.writeFileSync(`/tmp/ky-${receiver.slug}-step3.html`, afterCaptcha); } catch {}
  if (/divCaptcha|Captcha1_lblMath/i.test(afterCaptcha) && !/tbxSearchTransferCollege/i.test(afterCaptcha)) {
    throw new Error("Captcha submission rejected (still on captcha page)");
  }
  extractHiddenFromHtml(afterCaptcha, s);
  console.log(`    state after captcha: VS=${(s.state.__VIEWSTATE||"").length} EV=${(s.state.__EVENTVALIDATION||"").length} _VS=${(s.state._VSTATE||"").length}`);

  // 4) Search for KCTCS
  console.log(`  [4/7] Search KCTCS`);
  await sleep(DELAY_MS);
  const searchResult = await httpPost(
    s,
    buildPost(s, {
      __EVENTTARGET: "btnSearchTransferCollege",
      tbxSearchTransferCollege: "KCTCS",
    }),
    { label: `${receiver.slug}-search` },
  );
  extractHiddenFromHtml(searchResult, s);

  // 5) Find + click the KCTCS institution link
  let linkMatch = searchResult.match(/__doPostBack\(&#39;(gdvInstWithEQ\$ctl\d+\$btnCreditFromInstName)&#39;/);
  if (!linkMatch) {
    // Receiver may have KCTCS under a different name (e.g. "Kentucky
    // Community College System") — try a broader search.
    console.log(`    KCTCS not in results; retrying with "kentucky community"`);
    await sleep(DELAY_MS);
    const retry = await httpPost(
      s,
      buildPost(s, {
        __EVENTTARGET: "btnSearchTransferCollege",
        tbxSearchTransferCollege: "kentucky community",
      }),
    );
    extractHiddenFromHtml(retry, s);
    const retryMatch = retry.match(/__doPostBack\(&#39;(gdvInstWithEQ\$ctl\d+\$btnCreditFromInstName)&#39;/);
    if (!retryMatch) {
      throw new Error("No KCTCS institution link found in search results");
    }
    linkMatch = retryMatch;
  }
  const kctcsTarget = linkMatch![1];
  console.log(`  [5/7] Pick institution → ${kctcsTarget}`);
  await sleep(DELAY_MS);
  const gridPage1 = await httpPost(
    s,
    buildPost(s, {
      __EVENTTARGET: kctcsTarget,
      tbxSearchTransferCollege: "KCTCS",
    }),
  );
  extractHiddenFromHtml(gridPage1, s);

  // 6) Bump page size to 200 to cut round-trips
  console.log(`  [6/7] Set page size = 200`);
  await sleep(DELAY_MS);
  const grid200 = await httpPost(
    s,
    buildPost(s, {
      __EVENTTARGET: "ddlRecordsPerPage",
      ddlRecordsPerPage: "200",
    }),
  );
  extractHiddenFromHtml(grid200, s);

  // 7) Walk pages 1..N
  const allRows: TransferMapping[] = [];
  let pageHtml = grid200;
  let pageInfo = parsePaginationInfo(pageHtml);
  if (!pageInfo) {
    // Single-page result — just parse it.
    pageInfo = { current: 1, total: 1 };
  }
  console.log(`  [7/7] Walk pages: total = ${pageInfo.total}`);
  const firstRows = parseEquivalencyGrid(pageHtml, receiver);
  allRows.push(...firstRows);
  console.log(`    page 1/${pageInfo.total}: +${firstRows.length} rows (running: ${allRows.length})`);

  for (let p = 2; p <= pageInfo.total; p++) {
    await sleep(DELAY_MS);
    try {
      pageHtml = await httpPost(
        s,
        buildPost(s, {
          __EVENTTARGET: "gdvCourseEQ",
          __EVENTARGUMENT: `Page$${p}`,
          ddlRecordsPerPage: "200",
        }),
      );
      extractHiddenFromHtml(pageHtml, s);
      const rows = parseEquivalencyGrid(pageHtml, receiver);
      allRows.push(...rows);
      console.log(`    page ${p}/${pageInfo.total}: +${rows.length} rows (running: ${allRows.length})`);
    } catch (e) {
      console.error(`    page ${p}/${pageInfo.total}: FAILED — ${(e as Error).message}`);
      // Re-establish session by restarting from captcha? For now, give up
      // on this receiver and keep what we have.
      break;
    }
  }

  console.log(`  Done: ${allRows.length} mappings for ${receiver.slug}`);
  return allRows;
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const recvIdx = args.indexOf("--receiver");
  const recvFilter = recvIdx >= 0 ? args[recvIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("KY Transfer Equivalency Scraper (CollegeSource TES)");
  console.log(`  Source: ${BASE}/publicview/TES_publicview01.aspx`);

  const targets = recvFilter
    ? RECEIVERS.filter((r) => r.slug === recvFilter)
    : RECEIVERS;
  if (targets.length === 0) {
    console.error(`Unknown receiver: ${recvFilter}. Known: ${RECEIVERS.map((r) => r.slug).join(", ")}`);
    process.exit(1);
  }

  const allMappings: TransferMapping[] = [];
  const failures: { receiver: string; error: string }[] = [];

  for (const receiver of targets) {
    try {
      const rows = await scrapeReceiver(receiver);
      allMappings.push(...rows);
    } catch (e) {
      console.error(`  ${receiver.slug}: FAILED — ${(e as Error).message}`);
      failures.push({ receiver: receiver.slug, error: (e as Error).message });
    }
    // Checkpoint after each receiver so a mid-run crash doesn't waste hours.
    try {
      fs.writeFileSync(
        "/tmp/ky-transfer-checkpoint.json",
        JSON.stringify({ done: receiver.slug, rows: allMappings.length, failures: failures.length }),
      );
      fs.writeFileSync(
        "/tmp/ky-transfer-checkpoint-data.json",
        JSON.stringify(allMappings),
      );
    } catch {
      /* checkpoint is best-effort */
    }
  }

  console.log(`\nTotal mappings: ${allMappings.length}`);
  if (failures.length > 0) {
    console.log(`Failures: ${failures.length}`);
    for (const f of failures) console.log(`  - ${f.receiver}: ${f.error}`);
  }

  // Dedup
  const seen = new Set<string>();
  const deduped = allMappings.filter((m) => {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.university}|${m.univ_course}|${m.univ_title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length < allMappings.length) {
    console.log(`After dedup: ${deduped.length} (dropped ${allMappings.length - deduped.length})`);
  }

  deduped.sort((a, b) =>
    a.cc_prefix.localeCompare(b.cc_prefix) ||
    a.cc_number.localeCompare(b.cc_number) ||
    a.university.localeCompare(b.university),
  );

  const outPath = path.join(process.cwd(), "data", STATE, "transfer-equiv.json");
  // Safety: refuse to overwrite a non-empty file with 0 rows.
  if (deduped.length === 0 && fs.existsSync(outPath)) {
    const existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
    if (Array.isArray(existing) && existing.length > 0) {
      console.error(`REFUSING to overwrite ${outPath} (existing ${existing.length} rows) with 0 rows.`);
      process.exit(1);
    }
  }
  fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2));
  console.log(`\nWrote ${deduped.length} mappings → ${outPath}`);

  if (!noImport && deduped.length > 0) {
    try {
      const { importTransfersToSupabase } = await import("../lib/supabase-import");
      await importTransfersToSupabase(STATE);
    } catch (e) {
      console.log(`Supabase import skipped: ${(e as Error).message}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
