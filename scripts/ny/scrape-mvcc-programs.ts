/**
 * MVCC (Mohawk Valley CC) — OmniUpdate catalog → programs
 *
 * MVCC publishes 101 program pages at catalog.mvcc.edu/current/programs/*.php.
 * Each page lists required courses with inline prereq text. The course
 * descriptions section is PDF-only, so we extract prereqs from the program
 * pages instead (less comprehensive, but catches the most common chains).
 *
 * Strategy:
 *   1. Fetch program index at /current/programs/
 *   2. Walk each program detail page
 *   3. Extract program metadata (title, credential, required course codes)
 *   4. Extract inline prerequisite text where present
 *   5. Write programs to data/ny/programs/mvcc.json
 *   6. Merge any prereqs into data/ny/prereqs.json
 *
 * Usage:
 *   npx tsx scripts/ny/scrape-mvcc-programs.ts
 *   npx tsx scripts/ny/scrape-mvcc-programs.ts --limit=10
 */
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";
import { applyProgramMatching } from "../../lib/programs/matcher.js";

const BASE = "https://catalog.mvcc.edu/current/programs";
const UA = "Mozilla/5.0 (compatible; CommunityCollegePathBot/1.0)";
const DELAY_MS = 400;
const SLUG = "mvcc";
const STATE = "ny";

interface PrereqEntry { text: string; courses: string[]; }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchPage(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

function htmlToText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;?/g, " ")
    .replace(/&#160;?/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function detectCredential(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("a.a.s") || t.includes("associate in applied science")) return "AAS";
  if (t.includes("a.s.") || t.includes("associate in science")) return "AS";
  if (t.includes("a.a.") || t.includes("associate in arts")) return "AA";
  if (t.includes("certificate")) return "Certificate";
  return "Associate";
}

const BOILERPLATE = /^(none|not applicable|n\/a|no prerequisites?)\s*\.?\s*$/i;

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0", 10);

  console.log("MVCC catalog scraper (programs + inline prereqs)");
  console.log(`  Source: ${BASE}\n`);

  const indexHtml = await fetchPage(`${BASE}/`);
  const $idx = cheerio.load(indexHtml);
  const programUrls: string[] = [];
  $idx(`a[href*="/current/programs/"]`).each((_, el) => {
    const href = $idx(el).attr("href") || "";
    if (href.endsWith(".php") && !href.endsWith("index.php")) {
      const full = href.startsWith("http") ? href : `https://catalog.mvcc.edu${href}`;
      programUrls.push(full);
    }
  });
  const unique = [...new Set(programUrls)].sort();
  console.log(`  Found ${unique.length} program pages`);

  const outDir = path.join(process.cwd(), "data", STATE);
  const programsDir = path.join(outDir, "programs");
  fs.mkdirSync(programsDir, { recursive: true });

  const prereqsPath = path.join(outDir, "prereqs.json");
  let prereqs: Record<string, PrereqEntry> = {};
  if (fs.existsSync(prereqsPath)) {
    prereqs = JSON.parse(fs.readFileSync(prereqsPath, "utf-8"));
    console.log(`  Loaded ${Object.keys(prereqs).length} existing prereqs`);
  }

  const programs: Array<{
    title: string;
    credential: string;
    catalog_url: string;
    total_credits: number | null;
    description: string;
    requirement_groups: Array<{ name: string; courses: string[] }>;
    matched_program_slug: string | null;
  }> = [];

  let prereqsAdded = 0;
  const toProcess = limit > 0 ? unique.slice(0, limit) : unique;

  for (const url of toProcess) {
    try {
      const html = await fetchPage(url);
      const $ = cheerio.load(html);

      const title = $("h1").first().text().trim() || $("title").text().trim();
      if (!title) continue;

      const credential = detectCredential(title);

      const courseCodes = new Set<string>();
      const bodyText = $(".maincontent, #maincontent, .content, article").text();
      // MVCC uses EN101 format (no space). Normalize to EN 101.
      const codeRe = /\b([A-Z]{2,5})\s?(\d{3,4}[A-Z]?)\b/g;
      let m: RegExpExecArray | null;
      while ((m = codeRe.exec(bodyText)) !== null) {
        courseCodes.add(`${m[1]} ${m[2]}`);
      }

      // Extract prereqs from inline text
      const prereqBlocks = bodyText.match(/Prerequisite[^.]{5,300}\./gi) || [];
      for (const block of prereqBlocks) {
        const clean = block.replace(/^Prerequisite:?\s*/i, "").trim();
        if (!clean || BOILERPLATE.test(clean)) continue;

        const refCodes = new Set<string>();
        const cr = /\b([A-Z]{2,5})\s?(\d{3,4}[A-Z]?)\b/g;
        let cm: RegExpExecArray | null;
        while ((cm = cr.exec(clean)) !== null) {
          refCodes.add(`${cm[1]} ${cm[2]}`);
        }

        for (const code of refCodes) {
          if (!prereqs[code]) {
            // We know it's mentioned as a prereq but don't know for what course
            // from a program page. Skip — prereqs need the target course key.
          }
        }
      }

      // Dedicated prereq lines: "Prerequisite: EN101 ..." after a course heading
      $("p, li").each((_, el) => {
        const text = $(el).text().trim();
        const pm = text.match(/^Prerequisite:?\s+([A-Z]{2,5})\s?(\d{3,4}[A-Z]?)\s+(.{5,200})/i);
        if (!pm) return;
        // The text after the course code IS the prereq context for that course
        const targetCode = `${pm[1]} ${pm[2]}`;
        const prereqText = htmlToText(pm[3]).replace(/[.;,]\s*$/, "").trim();
        if (!prereqText || BOILERPLATE.test(prereqText)) return;

        const refs = new Set<string>();
        const cr2 = /\b([A-Z]{2,5})\s?(\d{3,4}[A-Z]?)\b/g;
        let cm2: RegExpExecArray | null;
        while ((cm2 = cr2.exec(prereqText)) !== null) {
          const c = `${cm2[1]} ${cm2[2]}`;
          if (c !== targetCode) refs.add(c);
        }

        if (!prereqs[targetCode]) {
          prereqs[targetCode] = { text: prereqText, courses: Array.from(refs).sort() };
          prereqsAdded++;
        }
      });

      programs.push({
        title,
        credential,
        catalog_url: url,
        total_credits: null,
        description: "",
        requirement_groups: courseCodes.size > 0
          ? [{ name: "Required Courses", courses: Array.from(courseCodes).sort() }]
          : [],
        matched_program_slug: null,
      });

      await sleep(DELAY_MS);
    } catch (e) {
      console.error(`  ERROR ${url}: ${(e as Error).message}`);
    }
  }

  // Write programs
  if (programs.length > 0) {
    const { matched, unmatched } = applyProgramMatching(programs);
    console.log(`  Matcher: ${matched} matched, ${unmatched} unmatched`);
    const programData = {
      college_slug: SLUG,
      catalog_year: "2025-2026",
      catalog_url: `${BASE}/`,
      scraped_at: new Date().toISOString(),
      programs,
    };
    const pOut = path.join(programsDir, `${SLUG}.json`);
    fs.writeFileSync(pOut, JSON.stringify(programData, null, 2));
    console.log(`  ✓ Wrote ${programs.length} programs to ${pOut}`);
  }

  // Write prereqs
  const sorted: Record<string, PrereqEntry> = {};
  for (const k of Object.keys(prereqs).sort()) sorted[k] = prereqs[k];
  fs.writeFileSync(prereqsPath, JSON.stringify(sorted, null, 2));
  console.log(`  ✓ +${prereqsAdded} prereqs from MVCC (total: ${Object.keys(sorted).length})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
