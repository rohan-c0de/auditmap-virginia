/**
 * scrape-transfer.ts — Kansas transfer equivalencies (→ Wichita State).
 *
 * Kansas has no in-state data in CollegeTransfer.Net and the Kansas Board of
 * Regents systemwide portal (transferks.kansasregents.org) is Cloudflare-walled.
 * Wichita State University publishes a fully public GenEd Transfer Equivalency
 * web app listing every sending institution's course-to-course equivalencies:
 *
 *   https://webapps.wichita.edu/genedtsfequiv/
 *
 * All 24 Kansas community/technical colleges appear as sending institutions.
 * It is an ASP.NET WebForms app driven by a two-step postback:
 *   1. select the institution (autopostback) -> populates the subject dropdown
 *   2. submit with subject "*All Subjects*" + HTML format -> results table
 *      [ Transfer Course | And/Or | WSU Equivalent | Credit Hrs | Effective Term | Notes ]
 *
 * The results carry multiple rows per course (one per historical effective
 * term); we keep only the latest-effective-term equivalency for each sending
 * course. The Notes column surfaces the "KS Systemwide Transfer Course"
 * (KRSN) flag, which we preserve.
 *
 * COVERAGE NOTE: Wichita State is one receiver. KU and K-State publish their
 * own public tools (KU's SvelteKit app, K-State's CollegeSource TES view) —
 * possible follow-ups. Receiver labeled precisely as "Wichita State University".
 *
 * Usage:
 *   npx tsx scripts/ks/scrape-transfer.ts
 *   npx tsx scripts/ks/scrape-transfer.ts --no-import
 */

import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";
import { importTransfersToSupabase } from "../lib/supabase-import.js";

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

const URL = "https://webapps.wichita.edu/genedtsfequiv/";
const WSU_SLUG = "wichita-state-university";
const WSU_NAME = "Wichita State University";
const UA = "Mozilla/5.0 (compatible; cc-coursemap)";

// Sending KS colleges → Wichita State Dl_institution option code.
const COLLEGES: { slug: string; name: string; code: string }[] = [
  { slug: "allen-county-community-college", name: "Allen County CC", code: "C6305" },
  { slug: "barton-county-community-college", name: "Barton CC", code: "CW010" },
  { slug: "butler-community-college", name: "Butler CC", code: "C6191" },
  { slug: "cloud-county-community-college", name: "Cloud County CC", code: "C6137" },
  { slug: "coffeyville-community-college", name: "Coffeyville CC", code: "C6102" },
  { slug: "colby-community-college", name: "Colby CC", code: "C6129" },
  { slug: "cowley-county-community-college", name: "Cowley CC", code: "C6008" },
  { slug: "dodge-city-community-college", name: "Dodge City CC", code: "C6166" },
  { slug: "flint-hills-technical-college", name: "Flint Hills Tech", code: "CY353" },
  { slug: "fort-scott-community-college", name: "Fort Scott CC", code: "C6219" },
  { slug: "garden-city-community-college", name: "Garden City CC", code: "C6246" },
  { slug: "highland-community-college", name: "Highland CC", code: "C6276" },
  { slug: "hutchinson-community-college", name: "Hutchinson CC", code: "C6281" },
  { slug: "independence-community-college", name: "Independence CC", code: "C6304" },
  { slug: "johnson-county-community-college", name: "Johnson County CC", code: "C6325" },
  { slug: "kansas-city-kansas-community-college", name: "Kansas City Kansas CC", code: "C6333" },
  { slug: "labette-community-college", name: "Labette CC", code: "C6576" },
  { slug: "manhattan-area-technical-college", name: "Manhattan Area Tech", code: "CY602" },
  { slug: "neosho-county-community-college", name: "Neosho County CC", code: "C6093" },
  { slug: "north-central-kansas-technical-college", name: "North Central KS Tech", code: "CY433" },
  { slug: "northwest-kansas-technical-college", name: "Northwest KS Tech", code: "CY558" },
  { slug: "pratt-community-college", name: "Pratt CC", code: "C6581" },
  { slug: "salina-area-technical-college", name: "Salina Area Tech", code: "CW993" },
  { slug: "seward-county-community-college", name: "Seward County CC", code: "CW016" },
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clean(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/&nbsp;/gi, " ").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/\s+/g, " ").trim();
}

function splitCode(code: string): { prefix: string; number: string; rest: string } {
  // "ANT 111 Cultural Anthropology" -> prefix ANT, number 111, rest title
  const m = code.trim().match(/^([A-Za-z]+)\s+([0-9][0-9A-Za-z]*)\s*(.*)$/);
  if (m) return { prefix: m[1].toUpperCase(), number: m[2], rest: m[3].trim() };
  return { prefix: code.trim().toUpperCase(), number: "", rest: "" };
}

const SEASON: Record<string, number> = { spring: 1, summer: 2, fall: 3, winter: 0 };
function termKey(t: string): number {
  const m = t.toLowerCase().match(/(spring|summer|fall|winter)\s+(\d{4})/);
  if (!m) return 0;
  return parseInt(m[2]) * 10 + (SEASON[m[1]] ?? 0);
}

// --- tiny cookie jar over fetch ----------------------------------------------
class Jar {
  private c = new Map<string, string>();
  header(): string {
    return [...this.c.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  absorb(resp: Response) {
    const sc = resp.headers.get("set-cookie");
    if (!sc) return;
    // node fetch folds multiple cookies into one comma-joined header; split on
    // the cookie boundary (name= after a comma) conservatively.
    for (const part of sc.split(/,(?=[^;]+?=)/)) {
      const kv = part.split(";")[0].trim();
      const eq = kv.indexOf("=");
      if (eq > 0) this.c.set(kv.slice(0, eq), kv.slice(eq + 1));
    }
  }
}

function tok($: cheerio.CheerioAPI, name: string): string {
  return $(`input[name="${name}"]`).attr("value") || "";
}

async function fetchWithJar(jar: Jar, init?: RequestInit & { body?: string }): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(URL, {
      ...init,
      headers: {
        "User-Agent": UA,
        ...(init?.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(jar.header() ? { Cookie: jar.header() } : {}),
      },
    });
    if (resp.status === 429 || resp.status >= 500) {
      await sleep((attempt + 1) * 2000);
      continue;
    }
    jar.absorb(resp);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.text();
  }
  throw new Error("retries exhausted");
}

async function scrapeCollege(cc: { slug: string; name: string; code: string }): Promise<TransferMapping[]> {
  const jar = new Jar();
  // GET fresh page
  const h1 = await fetchWithJar(jar);
  const $1 = cheerio.load(h1);
  // Step 1: select institution (autopostback) to populate subjects
  const s1 = new URLSearchParams();
  s1.set("__EVENTTARGET", "ctl00$MainContent$Dl_institution");
  s1.set("__EVENTARGUMENT", "");
  s1.set("__VIEWSTATE", tok($1, "__VIEWSTATE"));
  s1.set("__VIEWSTATEGENERATOR", tok($1, "__VIEWSTATEGENERATOR"));
  s1.set("__EVENTVALIDATION", tok($1, "__EVENTVALIDATION"));
  s1.set("ctl00$MainContent$Dl_institution", cc.code);
  const h2 = await fetchWithJar(jar, { method: "POST", body: s1.toString() });
  const $2 = cheerio.load(h2);
  // Step 2: submit results for *All Subjects* in HTML format
  const s2 = new URLSearchParams();
  s2.set("__VIEWSTATE", tok($2, "__VIEWSTATE"));
  s2.set("__VIEWSTATEGENERATOR", tok($2, "__VIEWSTATEGENERATOR"));
  s2.set("__EVENTVALIDATION", tok($2, "__EVENTVALIDATION"));
  s2.set("ctl00$MainContent$Dl_institution", cc.code);
  s2.set("ctl00$MainContent$Dl_subject", "*All Subjects*");
  s2.set("ctl00$MainContent$Rb_format", "HTML");
  s2.set("ctl00$MainContent$Bt_newresults", "Submit");
  const h3 = await fetchWithJar(jar, { method: "POST", body: s2.toString() });

  const $ = cheerio.load(h3);
  // Collect rows; keep latest effective term per (sending course, WSU equiv).
  type Row = { ccCourse: string; ccPrefix: string; ccNumber: string; ccTitle: string; uCourse: string; uTitle: string; credit: string; term: number; notes: string; andor: string };
  const rows: Row[] = [];
  $("tr").each((_, tr) => {
    const c = $(tr).find("td").map((__, td) => clean($(td).text())).get();
    if (c.length < 4) return;
    const transferCourse = c[0];
    if (!transferCourse || /^transfer course$/i.test(transferCourse)) return;
    const { prefix, number, rest } = splitCode(transferCourse);
    if (!number) return; // skip non-course rows
    const wsu = c[2] || "";
    if (!wsu) return;
    const wm = wsu.match(/^([A-Za-z]+\s*[0-9][0-9A-Za-z]*)\s*-\s*(.*)$/);
    const uCourse = wm ? wm[1].replace(/\s+/g, " ").trim() : wsu;
    const uTitle = wm ? wm[2].trim() : "";
    rows.push({
      ccCourse: `${prefix} ${number}`,
      ccPrefix: prefix,
      ccNumber: number,
      ccTitle: rest,
      uCourse,
      uTitle,
      credit: /^[\d.]+$/.test(c[3]) ? c[3] : "",
      term: termKey(c[4] || ""),
      notes: c[5] || "",
      andor: c[1] || "",
    });
  });

  // Keep latest-term row per sending course (drop stale historical mappings).
  const latestByCourse = new Map<string, Row>();
  for (const r of rows) {
    const prev = latestByCourse.get(r.ccCourse);
    if (!prev || r.term > prev.term) latestByCourse.set(r.ccCourse, r);
  }

  const out: TransferMapping[] = [];
  for (const r of latestByCourse.values()) {
    const isElective =
      /\b(elective|general)\b/i.test(r.uTitle) || /\b\d{3}-?\*{1,3}\b|XX/i.test(r.uCourse);
    const noCredit = /\b(does not transfer|no credit|not transferable)\b/i.test(r.uTitle + " " + r.notes);
    const noteParts = [`[${cc.slug}]`];
    if (/systemwide transfer/i.test(r.notes)) noteParts.push("KS Systemwide Transfer (KRSN)");
    else if (r.notes) noteParts.push(r.notes);
    out.push({
      state: "ks",
      cc_prefix: r.ccPrefix,
      cc_number: r.ccNumber,
      cc_course: r.ccCourse,
      cc_title: r.ccTitle,
      cc_credits: "",
      university: WSU_SLUG,
      university_name: WSU_NAME,
      univ_course: noCredit ? "" : r.uCourse,
      univ_title: noCredit ? "Does not transfer" : r.uTitle,
      univ_credits: noCredit ? "" : r.credit,
      notes: noteParts.join(" "),
      no_credit: noCredit,
      is_elective: !noCredit && isElective,
    });
  }

  const transferable = out.filter((m) => !m.no_credit);
  console.log(
    `  ${cc.slug.padEnd(40)} ${out.length} mappings (transferable=${transferable.length}, direct=${transferable.filter((m) => !m.is_elective).length})`,
  );
  return out;
}

async function main() {
  const skipImport = process.argv.includes("--no-import");
  console.log("Wichita State GenEd Transfer Equivalency — Kansas Scraper\n");

  const successful = new Set<string>();
  const all: TransferMapping[] = [];
  for (const cc of COLLEGES) {
    try {
      const mappings = await scrapeCollege(cc);
      all.push(...mappings);
      successful.add(cc.slug);
    } catch (err) {
      console.error(`  ${cc.slug}: FAILED — ${(err as Error).message}`);
    }
    await sleep(500);
  }

  const transferable = all.filter((m) => !m.no_credit);
  console.log("\n=== Summary ===");
  console.log(`  Colleges scraped: ${successful.size}/${COLLEGES.length}`);
  console.log(`  Total mappings: ${all.length} (transferable=${transferable.length}, direct=${transferable.filter((m) => !m.is_elective).length})`);

  if (successful.size === 0) {
    console.warn("\n  WARN: no colleges scraped; leaving existing data untouched.");
    return;
  }

  const outPath = path.join(process.cwd(), "data", "ks", "transfer-equiv.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2) + "\n");
  console.log(`\nSaved ${all.length} mappings → ${outPath}`);

  if (!skipImport) {
    try {
      const imported = await importTransfersToSupabase("ks");
      if (imported > 0) console.log(`Imported ${imported} rows to Supabase`);
    } catch (err) {
      console.error(`Supabase import failed: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
