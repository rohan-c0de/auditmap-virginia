/**
 * Pearl River CC — bookstore-derived course catalog scraper.
 *
 * PRCC's actual SIS (Banner Extensibility at banss-p.prcc.edu:8101) is
 * SAML-gated for guests, so we can't reach class data through it. The
 * **bookstore** at bookstore.prcc.edu (WebPRISM platform), however,
 * exposes its term→department→course cascade as public XML for textbook
 * adoptions, with no authentication.
 *
 * The bookstore aggregates physical sections that share a textbook
 * adoption into a single "section" entry per course (typically labelled
 * "Online / All"), so what we get is closer to "courses offered this
 * term" than the per-section granularity the other MS scrapers provide.
 * We emit one section row per (term, course) so PRCC at least shows up
 * in cross-college search results and the planner — strictly better
 * than the previous all-or-nothing ceiling.
 *
 * Endpoints (under bookstore.prcc.edu):
 *   GET /buy_textbooks.asp                     → terms in <select id=fTerm>
 *   GET /textbooks_xml.asp?control=campus&campus=<id>&term=<id>
 *                                              → departments
 *   GET /textbooks_xml.asp?control=department&dept=<id>&term=<id>
 *                                              → courses
 *   GET /textbooks_xml.asp?control=course&course=<id>&term=<id>
 *                                              → sections (textbook adoptions)
 *
 * The site fronts Imperva, which serves a JS challenge on the very first
 * request and then accepts a `x-bni-fpc` cookie. We prime the cookie jar
 * by loading buy_textbooks.asp once with a real browser UA before
 * issuing any XML calls.
 *
 * Usage:
 *   npx tsx scripts/ms/scrape-prcc-bookstore.ts
 *   npx tsx scripts/ms/scrape-prcc-bookstore.ts --no-import
 */
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

const STATE = "ms";
const SLUG = "pearl-river-community-college";
const BASE = "https://bookstore.prcc.edu";
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

interface Term {
  // WebPRISM term-select option values are "<campusId>|<termId>".
  campusId: string;
  termId: string;
  label: string; // "ALL - Summer 2026 All Campuses and Online"
}

function normalizeTermLabel(label: string): string {
  // "ALL - Summer 2026 All Campuses and Online" → "2026SU"
  const m = label.match(/(Fall|Spring|Summer|Winter)\s+(\d{4})/i);
  if (!m) return label.replace(/\s+/g, "_");
  const season = m[1].toLowerCase();
  const year = m[2];
  const code = season.startsWith("fa") ? "FA" : season.startsWith("sp") ? "SP" : season.startsWith("su") ? "SU" : "WI";
  return `${year}${code}`;
}

function parseCourseRef(raw: string): { prefix: string; number: string } | null {
  // "ACC 2213" → ACC, 2213; "ENG 1113" → ENG, 1113.
  const m = (raw || "").trim().match(/^([A-Z]{2,5})\s+(\d+[A-Z]*)$/);
  return m ? { prefix: m[1], number: m[2] } : null;
}

class BookstoreClient {
  private cookies = "";

  async prime(): Promise<void> {
    const res = await fetch(`${BASE}/buy_textbooks.asp`, {
      headers: { "User-Agent": UA, Accept: "text/html" },
    });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    this.cookies = setCookies.map((c) => c.split(";")[0]).join("; ");
    if (!res.ok) throw new Error(`Failed to prime cookies: HTTP ${res.status}`);
  }

  async listTerms(): Promise<Term[]> {
    const res = await fetch(`${BASE}/buy_textbooks.asp`, {
      headers: { "User-Agent": UA, Cookie: this.cookies },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} loading term list`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const terms: Term[] = [];
    $('select#fTerm option').each((_, opt) => {
      const value = ($(opt).attr("value") || "").trim();
      const label = $(opt).text().trim();
      const m = value.match(/^(\d+)\|(\d+)$/);
      if (m && parseInt(m[2], 10) > 0) {
        terms.push({ campusId: m[1], termId: m[2], label });
      }
    });
    return terms;
  }

  private async getXml(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Cookie: this.cookies,
        Referer: `${BASE}/buy_textbooks.asp`,
        Accept: "text/xml",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const body = await res.text();
    // Imperva challenges sometimes return HTML with the cookie embedded —
    // re-prime and retry once.
    if (!body.trimStart().startsWith("<?xml") && body.includes("Object Moved")) {
      // The challenge served a one-shot cookie via JS; copy any new Set-Cookies.
      const sc = res.headers.getSetCookie?.() ?? [];
      if (sc.length) this.cookies = [this.cookies, ...sc.map((c) => c.split(";")[0])].filter(Boolean).join("; ");
      const res2 = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Cookie: this.cookies,
          Referer: `${BASE}/buy_textbooks.asp`,
          Accept: "text/xml",
        },
      });
      return res2.text();
    }
    return body;
  }

  async getDepartments(campusId: string, termId: string): Promise<Array<{ id: string; name: string }>> {
    const xml = await this.getXml(`${BASE}/textbooks_xml.asp?control=campus&campus=${campusId}&term=${termId}`);
    const $ = cheerio.load(xml, { xmlMode: true });
    const out: Array<{ id: string; name: string }> = [];
    $("department").each((_, el) => {
      out.push({ id: $(el).attr("id") || "", name: $(el).attr("name") || "" });
    });
    return out;
  }

  async getCourses(deptId: string, termId: string): Promise<Array<{ id: string; name: string }>> {
    const xml = await this.getXml(`${BASE}/textbooks_xml.asp?control=department&dept=${deptId}&term=${termId}`);
    const $ = cheerio.load(xml, { xmlMode: true });
    const out: Array<{ id: string; name: string }> = [];
    $("course").each((_, el) => {
      out.push({ id: $(el).attr("id") || "", name: $(el).attr("name") || "" });
    });
    return out;
  }

  async getSections(courseId: string, termId: string): Promise<Array<{ id: string; name: string; instructor: string }>> {
    const xml = await this.getXml(`${BASE}/textbooks_xml.asp?control=course&course=${courseId}&term=${termId}`);
    const $ = cheerio.load(xml, { xmlMode: true });
    const out: Array<{ id: string; name: string; instructor: string }> = [];
    $("section").each((_, el) => {
      out.push({
        id: $(el).attr("id") || "",
        name: $(el).attr("name") || "",
        instructor: $(el).attr("instructor") || "",
      });
    });
    return out;
  }
}

async function main() {
  const noImport = process.argv.includes("--no-import");
  console.log("PRCC bookstore-derived course catalog scraper");
  console.log(`   Source: ${BASE}/textbooks_xml.asp`);
  console.log("   Note: bookstore aggregates physical sections by textbook adoption.");

  const client = new BookstoreClient();
  await client.prime();
  const terms = await client.listTerms();
  console.log(`   Terms: ${terms.map((t) => t.label).join(" | ")}`);

  const outDir = path.join(process.cwd(), "data", STATE, "courses", SLUG);
  fs.mkdirSync(outDir, { recursive: true });

  let grand = 0;
  for (const term of terms) {
    const termKey = normalizeTermLabel(term.label);
    const depts = await client.getDepartments(term.campusId, term.termId);
    console.log(`  ${termKey}: ${depts.length} departments`);
    const sections: CourseSection[] = [];
    for (const dept of depts) {
      let courses: Array<{ id: string; name: string }> = [];
      try {
        courses = await client.getCourses(dept.id, term.termId);
      } catch (err) {
        console.error(`    ${dept.name}: ERROR ${(err as Error).message}`);
        continue;
      }
      for (const course of courses) {
        const ref = parseCourseRef(course.name);
        if (!ref) continue;
        let sects: Array<{ id: string; name: string; instructor: string }> = [];
        try {
          sects = await client.getSections(course.id, term.termId);
        } catch {
          sects = [{ id: course.id, name: "Online", instructor: "All" }];
        }
        if (sects.length === 0) sects = [{ id: course.id, name: "Online", instructor: "All" }];
        for (const s of sects) {
          const isOnline = /online|web|virtual/i.test(s.name);
          sections.push({
            college_code: SLUG,
            term: termKey,
            course_prefix: ref.prefix,
            course_number: ref.number,
            // We have no course title from the bookstore — use the course
            // code itself as a fallback. (The bookstore's textbook adoption
            // record only has the course code, no description.)
            course_title: `${ref.prefix} ${ref.number}`,
            credits: 0,
            crn: `${ref.prefix}-${ref.number}-${s.id}`,
            days: "",
            start_time: "",
            end_time: "",
            start_date: "",
            location: isOnline ? "Online" : dept.name,
            campus: dept.name,
            mode: isOnline ? "online" : "in-person",
            instructor: s.instructor && s.instructor !== "All" ? s.instructor : null,
            seats_open: null,
            seats_total: null,
            prerequisite_text: null,
            prerequisite_courses: [],
          });
        }
      }
    }
    // Dedup by CRN to be safe (depts can occasionally cross-list).
    const seen = new Map<string, CourseSection>();
    for (const s of sections) seen.set(s.crn, s);
    const unique = Array.from(seen.values());
    if (unique.length === 0) {
      console.log(`  ${termKey}: 0 sections`);
      continue;
    }
    const outPath = path.join(outDir, `${termKey}.json`);
    fs.writeFileSync(outPath, JSON.stringify(unique, null, 2) + "\n");
    console.log(`  ${termKey}: ${unique.length} sections → ${path.relative(process.cwd(), outPath)}`);
    grand += unique.length;
  }
  console.log(`\n${SLUG}: ${grand} total sections`);
  if (noImport) console.log("   (--no-import)");
}

main().catch((err) => {
  console.error("PRCC bookstore scraper failed:", err);
  process.exit(1);
});
