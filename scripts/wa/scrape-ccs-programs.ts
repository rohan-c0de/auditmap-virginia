/**
 * scrape-ccs-programs.ts — degree/program requirements for the two Community
 * Colleges of Spokane (Spokane CC + Spokane Falls CC).
 *
 * CCS publishes a custom ASP.NET catalog at catalog.spokane.edu (NOT acalog —
 * catalog.sfcc.edu is Santa Fe CC in New Mexico). The catalog UI is
 * JS-rendered, but it feeds from a public JSON(P) web service at
 * external.spokane.edu/webservices/iCatalogLegacyJSON.asmx:
 *
 *   GetDegree?OptionID&callback                       → program metadata
 *   GetOptionCoursesAndElectives?OptionID&SelectedSTRM → required courses
 *   GetOptionElectiveGroups?OptionID&SelectedSTRM      → elective groups
 *   GetElectiveGroupCourses?OptionElectiveGroupID&SelectedSTRM → group courses
 *
 * OptionIDs are discovered from the "Print View" links (versionid=N&strm=M)
 * on /CoursesAndPrograms/DegreesAndCertificates.aspx, whose anchor text ends
 * in " - SCC" or " - SFCC" — that suffix routes each program to its college.
 *
 * Usage:
 *   npx tsx scripts/wa/scrape-ccs-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
import type {
  CollegePrograms,
  ProgramCredential,
  ProgramRequirement,
  RequirementGroup,
} from "../../lib/types";

const CATALOG_BASE = "https://catalog.spokane.edu";
const API_BASE =
  "https://external.spokane.edu/webservices/iCatalogLegacyJSON.asmx";

const COLLEGE_SLUGS: Record<string, string> = {
  SCC: "spokane-community-college",
  SFCC: "spokane-falls-community-college",
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CONCURRENCY = 4;
const DELAY_MS = 120;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchText(url: string, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) return res.text();
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`${url} failed: ${lastErr}`);
}

/** Call an iCatalogLegacyJSON endpoint; returns the Table array. */
async function api(method: string, params: Record<string, string | number>): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  );
  qs.set("callback", "cb");
  const raw = await fetchText(`${API_BASE}/${method}?${qs}`);
  const json = raw.replace(/^[^(]*\(/, "").replace(/\);?\s*$/, "");
  const parsed = JSON.parse(json) as { Table?: Record<string, unknown>[] };
  return parsed.Table ?? [];
}

interface DegreeLink {
  optionId: number;
  strm: string;
  longTitle: string; // "Associate in Applied Science - Accounting Assistant - SCC"
  college: "SCC" | "SFCC";
}

function parseDegreeLinks(html: string): DegreeLink[] {
  const out: DegreeLink[] = [];
  const seen = new Set<number>();
  // Each <li> pairs a human link (text ending " - SCC"/" - SFCC") with a
  // "Print View" link carrying versionid + strm.
  const liRegex =
    /<a [^>]*>([^<]+?)\s*<\/a>\s*\|\s*<a href="DegreeDescription\.aspx\?versionid=(\d+)&(?:amp;)?strm=(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = liRegex.exec(html)) !== null) {
    const text = m[1].trim();
    const optionId = parseInt(m[2], 10);
    if (seen.has(optionId)) continue;
    const collegeMatch = text.match(/-\s*(SCC|SFCC)\s*$/);
    if (!collegeMatch) continue;
    seen.add(optionId);
    out.push({
      optionId,
      strm: m[3],
      longTitle: text,
      college: collegeMatch[1] as "SCC" | "SFCC",
    });
  }
  return out;
}

function credentialFrom(longTitle: string): ProgramCredential {
  const t = longTitle.toLowerCase();
  if (t.includes("applied science")) return "AAS";
  if (t.includes("associate in arts") || t.includes("associate of arts")) return "AA";
  if (t.includes("associate in science") || t.includes("associate of science")) return "AS";
  if (t.startsWith("associate")) return "other";
  if (t.includes("certificate")) return "certificate";
  return "other";
}

function courseFromRow(row: Record<string, unknown>): {
  prefix: string;
  number: string;
  title: string;
  credits: number | null;
} | null {
  const subject = String(row.SUBJECT ?? "").trim();
  const number = String(row.CATALOG_NBR ?? "").trim();
  if (!subject || !number) return null;
  // WA common-course-numbering suffix ("&") arrives in CourseSuffix.
  const suffix = String(row.CourseSuffix ?? "").trim();
  return {
    prefix: (subject + suffix).toUpperCase(),
    number,
    title: String(row.COURSE_TITLE_LONG ?? "").trim(),
    credits: typeof row.UNITS_MINIMUM === "number" ? row.UNITS_MINIMUM : null,
  };
}

async function scrapeOption(link: DegreeLink): Promise<ProgramRequirement | null> {
  const [meta] = await api("GetDegree", { OptionID: link.optionId });
  if (!meta) return null;

  const programTitle = [
    String(meta.ProgramTitle ?? "").trim(),
    String(meta.OptionTitle ?? "").trim(),
  ]
    .filter(Boolean)
    .join(" — ");
  const degreeLong = String(meta.DegreeLongTitle ?? "").trim();
  const title = programTitle ? `${programTitle}, ${degreeLong}` : link.longTitle;

  const groups: RequirementGroup[] = [];

  const courseRows = await api("GetOptionCoursesAndElectives", {
    OptionID: link.optionId,
    SelectedSTRM: link.strm,
  });
  const byQuarter = new Map<number, RequirementGroup>();
  for (const row of courseRows) {
    const course = courseFromRow(row);
    if (!course) continue;
    const q = typeof row.Quarter === "number" ? row.Quarter : 0;
    let g = byQuarter.get(q);
    if (!g) {
      g = {
        name: q > 0 ? `Quarter ${q}` : "Required courses",
        credits_required: null,
        choose_n: null,
        courses: [],
      };
      byQuarter.set(q, g);
    }
    g.courses.push({ ...course, or_alternatives: [] });
  }
  groups.push(...Array.from(byQuarter.keys()).sort((a, b) => a - b).map((q) => byQuarter.get(q)!));

  const electiveGroups = await api("GetOptionElectiveGroups", {
    OptionID: link.optionId,
    SelectedSTRM: link.strm,
  });
  for (const eg of electiveGroups) {
    const groupId = eg.OptionElectiveGroupID;
    if (typeof groupId !== "number") continue;
    const rows = await api("GetElectiveGroupCourses", {
      OptionElectiveGroupID: groupId,
      SelectedSTRM: link.strm,
    });
    const courses = rows
      .map(courseFromRow)
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => ({ ...c, or_alternatives: [] }));
    if (courses.length === 0) continue;
    groups.push({
      name: String(eg.ElectiveGroupTitle ?? "Electives").trim() || "Electives",
      credits_required: null,
      choose_n: null,
      courses,
    });
  }

  if (groups.every((g) => g.courses.length === 0)) return null;

  const totalCredits = groups
    .flatMap((g) => g.courses)
    .reduce((sum, c) => sum + (c.credits ?? 0), 0);

  return {
    title,
    credential: credentialFrom(degreeLong || link.longTitle),
    program_code: null,
    catalog_url: `${CATALOG_BASE}/CoursesAndPrograms/DegreeDescription.aspx?versionid=${link.optionId}&strm=${link.strm}`,
    total_credits: totalCredits > 0 ? Math.round(totalCredits * 10) / 10 : null,
    gpa_minimum: null,
    description: String(meta.ProgramDescription ?? "").trim() || null,
    requirement_groups: groups,
    matched_program_slug: null,
  };
}

async function pmap<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      try {
        results[idx] = await fn(items[idx]);
      } catch (e) {
        console.error(`  pmap[${idx}] error: ${e}`);
        results[idx] = undefined as unknown as R;
      }
      if (DELAY_MS > 0) await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function main() {
  console.log("CCS (Spokane) program scraper");
  const listHtml = await fetchText(
    `${CATALOG_BASE}/CoursesAndPrograms/DegreesAndCertificates.aspx`,
  );
  const links = parseDegreeLinks(listHtml);
  const scc = links.filter((l) => l.college === "SCC").length;
  console.log(
    `Found ${links.length} programs (SCC ${scc}, SFCC ${links.length - scc})`,
  );
  if (links.length === 0) {
    throw new Error("No degree links parsed — page layout changed?");
  }

  let done = 0;
  const results = await pmap(links, CONCURRENCY, async (link) => {
    const program = await scrapeOption(link);
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${links.length}`);
    return { link, program };
  });

  for (const short of ["SCC", "SFCC"] as const) {
    const slug = COLLEGE_SLUGS[short];
    const programs = results
      .filter((r) => r && r.link.college === short && r.program)
      .map((r) => r.program!) as never[];
    if (programs.length === 0) {
      console.error(`  ⚠ ${slug}: 0 programs — not writing`);
      continue;
    }
    const { matched, unmatched } = applyProgramMatching(programs);
    console.log(`  ${slug}: ${programs.length} programs (matcher ${matched}/${matched + unmatched})`);
    const data: CollegePrograms = {
      college_slug: slug,
      catalog_year: "2025-2026",
      catalog_url: `${CATALOG_BASE}/CoursesAndPrograms/Default.aspx`,
      scraped_at: new Date().toISOString(),
      programs: programs as ProgramRequirement[],
    };
    const outDir = path.join(process.cwd(), "data", "wa", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`  ✓ Wrote ${outPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
