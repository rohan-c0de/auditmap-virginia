/**
 * scrape-transfer-asu-jonesboro.ts — AR transfer equivalencies into
 * Arkansas State University (ASU-Jonesboro) via the asutep.astate.edu
 * JSON API.
 *
 * Background
 * ──────────
 * ASU-J's transfer-equivalency portal at https://asutep.astate.edu/ is a
 * JS-driven UI, but the back-end is a clean JSON action-dispatcher at
 * `POST https://asutep.astate.edu/server/` (Content-Type: application/json,
 * no auth, CORS-open). The action set:
 *
 *   get_countries         → countries with IPEDS-style codes
 *   get_states {country}  → US states ({"code":"AR", "name":"Arkansas"})
 *   get_schools {country, state, type}
 *                         → schools at that location, by transfer "type"
 *                           ("asu" / "general" / "other"). AR community
 *                           colleges live under "other".
 *   get_subjects {school, type}
 *                         → subject codes the school OFFERS (e.g. "EN",
 *                           "BIOL"). Only the subjects that have an ASU
 *                           equivalent record appear.
 *   get_courses {school, subject, type}
 *                         → course titles (no codes). Not strictly needed
 *                           for our flow — search with just school+subject
 *                           returns all of them.
 *   search {by:type, state, country, school, subject [, course]}
 *                         → array of equivalency rows; each row has
 *                           transfer_subject_code, transfer_course_id,
 *                           transfer_title, transfer_hours,
 *                           asu_subject_code, asu_course_id,
 *                           asu_course_title, asu_credits, gen_ed, attr,
 *                           transfer_school_code, …
 *
 * Crawl strategy: for each AR community college (whitelisted by name from
 * get_schools), iterate each subject from get_subjects, and run search
 * with no course filter → 1 request per (school × subject) returns all
 * mappings for that subject. 15 AR CCs × ~70 subjects ≈ 1000 requests at
 * 300ms throttle ≈ 5 min full sweep.
 *
 * Output: each search row becomes one TransferMapping record. We use the
 * transfer_subject_code as cc_prefix and transfer_course_id as cc_number.
 * The "no_credit" flag is set when asu_subject_code === "NOCR" (their
 * sentinel for "no transfer credit").
 *
 * Usage:
 *   npx tsx scripts/ar/scrape-transfer-asu-jonesboro.ts
 *   npx tsx scripts/ar/scrape-transfer-asu-jonesboro.ts --no-import
 */

import * as fs from "fs";
import * as path from "path";
import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";

const STATE = "ar";
const ENDPOINT = "https://asutep.astate.edu/server/";

// ASU's server has an incomplete TLS chain (Node's default trust store
// can't verify the leaf). Curl/browsers tolerate it; Node fetch refuses.
// We carve out a single custom dispatcher with rejectUnauthorized:false
// scoped to this one endpoint (we don't share it with anything else).
const tlsLenientDispatcher = new UndiciAgent({
  connect: { rejectUnauthorized: false },
});
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
const DELAY_MS = 300;
const UNIVERSITY_SLUG = "asuj";
const UNIVERSITY_NAME = "Arkansas State University";

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

// Whitelist of AR community / technical / state-2yr institutions to pull
// FROM. ASU's "other" school list includes ~79 AR schools — many are
// non-credit beauty schools, fire academies, etc. We restrict to the set
// that maps to AR public community colleges (and the ASU branch 2-years).
// Names taken verbatim from the get_schools response (verified 2026-05-25).
// Names taken VERBATIM from the get_schools response (verified
// 2026-05-25). The portal's spelling is inconsistent — some entries say
// "Comm Coll", others "Community College", some abbreviate "Cc". Whatever
// the spelling, those are the literal strings the API matches on.
const CC_SCHOOL_NAMES = [
  "Arkansas Northeastern College",
  "Arkansas State Univ Beebe",
  "Arkansas State Univ Mid-South",
  "Arkansas State Univ Mt Home",
  "Arkansas State Univ Newport",
  "ASU Three Rivers",
  "Black River Technical College",
  "Cossatot CC - UA",
  "East Arkansas Comm College",
  "National Park Comm Coll",
  "North Arkansas College",
  "Northwest Arkansas Comm Coll",
  "Ozarka College",
  "Phillips Community College Univ Of Arkansas",
  "Pulaski Technical College",
  "South Arkansas Comm Coll",
  "Southeast Arkansas College",
  "Univ Of Arkansas Cc Batesville",
  "Univ Of Arkansas C C At Hope",
  "UACC - Morrilton",
  "Univ of Ark CC Rich Mountain",
];

// Map school-list name → our college_slug in data/ar/institutions.json.
const NAME_TO_SLUG: Record<string, string> = {
  "Arkansas Northeastern College": "arkansas-northeastern-college",
  "Arkansas State Univ Beebe": "arkansas-state-university-beebe",
  "Arkansas State Univ Mid-South": "arkansas-state-university-mid-south",
  "Arkansas State Univ Mt Home": "arkansas-state-university-mountain-home",
  "Arkansas State Univ Newport": "arkansas-state-university-newport",
  "ASU Three Rivers": "asu-three-rivers",
  "Black River Technical College": "black-river-technical-college",
  "Cossatot CC - UA": "cossatot-community-college-of-the-university-of-arkansas",
  "East Arkansas Comm College": "east-arkansas-community-college",
  "National Park Comm Coll": "national-park-college",
  "North Arkansas College": "north-arkansas-college",
  "Northwest Arkansas Comm Coll": "northwest-arkansas-community-college",
  "Ozarka College": "ozarka-college",
  "Phillips Community College Univ Of Arkansas": "phillips-community-college-of-the-university-of-arkansas",
  "Pulaski Technical College": "university-of-arkansas-pulaski-technical-college",
  "South Arkansas Comm Coll": "south-arkansas-college",
  "Southeast Arkansas College": "southeast-arkansas-college",
  "Univ Of Arkansas Cc Batesville": "university-of-arkansas-community-college-batesville",
  "Univ Of Arkansas C C At Hope": "university-of-arkansas-community-college-hope",
  "UACC - Morrilton": "university-of-arkansas-community-college-morrilton",
  "Univ of Ark CC Rich Mountain": "university-of-arkansas-community-college-rich-mountain",
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function api(payload: object, attempt = 0): Promise<unknown> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await undiciFetch(ENDPOINT, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      dispatcher: tlsLenientDispatcher,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await sleep(3000 * Math.pow(2, attempt));
        return api(payload, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} from ${ENDPOINT}`);
    }
    return await res.json();
  } catch (e) {
    if (attempt < 3 && /timeout|network|ECONN/i.test(String(e))) {
      await sleep(3000 * Math.pow(2, attempt));
      return api(payload, attempt + 1);
    }
    throw e;
  }
}

interface SubjectEntry {
  code: string;
}
interface SearchRow {
  transfer_school?: string;
  transfer_subject_code?: string;
  transfer_course_id?: string;
  transfer_title?: string;
  transfer_hours?: string;
  asu_subject_code?: string;
  asu_course_id?: string;
  asu_course_title?: string;
  asu_credits?: string;
  attr?: string | null;
  gen_ed?: string;
}

function isNoCredit(row: SearchRow): boolean {
  // ASU encodes "no credit accepted" as subject=NOCR. Also drop rows with
  // 0-credit ASU side that aren't tagged as electives.
  return row.asu_subject_code === "NOCR";
}

function isElective(row: SearchRow): boolean {
  // The "ELEC" attribute (or similar) indicates elective credit; ASU also
  // sometimes uses "ELECT" or "ELE" in the subject. Keep this loose.
  if (!row.asu_subject_code) return false;
  if (/^ELE/i.test(row.asu_subject_code)) return true;
  if (row.attr && /elect/i.test(row.attr)) return true;
  return false;
}

async function scrapeSchool(name: string): Promise<TransferMapping[]> {
  const slug = NAME_TO_SLUG[name] ?? name.toLowerCase().replace(/\s+/g, "-");
  console.log(`  ${name}`);
  // Subjects offered for this school's transfer-to-ASU data
  const subjResp = (await api({ action: "get_subjects", school: name, type: "other" })) as {
    resources?: SubjectEntry[];
  };
  const subjects = (subjResp.resources ?? []).map((s) => s.code).filter(Boolean);
  console.log(`    ${subjects.length} subjects`);
  await sleep(DELAY_MS);

  const rows: TransferMapping[] = [];
  for (const subject of subjects) {
    try {
      const r = (await api({
        action: "search",
        by: "other",
        country: "157",
        state: "AR",
        school: name,
        subject,
      })) as { resources?: SearchRow[] };
      const hits = r.resources ?? [];
      for (const h of hits) {
        if (!h.transfer_subject_code || !h.transfer_course_id) continue;
        const ccPrefix = h.transfer_subject_code.toUpperCase().trim();
        const ccNumber = h.transfer_course_id.trim();
        const univCode = h.asu_subject_code && h.asu_course_id
          ? `${h.asu_subject_code.toUpperCase().trim()} ${h.asu_course_id.trim()}`
          : "";
        rows.push({
          state: STATE,
          cc_prefix: ccPrefix,
          cc_number: ccNumber,
          cc_course: `${ccPrefix} ${ccNumber}`,
          cc_title: (h.transfer_title ?? "").trim(),
          cc_credits: (h.transfer_hours ?? "").trim(),
          university: UNIVERSITY_SLUG,
          university_name: UNIVERSITY_NAME,
          univ_course: isNoCredit(h) ? "" : univCode,
          univ_title: (h.asu_course_title ?? "").trim(),
          univ_credits: (h.asu_credits ?? "").trim(),
          notes: h.gen_ed === "Y" ? "Gen-Ed" : "",
          no_credit: isNoCredit(h),
          is_elective: isElective(h),
        });
      }
    } catch (e) {
      console.error(`    ${name}/${subject}: FAILED — ${(e as Error).message}`);
    }
    await sleep(DELAY_MS);
  }
  console.log(`    ${name}: +${rows.length} mappings (assigned to slug=${slug})`);
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");
  const schoolIdx = args.indexOf("--school");
  const schoolFilter = schoolIdx >= 0 ? args[schoolIdx + 1] : undefined;

  console.log("AR → ASU-Jonesboro transfer scraper (asutep.astate.edu JSON API)");
  console.log("");

  const targets = schoolFilter
    ? CC_SCHOOL_NAMES.filter((n) => n.toLowerCase().includes(schoolFilter.toLowerCase()))
    : CC_SCHOOL_NAMES;
  if (targets.length === 0) {
    console.error(`No school matched "${schoolFilter}". Known: ${CC_SCHOOL_NAMES.join(", ")}`);
    process.exit(1);
  }

  const newMappings: TransferMapping[] = [];
  for (const school of targets) {
    try {
      const rows = await scrapeSchool(school);
      newMappings.push(...rows);
    } catch (e) {
      console.error(`  ${school}: FAILED — ${(e as Error).message}`);
    }
    try {
      fs.writeFileSync(
        "/tmp/ar-asuj-checkpoint.json",
        JSON.stringify({ done: school, rows: newMappings.length }),
      );
      fs.writeFileSync("/tmp/ar-asuj-checkpoint-data.json", JSON.stringify(newMappings));
    } catch {
      /* best-effort */
    }
  }

  console.log(`\nNew mappings from ASU-J: ${newMappings.length}`);

  // Merge with existing data/ar/transfer-equiv.json
  const outPath = path.join(process.cwd(), "data", STATE, "transfer-equiv.json");
  let existing: TransferMapping[] = [];
  if (fs.existsSync(outPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
    } catch {
      existing = [];
    }
  }
  if (newMappings.length === 0 && existing.length > 0) {
    console.error(`REFUSING to clobber transfer-equiv.json (${existing.length} rows) with 0 new rows.`);
    process.exit(1);
  }
  const combined = [...existing, ...newMappings];
  const seen = new Set<string>();
  const deduped = combined.filter((m) => {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.university}|${m.univ_course}|${m.univ_title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const dropped = combined.length - deduped.length;

  deduped.sort(
    (a, b) =>
      a.cc_prefix.localeCompare(b.cc_prefix) ||
      a.cc_number.localeCompare(b.cc_number) ||
      a.university.localeCompare(b.university),
  );

  fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2));
  console.log(`Merged: existing=${existing.length} + new=${newMappings.length} - dupes=${dropped} = ${deduped.length}`);
  console.log(`Wrote ${deduped.length} mappings → ${outPath}`);

  if (!noImport && newMappings.length > 0) {
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
