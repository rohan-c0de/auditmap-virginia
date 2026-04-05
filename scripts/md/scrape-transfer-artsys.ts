/**
 * scrape-transfer-artsys.ts
 *
 * Scrapes Maryland transfer equivalency data from ARTSYS (artsys.usmd.edu),
 * Maryland's statewide articulation system powered by Quottly.
 *
 * Fetches course-level transfer mappings for all 16 MD community colleges
 * to the top transfer destination universities via HTML table parsing.
 *
 * Usage:
 *   npx tsx scripts/md/scrape-transfer-artsys.ts
 *   npx tsx scripts/md/scrape-transfer-artsys.ts --university towson
 *   npx tsx scripts/md/scrape-transfer-artsys.ts --cc montgomery
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Institution IDs from ARTSYS
// ---------------------------------------------------------------------------

// Community colleges (teaching institutions)
const CC_IDS: Record<string, { id: number; name: string }> = {
  allegany: { id: 1725, name: "Allegany College of Maryland" },
  aacc: { id: 1726, name: "Anne Arundel Community College" },
  bccc: { id: 1730, name: "Baltimore City Community College" },
  carroll: { id: 4839, name: "Carroll Community College" },
  cecil: { id: 1736, name: "Cecil College" },
  chesapeake: { id: 1738, name: "Chesapeake College" },
  csm: { id: 1737, name: "College of Southern Maryland" },
  ccbc: { id: 5209, name: "Community College of Baltimore County" },
  frederick: { id: 1743, name: "Frederick Community College" },
  garrett: { id: 1745, name: "Garrett College" },
  hagerstown: { id: 1749, name: "Hagerstown Community College" },
  harford: { id: 1750, name: "Harford Community College" },
  howardcc: { id: 1752, name: "Howard Community College" },
  montgomery: { id: 1768, name: "Montgomery College" },
  pgcc: { id: 10259, name: "Prince George's Community College" },
  "wor-wic": { id: 1792, name: "Wor-Wic Community College" },
};

// Transfer destination universities (home institutions)
// Focusing on the top 8 by transfer volume
const UNIVERSITY_IDS: Record<string, { id: number; name: string }> = {
  towson: { id: 1781, name: "Towson University" },
  umcp: { id: 12646, name: "University of Maryland, College Park" },
  umbc: { id: 12645, name: "University of Maryland, Baltimore County" },
  umgc: { id: 1760, name: "University of Maryland Global Campus" },
  salisbury: { id: 1777, name: "Salisbury University" },
  "morgan-state": { id: 1769, name: "Morgan State University" },
  "bowie-state": { id: 1733, name: "Bowie State University" },
  frostburg: { id: 1744, name: "Frostburg State University" },
  // Additional universities
  "coppin-state": { id: 1740, name: "Coppin State University" },
  "u-baltimore": { id: 1731, name: "University of Baltimore" },
  umes: { id: 1765, name: "University of Maryland, Eastern Shore" },
  "st-marys": { id: 1778, name: "St. Mary's College of Maryland" },
};

interface TransferMapping {
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

const BASE_URL = "https://artsys.usmd.edu";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseCourseCode(text: string): {
  prefix: string;
  number: string;
  title: string;
} {
  // ARTSYS formats:
  //   "ACCT221 - ACCOUNTING I"
  //   "ACCT 221 - ACCOUNTING I"
  //   "BMGT220 - Principles Of Accounting I"
  //   "ACCT221HC - ACCOUNTING I-HONORS"
  //   "Lower Level Elective"
  const clean = text.trim();

  // Try "PREFIX[space?]NUMBER[suffix?] - TITLE"
  const match = clean.match(
    /^([A-Z]{2,6})\s*(\d{3,4}[A-Z]{0,3})\s*[-–]\s*(.+)$/i
  );
  if (match) {
    return {
      prefix: match[1].toUpperCase(),
      number: match[2],
      title: match[3].trim(),
    };
  }

  // Try just "PREFIX[space?]NUMBER" without title
  const simpleMatch = clean.match(/^([A-Z]{2,6})\s*(\d{3,4}[A-Z]{0,3})$/i);
  if (simpleMatch) {
    return {
      prefix: simpleMatch[1].toUpperCase(),
      number: simpleMatch[2],
      title: "",
    };
  }

  // Fallback: treat whole thing as title (e.g., "Lower Level Elective")
  return { prefix: "", number: "", title: clean };
}

function extractTdText(tdHtml: string): string {
  // ARTSYS wraps course info in <button> tags inside Stimulus controller divs.
  // The button tags have data-action attributes containing ">" which break
  // simple regex parsing. Strategy: strip all HTML tags first, then clean up
  // the Stimulus controller artifacts from the remaining text.

  // Strip all HTML tags (handles > inside attributes by using a more robust approach)
  let text = tdHtml;

  // Remove <dialog> blocks entirely (they contain modal templates, not data)
  text = text.replace(/<dialog[\s\S]*?<\/dialog>/gi, "");

  // Remove <svg> blocks
  text = text.replace(/<svg[\s\S]*?<\/svg>/gi, "");

  // Now strip remaining HTML tags
  text = text.replace(/<[^>]*>/g, " ");

  // Clean up Stimulus controller artifacts that leak through
  // Pattern: "click->content-loader-modal#open" or "content-loader-modal#backdropClose"
  text = text.replace(/click->[a-z-]+#[a-z]+/gi, "");
  text = text.replace(/content-loader-modal#\w+/gi, "");
  text = text.replace(/dialog-modal[a-z-]*/gi, "");

  // Clean whitespace and decode entities
  text = text.replace(/\s+/g, " ").trim();
  text = decodeEntities(text);

  // Remove leftover quotes and artifacts
  text = text.replace(/^["'>\s]+/, "").replace(/["'>\s]+$/, "");

  // If text has "See More" or "Course Details" or "Close dialog", extract just the first meaningful part
  if (text.includes("Course Details")) {
    text = text.split("Course Details")[0].trim();
  }
  if (text.includes("See More")) {
    text = text.split("See More")[0].trim();
  }

  return text;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseEquivalencyRows(html: string): {
  fromCourse: string;
  fromCredits: string;
  toCourse: string;
  dates: string;
}[] {
  const rows: {
    fromCourse: string;
    fromCredits: string;
    toCourse: string;
    dates: string;
  }[] = [];

  // Find the equivalencies table body
  const tbodyMatch = html.match(
    /<tbody[^>]*>([\s\S]*?)<\/tbody>/i
  );
  if (!tbodyMatch) return rows;

  const tbody = tbodyMatch[1];

  // Split by rows — ARTSYS uses <tr class="border-b-2 ...">
  const rowRegex = /<tr[^>]*class="[^"]*border-b[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tbody)) !== null) {
    const rowHtml = rowMatch[1];

    // Extract all <td> elements
    const tds: string[] = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      tds.push(extractTdText(tdMatch[1]));
    }

    // Expected: TD1=From Course, TD2=Credits, TD3=To Course, TD4=Dates, TD5=See More
    if (tds.length >= 4) {
      rows.push({
        fromCourse: tds[0] || "",
        fromCredits: tds[1] || "",
        toCourse: tds[2] || "",
        dates: tds[3] || "",
      });
    }
  }

  return rows;
}

function hasNextPage(html: string, currentPage: number): boolean {
  // Check for Pagy pagination — look for next page link
  const nextPagePattern = new RegExp(
    `page=${currentPage + 1}`,
    "i"
  );
  return nextPagePattern.test(html);
}

async function fetchEquivalencies(
  ccId: number,
  uniId: number,
  page: number = 1
): Promise<string> {
  const url = new URL(`${BASE_URL}/equivalencies`);
  url.searchParams.set("q[filter_by]", "uni");
  url.searchParams.set("q[teaching_university_id_eq]", ccId.toString());
  url.searchParams.set("q[home_university_id_eq]", uniId.toString());
  url.searchParams.set("q[effective_in_terms_range]", "-");
  url.searchParams.set("commit", "Search");
  url.searchParams.set("page_size", "100");
  url.searchParams.set("page", page.toString());

  const res = await fetch(url.toString(), { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url.toString()}`);
  }
  return res.text();
}

async function scrapeInstitutionPair(
  ccSlug: string,
  ccInfo: { id: number; name: string },
  uniSlug: string,
  uniInfo: { id: number; name: string }
): Promise<TransferMapping[]> {
  const mappings: TransferMapping[] = [];
  let page = 1;

  while (true) {
    const html = await fetchEquivalencies(ccInfo.id, uniInfo.id, page);
    const rows = parseEquivalencyRows(html);

    if (rows.length === 0) break;

    for (const row of rows) {
      const from = parseCourseCode(row.fromCourse);
      const to = parseCourseCode(row.toCourse);

      // Detect no-credit and elective mappings
      const toCourseUpper = row.toCourse.toUpperCase();
      const noCredit =
        toCourseUpper.includes("NO CREDIT") ||
        toCourseUpper.includes("NON-TRANSFERABLE") ||
        toCourseUpper.includes("NOT ACCEPTED") ||
        toCourseUpper.includes("DOES NOT TRANSFER");

      const isElective =
        !noCredit &&
        (toCourseUpper.includes("ELECTIVE") ||
          to.number.includes("XXX") ||
          to.number.includes("xxx") ||
          toCourseUpper.includes("FREE ELECT") ||
          toCourseUpper.includes("LOWER LEVEL") ||
          toCourseUpper.includes("UPPER LEVEL"));

      // Build univ_course string
      const univCourse =
        to.prefix && to.number
          ? `${to.prefix} ${to.number}`
          : row.toCourse.split(" - ")[0]?.trim() || row.toCourse;

      mappings.push({
        cc_prefix: from.prefix,
        cc_number: from.number,
        cc_course: from.prefix && from.number
          ? `${from.prefix} ${from.number}`
          : row.fromCourse.split(" - ")[0]?.trim() || "",
        cc_title: from.title,
        cc_credits: row.fromCredits.replace(/[^0-9.]/g, ""),
        university: uniSlug,
        university_name: uniInfo.name,
        univ_course: univCourse,
        univ_title: to.title,
        univ_credits: row.fromCredits.replace(/[^0-9.]/g, ""),
        notes: "",
        no_credit: noCredit,
        is_elective: isElective,
      });
    }

    // Check for next page
    if (!hasNextPage(html, page)) break;
    page++;
    await sleep(300); // Be polite between pages
  }

  return mappings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const uniFlag = args.indexOf("--university");
  const ccFlag = args.indexOf("--cc");

  // Determine which universities to scrape
  let targetUnis: [string, { id: number; name: string }][];
  if (uniFlag >= 0) {
    const slug = args[uniFlag + 1];
    const info = UNIVERSITY_IDS[slug];
    if (!info) {
      console.error(`Unknown university: ${slug}`);
      console.error(
        `Available: ${Object.keys(UNIVERSITY_IDS).join(", ")}`
      );
      process.exit(1);
    }
    targetUnis = [[slug, info]];
  } else {
    // Default: top 8 universities
    targetUnis = [
      ["towson", UNIVERSITY_IDS["towson"]],
      ["umcp", UNIVERSITY_IDS["umcp"]],
      ["umbc", UNIVERSITY_IDS["umbc"]],
      ["umgc", UNIVERSITY_IDS["umgc"]],
      ["salisbury", UNIVERSITY_IDS["salisbury"]],
      ["morgan-state", UNIVERSITY_IDS["morgan-state"]],
      ["bowie-state", UNIVERSITY_IDS["bowie-state"]],
      ["frostburg", UNIVERSITY_IDS["frostburg"]],
    ];
  }

  // Determine which CCs to scrape
  let targetCCs: [string, { id: number; name: string }][];
  if (ccFlag >= 0) {
    const slug = args[ccFlag + 1];
    const info = CC_IDS[slug];
    if (!info) {
      console.error(`Unknown CC: ${slug}`);
      console.error(`Available: ${Object.keys(CC_IDS).join(", ")}`);
      process.exit(1);
    }
    targetCCs = [[slug, info]];
  } else {
    targetCCs = Object.entries(CC_IDS);
  }

  const totalPairs = targetCCs.length * targetUnis.length;
  console.log(
    `Scraping ${targetCCs.length} CCs × ${targetUnis.length} universities = ${totalPairs} pairs\n`
  );

  const allMappings: TransferMapping[] = [];
  let pairsDone = 0;
  let pairsWithData = 0;

  for (const [uniSlug, uniInfo] of targetUnis) {
    console.log(`\n=== ${uniInfo.name} (${uniSlug}) ===`);

    for (const [ccSlug, ccInfo] of targetCCs) {
      pairsDone++;
      try {
        const mappings = await scrapeInstitutionPair(
          ccSlug,
          ccInfo,
          uniSlug,
          uniInfo
        );

        if (mappings.length > 0) {
          pairsWithData++;
          process.stdout.write(
            `  [${pairsDone}/${totalPairs}] ${ccInfo.name} → ${uniInfo.name}: ${mappings.length} equivalencies\n`
          );
          allMappings.push(...mappings);
        } else {
          process.stdout.write(
            `  [${pairsDone}/${totalPairs}] ${ccInfo.name} → ${uniInfo.name}: 0\n`
          );
        }
      } catch (e) {
        console.error(
          `  [${pairsDone}/${totalPairs}] ERROR ${ccInfo.name} → ${uniInfo.name}: ${e}`
        );
      }
      await sleep(500); // Be polite between requests
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Total pairs scraped: ${pairsDone}`);
  console.log(`  Pairs with data: ${pairsWithData}`);
  console.log(`  Total equivalencies: ${allMappings.length}`);

  // Deduplicate — same CC course might map to same uni course from multiple CCs
  // But we want to keep per-CC mappings since courses differ by college
  const uniqueKey = (m: TransferMapping) =>
    `${m.cc_prefix}|${m.cc_number}|${m.university}|${m.univ_course}`;
  const seen = new Set<string>();
  const deduped: TransferMapping[] = [];
  for (const m of allMappings) {
    const key = uniqueKey(m);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(m);
    }
  }
  console.log(`  After dedup: ${deduped.length} unique mappings`);

  // Write output
  const outPath = path.join(
    process.cwd(),
    "data",
    "md",
    "transfer-equiv.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2) + "\n");
  console.log(`\nWritten to ${outPath}`);

  // Stats by university
  const byUni = new Map<string, number>();
  for (const m of deduped) {
    byUni.set(m.university, (byUni.get(m.university) || 0) + 1);
  }
  console.log("\nBy university:");
  for (const [slug, count] of byUni) {
    console.log(`  ${slug}: ${count}`);
  }

  // Stats by type
  const directMatches = deduped.filter(
    (m) => !m.no_credit && !m.is_elective
  ).length;
  const electives = deduped.filter(
    (m) => !m.no_credit && m.is_elective
  ).length;
  const noCredit = deduped.filter((m) => m.no_credit).length;
  console.log(`\nBy type:`);
  console.log(`  Direct matches: ${directMatches}`);
  console.log(`  Elective only: ${electives}`);
  console.log(`  No credit: ${noCredit}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
