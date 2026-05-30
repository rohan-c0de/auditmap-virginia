/**
 * scrape-catalog-prereqs.ts
 *
 * Scrapes VCCS's master course outline page at
 * https://courses.vccs.edu/courses/outlines to extract prerequisites
 * for every active course in Virginia's 23-college community college
 * system.
 *
 * VCCS uses common course numbering: every course code (ENG 111,
 * MTH 162, etc.) is identical across all 23 colleges. The outlines
 * page lists every active course in a single HTML document with
 * `<details>` blocks, making this a single-fetch scraper — no
 * pagination, no per-college logic.
 *
 * The existing Banner SSB scraper (scripts/va/scrape-vccs.ts) only
 * embeds prereqs when the section-level endpoint returns them, which
 * gives ~14% coverage. This catalog scrape fills the gap.
 *
 * Output: data/va/prereqs.json keyed by "${PREFIX} ${NUMBER}".
 *
 * Usage:
 *   npx tsx scripts/va/scrape-catalog-prereqs.ts
 */

import * as fs from "fs";
import * as path from "path";

const URL = "https://courses.vccs.edu/courses/outlines";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface PrereqEntry {
  text: string;
  courses: string[];
}

function htmlToText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;?/g, " ")
    .replace(/&#160;?/g, " ")
    .replace(/&#(\d+);?/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;,]\s*$/, "")
    .trim();
}

async function main() {
  console.log("VCCS catalog prereq scraper");
  console.log(`  Source: ${URL}\n`);

  const res = await fetch(URL, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  console.log(`  Fetched ${(html.length / 1024).toFixed(0)} KB`);

  // Each course is a <details> block:
  //   <details><summary id="ENG-111"><a href="...">ENG 111 - Title</a></summary>
  //   <div class="detailsDescription ...">
  //     <div class="coursedesc">...</div>
  //     <div class="endtext">...Prerequisites: <a href="/courses/MTH162">MTH 162</a>...</div>
  //     <div class="credits">...</div>
  //   </div></details>
  const blockRe = /<details><summary id="([A-Z]+-\d+[A-Z]?)"[^>]*>[\s\S]*?<\/details>/g;
  const prereqs: Record<string, PrereqEntry> = {};
  let totalCourses = 0;
  let withPrereqs = 0;

  let match;
  while ((match = blockRe.exec(html)) !== null) {
    totalCourses++;
    const block = match[0];
    const courseId = match[1]; // e.g. "ENG-111"
    const courseCode = courseId.replace("-", " "); // "ENG 111"

    // Extract the endtext div which contains prereqs
    const endtextMatch = block.match(
      /<div class="endtext">([\s\S]*?)<\/div>/,
    );
    if (!endtextMatch) continue;
    const endtext = endtextMatch[1];

    // Extract prereq portion — everything after "Prerequisite(s):" up to
    // "Corequisite:" or end of the div content.
    const prereqMatch = endtext.match(
      /Pre-?requisites?\s*:\s*([\s\S]*?)(?=\s*Co-?requisites?\s*:|$)/i,
    );
    if (!prereqMatch) continue;

    const rawPrereq = prereqMatch[1];

    // Extract linked course codes from <a href="/courses/XXX###">
    const courses = new Set<string>();
    const linkRe = /href="\/courses\/([A-Z]+)(\d+[A-Z]?)(?:-[^"]*)?"/g;
    let linkMatch;
    while ((linkMatch = linkRe.exec(rawPrereq)) !== null) {
      const code = `${linkMatch[1]} ${linkMatch[2]}`;
      if (code !== courseCode) courses.add(code);
    }

    const text = htmlToText(rawPrereq);
    if (!text) continue;

    // Also extract course codes from plain text (not all are linked)
    const codeRe = /\b([A-Z]{2,5})\s+(\d{3,4}[A-Z]?)\b/g;
    let codeMatch;
    while ((codeMatch = codeRe.exec(text)) !== null) {
      const code = `${codeMatch[1]} ${codeMatch[2]}`;
      if (code !== courseCode) courses.add(code);
    }

    prereqs[courseCode] = {
      text,
      courses: Array.from(courses).sort(),
    };
    withPrereqs++;
  }

  console.log(`  Total courses: ${totalCourses}`);
  console.log(`  With prerequisites: ${withPrereqs}`);
  console.log(
    `  Coverage: ${((withPrereqs / totalCourses) * 100).toFixed(1)}%`,
  );

  // Merge with existing section-derived prereqs. Catalog text is more
  // authoritative (system-wide vs per-section), so catalog wins on overlap.
  const outDir = path.join(process.cwd(), "data", "va");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "prereqs.json");
  let existing: Record<string, PrereqEntry> = {};
  if (fs.existsSync(outPath)) {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  }

  const merged: Record<string, PrereqEntry> = { ...existing };
  let newFromCatalog = 0;
  let upgraded = 0;
  for (const [key, entry] of Object.entries(prereqs)) {
    if (!merged[key]) {
      merged[key] = entry;
      newFromCatalog++;
    } else {
      merged[key] = entry;
      upgraded++;
    }
  }
  console.log(`  Merged: ${newFromCatalog} new from catalog, ${upgraded} upgraded, ${Object.keys(existing).length - upgraded} kept from sections`);

  // Sort keys
  const sorted: Record<string, PrereqEntry> = {};
  for (const key of Object.keys(merged).sort()) {
    sorted[key] = merged[key];
  }

  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2));
  console.log(`\n✓ Wrote ${Object.keys(sorted).length} prereqs to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
