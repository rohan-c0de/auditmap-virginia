/**
 * scrape-transfer-transit.ts (IA)
 *
 * Builds Iowa CC→Iowa State University transfer equivalencies from ISU's
 * TRANSIT tool (transit.iastate.edu).
 *
 * Source: TRANSIT's "Reverse Transfer Credit Lookup" — a public Laravel API
 * that returns, for a given ISU course, which external institutions offer
 * equivalent courses. No login required.
 *
 * API flow:
 *   1. GET /reverse_transfer_credit_lookup — get CSRF token + subject list
 *   2. POST /api/get_course_listings  {Course_Subject_ID, _token}
 *        → {course_listings: [{Course_Listing_ID, Course_Subject_ID,
 *                              Course_Number, Course_Title, ...}]}
 *   3. POST /api/get_reverse_transfer_credit_results (paginated, 8/page)
 *        {state:"IA", isu_course_listings:"ID1,ID2,...", page:N}
 *        → {transfer_credit_rules_by_institution: {inst:{rules:{rk:{
 *              isu_courses:{CODE:"SUBJ NUMB"},
 *              external_courses:{"CC CODE":{External_Course_ID,Course_Title}},
 *              Educational_Institution, State}}}}, total_results}
 *
 * Strategy: batch all course listings for a subject into one results call to
 * cut API calls from O(courses) to O(subjects × pages). ~180 subjects.
 *
 * Iowa filter: state=IA returns all Iowa institutions (2-yr + 4-yr); we keep
 * only those matching the IA community-college names in IA_CC_SLUGS.
 *
 * Output dir is process.cwd()/data/ia so the scraper can be run from a
 * scratch dir (e.g. /tmp) to keep its output off any worktree that a
 * concurrent session might remove mid-run. Coverage: single receiver (ISU),
 * F → C.
 *
 * Run:
 *   npx tsx scripts/ia/scrape-transfer-transit.ts [--no-import] [--subject ENGL]
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const BASE = "https://transit.iastate.edu";
const OUT_PATH = path.join(process.cwd(), "data", "ia", "transfer-equiv.json");
const THROTTLE_MS = 400;
const BATCH_SIZE = 15;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const UNIVERSITY = { slug: "iowa-state", name: "Iowa State University" };

const IA_CC_SLUGS: Record<string, string> = {
  "Des Moines Area Community College": "des-moines-area-community-college",
  "Ellsworth Community College": "ellsworth-community-college",
  "Clinton Community College": "eastern-iowa-community-college-district",
  "Muscatine Community College": "eastern-iowa-community-college-district",
  "Scott Community College": "eastern-iowa-community-college-district",
  "Hawkeye Community College": "hawkeye-community-college",
  "Indian Hills Community College": "indian-hills-community-college",
  "Iowa Central Community College": "iowa-central-community-college",
  "Iowa Lakes Community College": "iowa-lakes-community-college",
  "Iowa Western Community College": "iowa-western-community-college",
  "Kirkwood Community College": "kirkwood-community-college",
  "Marshalltown Community College": "marshalltown-community-college",
  "North Iowa Area Community College": "north-iowa-area-community-college",
  "Northeast Iowa Community College": "northeast-iowa-community-college",
  "Northwest Iowa Community College": "northwest-iowa-community-college",
  "Southeastern Community College": "southeastern-community-college",
  "Southwestern Community College": "southwestern-community-college",
  "Western Iowa Tech Community College": "western-iowa-tech-community-college",
};

function matchIowaCc(name: string): string | null {
  for (const [frag, slug] of Object.entries(IA_CC_SLUGS)) {
    if (name.includes(frag)) return slug;
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CourseListingItem {
  Course_Listing_ID: string;
  Course_Subject_ID: string;
  Course_Number: string;
  Course_Title: string;
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

async function getCsrf(): Promise<{ csrf: string; subjects: string[] }> {
  const r = await fetch(`${BASE}/reverse_transfer_credit_lookup`, {
    headers: { "User-Agent": UA },
  });
  const html = await r.text();
  const csrf = html.match(/name="csrf-token" content="([^"]+)"/)?.[1] ?? "";
  const $ = cheerio.load(html);
  const subjects: string[] = [];
  $("#course_subject option").each((_i, el) => {
    const v = $(el).attr("value");
    if (v) subjects.push(v);
  });
  return { csrf, subjects };
}

async function getCourseListings(subject: string, csrf: string): Promise<CourseListingItem[]> {
  const r = await fetch(`${BASE}/api/get_course_listings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-CSRF-TOKEN": csrf,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": UA,
      Accept: "application/json",
    },
    body: new URLSearchParams({ Course_Subject_ID: subject, _token: csrf }).toString(),
  });
  const j = (await r.json()) as { course_listings?: CourseListingItem[] };
  return j.course_listings ?? [];
}

async function getResultsPage(
  listingIds: string[],
  page: number,
  csrf: string
): Promise<{
  rules: Array<{ institution: string; isus: string[]; ccCourse: string; ccTitle: string }>;
  totalResults: number;
}> {
  const r = await fetch(`${BASE}/api/get_reverse_transfer_credit_results`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-CSRF-TOKEN": csrf,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": UA,
      Accept: "application/json",
    },
    body: new URLSearchParams({
      state: "IA",
      isu_course_listings: listingIds.join(","),
      page: String(page),
    }).toString(),
  });
  const j = (await r.json()) as {
    transfer_credit_rules_by_institution?: Record<
      string,
      {
        rules: Record<
          string,
          {
            isu_courses: Record<string, string>;
            external_courses: Record<string, { External_Course_ID: string; Course_Title: string }>;
            Educational_Institution: string;
            State: string;
          }
        >;
      }
    >;
    total_results?: number;
  };

  const rules: Array<{ institution: string; isus: string[]; ccCourse: string; ccTitle: string }> = [];
  for (const inst of Object.values(j.transfer_credit_rules_by_institution ?? {})) {
    for (const rule of Object.values(inst.rules ?? {})) {
      if (rule.State !== "IA") continue;
      const isus = Object.values(rule.isu_courses ?? {});
      for (const cc of Object.values(rule.external_courses ?? {})) {
        rules.push({
          institution: rule.Educational_Institution,
          isus,
          ccCourse: cc.External_Course_ID,
          ccTitle: cc.Course_Title,
        });
      }
    }
  }
  return { rules, totalResults: j.total_results ?? 0 };
}

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");
  const subjIdx = args.indexOf("--subject");
  const subjectFilter = subjIdx >= 0 ? args[subjIdx + 1] : null;

  console.log("Fetching ISU subjects + CSRF token…");
  let { csrf, subjects } = await getCsrf();
  if (subjectFilter) {
    subjects = subjects.filter((s) => s === subjectFilter.toUpperCase());
    console.log(`  Subject filter: ${subjects.join(",")}`);
  }
  console.log(`  ${subjects.length} subjects to process`);

  const entries: TransferEntry[] = [];
  const seen = new Set<string>();
  let csrfRefreshAt = Date.now() + 10 * 60 * 1000;

  for (let si = 0; si < subjects.length; si++) {
    const subject = subjects[si];
    if (Date.now() > csrfRefreshAt) {
      ({ csrf } = await getCsrf());
      csrfRefreshAt = Date.now() + 10 * 60 * 1000;
      await sleep(500);
    }

    const listings = await getCourseListings(subject, csrf);
    if (listings.length === 0) {
      await sleep(THROTTLE_MS);
      continue;
    }

    for (let bi = 0; bi < listings.length; bi += BATCH_SIZE) {
      const batch = listings.slice(bi, bi + BATCH_SIZE);
      const batchIds = batch.map((l) => l.Course_Listing_ID);
      const meta = batch.map((l) => ({
        subject: l.Course_Subject_ID,
        number: l.Course_Number,
        title: l.Course_Title,
      }));

      let page = 0;
      let totalResults = 0;
      const PAGE_SIZE = 8;
      do {
        let result: Awaited<ReturnType<typeof getResultsPage>>;
        try {
          result = await getResultsPage(batchIds, page, csrf);
        } catch {
          await sleep(1000);
          break;
        }
        totalResults = result.totalResults;
        for (const data of result.rules) {
          const ccSlug = matchIowaCc(data.institution);
          if (!ccSlug) continue;
          const m = data.ccCourse.match(/^([A-Z]{1,6})\s+(\S+)/i);
          if (!m) continue;
          const ccPrefix = m[1].toUpperCase();
          const ccNumber = m[2].toUpperCase();
          const ccCourse = `${ccPrefix} ${ccNumber}`;
          for (const isuCourse of data.isus) {
            const dedup = `${ccCourse}|${isuCourse}|${ccSlug}`;
            if (seen.has(dedup)) continue;
            seen.add(dedup);
            const im = isuCourse.match(/^([A-Z]{1,8})\s+(\S+)/i);
            const isuPrefix = im?.[1]?.toUpperCase() ?? "";
            const isuNumber = im?.[2]?.toUpperCase() ?? "";
            const isuTitle =
              meta.find((mm) => mm.subject === isuPrefix && mm.number === isuNumber)?.title ?? "";
            entries.push({
              state: "ia",
              cc_prefix: ccPrefix,
              cc_number: ccNumber,
              cc_course: ccCourse,
              cc_title: data.ccTitle,
              cc_credits: "",
              university: UNIVERSITY.slug,
              university_name: UNIVERSITY.name,
              univ_course: isuCourse,
              univ_title: isuTitle,
              univ_credits: "",
              notes: `Iowa TRANSIT equivalency — ${data.institution}`,
              no_credit: false,
              is_elective: false,
            });
          }
        }
        page++;
        await sleep(THROTTLE_MS);
      } while (page * PAGE_SIZE < totalResults);
      await sleep(THROTTLE_MS);
    }

    if ((si + 1) % 10 === 0) {
      console.log(`  [${si + 1}/${subjects.length}] ${entries.length} entries so far…`);
    }
    await sleep(THROTTLE_MS);
  }

  entries.sort(
    (a, b) =>
      a.cc_prefix.localeCompare(b.cc_prefix) ||
      a.cc_number.localeCompare(b.cc_number) ||
      a.university.localeCompare(b.university)
  );

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(entries, null, 2));
  console.log(`\n✓ Wrote ${entries.length} transfer-equiv entries → ${OUT_PATH}`);

  const byCc: Record<string, number> = {};
  for (const e of entries) {
    const cc = e.notes.replace("Iowa TRANSIT equivalency — ", "");
    byCc[cc] = (byCc[cc] ?? 0) + 1;
  }
  console.log("\nBy Iowa CC:");
  for (const [cc, n] of Object.entries(byCc).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cc}: ${n}`);
  }

  if (!noImport && entries.length > 0) {
    const { importTransfersToSupabase } = await import("../lib/supabase-import");
    await importTransfersToSupabase("ia");
  }
}

main().catch((e) => {
  console.error("❌ IA TRANSIT transfer scrape failed:", e);
  process.exit(1);
});
