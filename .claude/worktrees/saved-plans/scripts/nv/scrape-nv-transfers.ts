/**
 * NV transfer equivalency scraper
 *
 * Builds transfer-equiv.json from two sources:
 *
 * 1. NSHE Common Course Numbering (CCN) — courses with the same prefix+number
 *    at multiple NV community colleges are guaranteed equivalent by Board of
 *    Regents policy. These become CC↔CC transfer rows.
 *
 * 2. Nevada State TES (webapps.nsc.edu/tes) — HTML tables listing how each
 *    CC course maps to a Nevada State University course. These become CC→NSU rows.
 *
 * Usage:
 *   npx tsx scripts/nv/scrape-nv-transfers.ts
 *   npx tsx scripts/nv/scrape-nv-transfers.ts --skip-tes    # CCN only
 *   npx tsx scripts/nv/scrape-nv-transfers.ts --skip-ccn    # TES only
 */

import * as fs from "fs";
import * as path from "path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DELAY_MS = 100;

interface TransferEquiv {
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

interface CourseSection {
  college_code: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
}

const COLLEGES: Record<string, { name: string; tesId: string }> = {
  "college-of-southern-nevada": {
    name: "College of Southern Nevada",
    tesId: "1100051187",
  },
  "great-basin-college": {
    name: "Great Basin College",
    tesId: "1100050836",
  },
  "truckee-meadows-community-college": {
    name: "Truckee Meadows Community College",
    tesId: "1100011340",
  },
  "western-nevada-college": {
    name: "Western Nevada College",
    tesId: "1100010220",
  },
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function retryFetch(url: string, label: string, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      });
      if (res.ok) return res.text();
      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return "";
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastErr}`);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Layer 1: CCN-derived CC↔CC transfers
// ---------------------------------------------------------------------------

function buildCCNTransfers(): TransferEquiv[] {
  const dataDir = path.join(process.cwd(), "data", "nv", "courses");
  const courseMap: Map<string, Array<{ slug: string; title: string; credits: number }>> = new Map();

  for (const slug of Object.keys(COLLEGES)) {
    const termDir = path.join(dataDir, slug);
    if (!fs.existsSync(termDir)) continue;
    const files = fs.readdirSync(termDir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      const sections: CourseSection[] = JSON.parse(
        fs.readFileSync(path.join(termDir, file), "utf-8"),
      );
      const seen = new Set<string>();
      for (const s of sections) {
        const key = `${s.course_prefix} ${s.course_number}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const arr = courseMap.get(key) || [];
        if (!arr.find((c) => c.slug === slug)) {
          arr.push({ slug, title: s.course_title, credits: s.credits });
          courseMap.set(key, arr);
        }
      }
    }
  }

  const transfers: TransferEquiv[] = [];
  const sharedCourses = Array.from(courseMap.entries())
    .filter(([, colleges]) => colleges.length >= 2)
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [courseKey, colleges] of sharedCourses) {
    const [prefix, number] = courseKey.split(" ");
    for (let i = 0; i < colleges.length; i++) {
      for (let j = 0; j < colleges.length; j++) {
        if (i === j) continue;
        const from = colleges[i];
        const to = colleges[j];
        transfers.push({
          cc_prefix: prefix,
          cc_number: number,
          cc_course: courseKey,
          cc_title: from.title,
          cc_credits: String(from.credits),
          university: to.slug,
          university_name: COLLEGES[to.slug].name,
          univ_course: courseKey,
          univ_title: to.title,
          univ_credits: String(to.credits),
          notes: "NSHE Common Course Numbering — guaranteed equivalent across system colleges",
          no_credit: false,
          is_elective: false,
        });
      }
    }
  }

  return transfers;
}

// ---------------------------------------------------------------------------
// Layer 2: Nevada State TES (CC→NSU)
// ---------------------------------------------------------------------------

function parseTESCourse(nsuRaw: string): {
  course: string;
  title: string;
  noCredit: boolean;
  isElective: boolean;
} {
  const cleaned = nsuRaw.trim();

  if (cleaned.includes("TRCRNOTRAN") || cleaned.includes("Non-Transferrable")) {
    return { course: "No Credit", title: "Non-Transferable", noCredit: true, isElective: false };
  }

  if (cleaned.includes("TRCRLDELEC") || cleaned.includes("General Transfer")) {
    return { course: "General Elective", title: "General Transfer Credit", noCredit: false, isElective: true };
  }

  const deptElective = cleaned.match(/^([A-Z]+)LDELEC\s*-\s*(.+)$/);
  if (deptElective) {
    return {
      course: `${deptElective[1]} Elective`,
      title: deptElective[2],
      noCredit: false,
      isElective: true,
    };
  }

  const direct = cleaned.match(/^([A-Z]+\d+[A-Z]?)\s*-\s*(.+)$/);
  if (direct) {
    const code = direct[1];
    const formatted = code.replace(/(\d)/, " $1");
    return { course: formatted, title: direct[2], noCredit: false, isElective: false };
  }

  return { course: cleaned, title: "", noCredit: false, isElective: false };
}

async function scrapeTES(): Promise<TransferEquiv[]> {
  const transfers: TransferEquiv[] = [];

  for (const [slug, { name, tesId }] of Object.entries(COLLEGES)) {
    console.log(`\n  📥 ${name} (TES ID: ${tesId})`);
    const html = await retryFetch(
      `https://webapps.nsc.edu/TES/Home/Details/${tesId}`,
      `tes-${slug}`,
    );
    if (!html) {
      console.log(`    ⚠ Empty response`);
      continue;
    }

    const tableMatch = html.match(
      /<table[^>]*class="table[^"]*"[^>]*>([\s\S]*?)<\/table>/,
    );
    if (!tableMatch) {
      console.log(`    ⚠ No table found`);
      continue;
    }

    const rows = tableMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) || [];
    let count = 0;
    let real = 0;

    for (const row of rows) {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g);
      if (!cells || cells.length < 2) continue;

      const ccRaw = stripHtml(cells[0]);
      const nsuRaw = stripHtml(cells[1]);

      const ccMatch = ccRaw.match(/^([A-Z]{2,5})\s+(\d{1,4}[A-Z]?)$/);
      if (!ccMatch) continue;

      const prefix = ccMatch[1];
      const number = ccMatch[2];
      const parsed = parseTESCourse(nsuRaw);
      count++;

      if (!parsed.noCredit) real++;

      transfers.push({
        cc_prefix: prefix,
        cc_number: number,
        cc_course: `${prefix} ${number}`,
        cc_title: "",
        cc_credits: "",
        university: "nsu",
        university_name: "Nevada State University",
        univ_course: parsed.course,
        univ_title: parsed.title,
        univ_credits: "",
        notes: `From ${name} via Nevada State TES`,
        no_credit: parsed.noCredit,
        is_elective: parsed.isElective,
      });
    }

    console.log(`    ${count} rows, ${real} transferable`);
    await sleep(DELAY_MS);
  }

  return transfers;
}

// ---------------------------------------------------------------------------
// Enrich CC titles/credits from course data
// ---------------------------------------------------------------------------

function enrichFromCourseData(transfers: TransferEquiv[]): void {
  const dataDir = path.join(process.cwd(), "data", "nv", "courses");
  const courseInfo: Map<string, { title: string; credits: number }> = new Map();

  for (const slug of Object.keys(COLLEGES)) {
    const termDir = path.join(dataDir, slug);
    if (!fs.existsSync(termDir)) continue;
    for (const file of fs.readdirSync(termDir).filter((f) => f.endsWith(".json"))) {
      const sections: CourseSection[] = JSON.parse(
        fs.readFileSync(path.join(termDir, file), "utf-8"),
      );
      for (const s of sections) {
        const key = `${s.course_prefix} ${s.course_number}`;
        if (!courseInfo.has(key)) {
          courseInfo.set(key, { title: s.course_title, credits: s.credits });
        }
      }
    }
  }

  let enriched = 0;
  for (const t of transfers) {
    const info = courseInfo.get(t.cc_course);
    if (info) {
      if (!t.cc_title) { t.cc_title = info.title; enriched++; }
      if (!t.cc_credits) t.cc_credits = String(info.credits);
    }
  }
  console.log(`  Enriched ${enriched} entries with course titles/credits`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const skipTes = args.includes("--skip-tes");
  const skipCcn = args.includes("--skip-ccn");

  console.log("NV transfer equivalency builder");

  const allTransfers: TransferEquiv[] = [];

  if (!skipCcn) {
    console.log("\n[1] Building CCN-derived CC↔CC transfers...");
    const ccnTransfers = buildCCNTransfers();
    console.log(`  ${ccnTransfers.length} CC↔CC transfer rows from CCN`);
    const uniqueCourses = new Set(ccnTransfers.map((t) => t.cc_course));
    console.log(`  ${uniqueCourses.size} unique courses shared across colleges`);
    allTransfers.push(...ccnTransfers);
  }

  if (!skipTes) {
    console.log("\n[2] Scraping Nevada State TES (CC→NSU)...");
    const tesTransfers = await scrapeTES();
    console.log(`\n  ${tesTransfers.length} total TES rows`);
    allTransfers.push(...tesTransfers);
  }

  enrichFromCourseData(allTransfers);

  const sorted = allTransfers.sort((a, b) => {
    const cmp = a.cc_course.localeCompare(b.cc_course);
    if (cmp !== 0) return cmp;
    return a.university.localeCompare(b.university);
  });

  const outDir = path.join(process.cwd(), "data", "nv");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "transfer-equiv.json");
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));

  const ccnCount = sorted.filter((t) => t.notes.includes("Common Course")).length;
  const tesCount = sorted.filter((t) => t.university === "nsu").length;
  console.log(`\n✓ Wrote ${sorted.length} transfer equivalencies to ${outPath}`);
  console.log(`  CCN (CC↔CC): ${ccnCount}`);
  console.log(`  TES (CC→NSU): ${tesCount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
