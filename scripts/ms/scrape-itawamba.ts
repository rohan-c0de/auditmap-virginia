/**
 * Itawamba Community College — DNN module course-schedule scraper.
 *
 * ICC publishes a public class schedule at iccms.edu/CourseSchedule that is
 * driven by a custom DNN module (ICC_Live_Class_Schedule). The page itself
 * renders without authentication, but the underlying API endpoints
 * (/DesktopModules/ICC_Live_Class_Schedule/api/Main/getTerms, getCourses)
 * reject unauthenticated callers with `{"Message":"Authorization has been
 * denied for this request."}`. DNN's ServicesFramework requires a
 * RequestVerificationToken and ModuleId / TabId header on each call —
 * both are emitted into the page HTML by DNN. We pull them with a
 * single page load, then replay them against the API endpoints.
 *
 * Usage:
 *   npx tsx scripts/ms/scrape-itawamba.ts
 *   npx tsx scripts/ms/scrape-itawamba.ts --no-import
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const STATE = "ms";
const SLUG = "itawamba-community-college";
const BASE = "https://www.iccms.edu";
const PAGE = `${BASE}/CourseSchedule`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
  mode: "in-person" | "online" | "hybrid";
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: null;
  prerequisite_courses: never[];
}

interface DnnContext {
  cookie: string;
  rvt: string;
  tabId: string;
  moduleId: string;
}

async function loadDnnContext(): Promise<DnnContext> {
  const res = await fetch(PAGE, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${PAGE}`);
  const html = await res.text();
  const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const $ = cheerio.load(html);
  const rvt = $('input[name="__RequestVerificationToken"]').first().attr("value") || "";
  // TabId is rendered into the DNN scriptManager block; ModuleId is rendered
  // into the module container (`#dnn_ctr<moduleId>_...`).
  // DNN embeds context in a JSON-ish blob with backticks instead of quotes:
  //   value="`{`...`sf_tabId`:`483`}`"
  // And module containers tag themselves with data-moduleid:
  //   <span class="icc_live_schedule_moduleid" data-moduleid="1774">
  const tabId = (html.match(/[`"]sf_tabId[`"]\s*:\s*[`"]?(\d+)/) ||
                 html.match(/dnn\.dnnVariable\.set\([^)]*"sf_tabId"\s*,\s*"(\d+)"/) ||
                 html.match(/var\s+tabId\s*=\s*(\d+);/) ||
                 html.match(/"TabId"\s*:\s*(\d+)/) ||
                 html.match(/tabid=(\d+)/i))?.[1] || "";
  const moduleId = ($('[data-moduleid]').first().attr("data-moduleid")) ||
                   (html.match(/dnn_ctr(\d+)_/) || html.match(/"ModuleId"\s*:\s*(\d+)/))?.[1] || "";
  if (!rvt) throw new Error("Could not extract __RequestVerificationToken");
  if (!tabId) throw new Error("Could not extract DNN TabId");
  if (!moduleId) throw new Error("Could not extract DNN ModuleId");
  return { cookie: cookies, rvt, tabId, moduleId };
}

async function callDnnApi<T>(ctx: DnnContext, route: string, body?: unknown): Promise<T> {
  const url = `${BASE}/DesktopModules/ICC_Live_Class_Schedule/api/Main/${route}`;
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: BASE,
      Referer: PAGE,
      Cookie: ctx.cookie,
      RequestVerificationToken: ctx.rvt,
      ModuleId: ctx.moduleId,
      TabId: ctx.tabId,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${route}`);
  return (await res.json()) as T;
}

const ICC_DAY_MAP: Record<string, string> = {
  M: "M", T: "T", W: "W", R: "R", TH: "R", F: "F", S: "S", U: "U",
};

function parseDays(raw: string): string {
  if (!raw || /TBA|ARR/i.test(raw)) return "";
  const upper = raw.toUpperCase().replace(/TH/g, "R");
  const out: string[] = [];
  for (const c of upper) if (ICC_DAY_MAP[c] && !out.includes(c)) out.push(c);
  return out.join("");
}

function to24(raw: string): string {
  if (!raw || /TBA|ARR/i.test(raw)) return "";
  const m = raw.match(/(\d{1,2}):?(\d{2})\s*(AM|PM|A|P)/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const ap = m[3].toUpperCase().charAt(0);
    if (ap === "P" && h !== 12) h += 12;
    if (ap === "A" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${m[2]}`;
  }
  return "";
}

function normalizeTerm(label: string): string {
  // "Fall Semester 2026", "Summer 2026", etc.
  const m = label.match(/(Fall|Spring|Summer|Winter)\s*(?:Semester\s*)?(\d{4})/i);
  if (!m) return label.replace(/\s+/g, "");
  const code = m[1].toLowerCase().startsWith("fa") ? "FA" :
               m[1].toLowerCase().startsWith("sp") ? "SP" :
               m[1].toLowerCase().startsWith("su") ? "SU" : "WI";
  return `${m[2]}${code}`;
}

async function main() {
  const noImport = process.argv.includes("--no-import");
  console.log("ICC — DNN module course-schedule scraper");
  console.log(`   Source: ${PAGE}`);

  const ctx = await loadDnnContext();
  console.log(`   DNN context: TabId=${ctx.tabId} ModuleId=${ctx.moduleId}`);

  // getTerms returns { terms: [{code, description}], subjects: [], ... }.
  const termsResp = await callDnnApi<{ terms?: Array<{ code: string; description: string }> }>(ctx, "getTerms");
  const terms = termsResp.terms ?? [];
  console.log(`   Terms: ${terms.length} (${terms.map((t) => t.description).join(", ")})`);

  const outDir = path.join(process.cwd(), "data", STATE, "courses", SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  // Per-campus tab response shape from the live module
  // (icc_live_class_schedule_main.js): { fulton, tupelo, belden, online,
  // offsite, zoom } — each a FLAT section array (one row per section, not
  // grouped by course). Each section carries its own subject/course/title.
  type IccSection = {
    subject?: string;
    course?: string;
    title?: string;
    instructor?: string;
    crn?: string;
    section?: string;
    meetingDays?: string;
    maxseats?: string | number;
    enrolled?: string | number;
    seatsavail?: string | number;
    ptermstart?: string;
    creditHours?: string | number;
    online?: boolean;
    zoom?: boolean;
    campus?: string;
    schedule?: {
      monday?: Array<{ BeginTime?: string; EndTime?: string }>;
      tuesday?: Array<{ BeginTime?: string; EndTime?: string }>;
      wednesday?: Array<{ BeginTime?: string; EndTime?: string }>;
      thursday?: Array<{ BeginTime?: string; EndTime?: string }>;
      friday?: Array<{ BeginTime?: string; EndTime?: string }>;
      saturday?: Array<{ BeginTime?: string; EndTime?: string }>;
      sunday?: Array<{ BeginTime?: string; EndTime?: string }>;
      meetingPlaces?: string[];
    };
  };
  type IccResp = Record<string, IccSection[]>;

  function militaryToHHMM(t: string | undefined): string {
    if (!t) return "";
    const padded = String(t).padStart(4, "0");
    if (!/^\d{4}$/.test(padded)) return "";
    return `${padded.slice(0, 2)}:${padded.slice(2)}`;
  }

  const CAMPUS_TAB_NAMES: Record<string, string> = {
    fulton: "Fulton Campus",
    tupelo: "Tupelo Campus",
    belden: "Belden Center",
    online: "Online",
    offsite: "Off Campus",
    zoom: "Zoom",
  };

  let grand = 0;
  for (const t of terms) {
    if (!t.code) continue;
    const termKey = normalizeTerm(t.description);

    // The module's getCourses endpoint returns empty buckets when subject is
    // blank — we have to iterate the subject list per term.
    const subjectsResp = await callDnnApi<{ subjects?: Array<{ code: string; description: string }> }>(
      ctx, `getSubjects?TERM=${encodeURIComponent(t.code)}`
    );
    // The module also emits a "% / Any" wildcard entry that, when used,
    // double-counts every section already returned by its real subject code.
    const subjects = (subjectsResp.subjects ?? []).filter((s) => s.code !== "%");
    console.log(`  ${termKey}: ${subjects.length} subjects`);

    const sections: CourseSection[] = [];
    for (const subj of subjects) {
      // ICC's getCourses requires the wildcard '%' for courseNum + courseName
      // (verified against the live module — empty strings silently return
      // zero hits even for valid subjects).
      const body = {
        term: t.code,
        subject: subj.code,
        courseNum: "%",
        courseName: "%",
        useName: false,
        monday: false, tuesday: false, wednesday: false, thursday: false,
        friday: false, saturday: false, sunday: false,
        morning: false, afternoon: false, evening: false,
        online: false,
      };
      let resp: IccResp;
      try {
        resp = await callDnnApi<IccResp>(ctx, "getCourses", body);
      } catch (err) {
        console.log(`    ${subj.code}: ERROR ${(err as Error).message}`);
        continue;
      }
      let subjTotal = 0;
    for (const [tabKey, secs] of Object.entries(resp)) {
        if (!Array.isArray(secs)) continue;
        const campusLabel = CAMPUS_TAB_NAMES[tabKey] ?? tabKey;
        const isOnlineTab = tabKey === "online" || tabKey === "zoom";
        for (const s of secs) {
          const prefix = String(s.subject ?? "").trim();
          const number = String(s.course ?? "").trim();
          if (!prefix || !number) continue;
          // Pull start/end times from whichever day has a meeting record.
          const sch = s.schedule ?? {};
          const dayMeetings: Array<{ Begin?: string; End?: string }> = [];
          for (const d of [sch.monday, sch.tuesday, sch.wednesday, sch.thursday, sch.friday, sch.saturday, sch.sunday]) {
            const m = d?.[0];
            if (m && m.BeginTime && m.BeginTime !== "0000") dayMeetings.push({ Begin: m.BeginTime, End: m.EndTime });
          }
          const startTime = militaryToHHMM(dayMeetings[0]?.Begin);
          const endTime = militaryToHHMM(dayMeetings[0]?.End);
          const days = parseDays(String(s.meetingDays ?? ""));
          const cap = parseFloat(String(s.maxseats ?? "")) || null;
          const open = parseFloat(String(s.seatsavail ?? "")) || (cap !== null && s.enrolled != null ? Math.max(cap - parseFloat(String(s.enrolled)), 0) : null);
          const isOnline = isOnlineTab || s.online === true || s.zoom === true;
          const sectionId = String(s.section ?? "").trim();
          const placeStr = (sch.meetingPlaces ?? []).filter((p) => p && p !== "TBA").join("; ");
          sections.push({
            college_code: SLUG,
            term: termKey,
            course_prefix: prefix,
            course_number: number,
            course_title: String(s.title ?? "").trim(),
            credits: parseFloat(String(s.creditHours ?? 0)) || 0,
            crn: String(s.crn ?? "") || `${prefix}-${number}-${sectionId}`,
            days,
            start_time: startTime,
            end_time: endTime,
            start_date: String(s.ptermstart ?? ""),
            location: isOnline ? "Online" : (placeStr || campusLabel),
            campus: String(s.campus ?? campusLabel),
            mode: isOnline ? "online" : "in-person",
            instructor: s.instructor ? String(s.instructor) : null,
            seats_open: open,
            seats_total: cap,
            prerequisite_text: null,
            prerequisite_courses: [],
          });
          subjTotal++;
        }
      }
      if (subjTotal > 0) console.log(`    ${subj.code}: ${subjTotal} sections`);
    }
    if (sections.length === 0) {
      console.log(`  ${termKey}: 0 sections`);
      continue;
    }
    const outPath = path.join(outDir, `${termKey}.json`);
    fs.writeFileSync(outPath, JSON.stringify(sections, null, 2) + "\n");
    console.log(`  ${termKey}: ${sections.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grand += sections.length;
  }
  console.log(`\n${SLUG}: ${grand} total sections`);
  if (noImport) console.log("   (--no-import)");
}

main().catch((err) => {
  console.error("ICC scraper failed:", err);
  process.exit(1);
});
