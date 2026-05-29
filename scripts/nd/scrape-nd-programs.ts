/**
 * scrape-nd-programs.ts — North Dakota community college programs/majors.
 *
 * Extracts degree program listings from BSC CourseLeaf and WSC Acalog catalogs.
 *
 * Platforms covered:
 *   • Bismarck State College — CourseLeaf
 *       catalog.bismarckstate.edu/catalog/degrees/ (table of all programs)
 *   • Williston State College — Acalog
 *       catalog.willistonstate.edu/content.php?catoid=1&navoid=XXX
 *
 * Deferred (Cloudflare WAF or PDF-only):
 *   • Dakota College at Bottineau — Cleancatalog
 *   • North Dakota State College of Science — Cleancatalog
 *   • Lake Region State College — PDF-only
 *
 * Output: data/nd/programs/{college}.json
 * Each file: [ { name, category, degrees, slug } ]
 *
 * Usage:
 *   npx tsx scripts/nd/scrape-nd-programs.ts
 *   npx tsx scripts/nd/scrape-nd-programs.ts --college=bsc
 */

import * as fs from "fs";
import * as path from "path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DELAY_MS = 100;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Program {
  name: string;
  category: string;
  degrees: string[];
  slug: string;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function retryFetch(url: string, label: string, attempts = 3): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      });
      if (res.ok) return res.text();
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return ""; // 404 — silently skip
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  console.error(`  ${label} failed after ${attempts}: ${lastErr}`);
  return "";
}

// ---------------------------------------------------------------------------
// BSC CourseLeaf Programs
// ---------------------------------------------------------------------------

const BSC_BASE = "https://catalog.bismarckstate.edu";

async function scrapeBscPrograms(): Promise<Program[]> {
  console.log("\n── BSC (CourseLeaf) ──────────────────────");
  const html = await retryFetch(`${BSC_BASE}/catalog/degrees/`, "bsc-programs");
  if (!html) return [];

  const programs: Program[] = [];
  const seen = new Set<string>();

  // Extract the programs table
  const tableMatch = html.match(
    /<table[^>]*tbl_bismarckstate_degrees[^>]*>[\s\S]*?<\/table>/i
  );
  if (!tableMatch) {
    console.error("  Could not find programs table");
    return [];
  }

  const tableHtml = tableMatch[0];

  // Parse each row: extract link (with slug), category, and degree columns
  // Pattern: <tr><td><a href=".../{slug}/">Name</a></td><td>Category</td><td>...</td>...
  const rows = tableHtml.split(/<tr[^>]*>/);

  for (const row of rows) {
    if (!row.includes("</tr>")) continue;
    if (row.includes("sctablehead")) continue; // Skip header rows

    // Extract program link
    const linkMatch = row.match(
      /<a[^>]*href="\/catalog\/degrees\/([^/"]+)\/[^"]*"[^>]*>([^<]+)<\/a>/
    );
    if (!linkMatch) continue;

    const slug = linkMatch[1];
    const name = linkMatch[2].trim();

    if (seen.has(name)) continue;
    seen.add(name);

    // Extract category (second cell after program name)
    const cells = row.split(/<\/?td[^>]*>/);
    const category = cells.length > 2 ? cells[2].trim() : "Academic Program";

    // Find degree columns by looking for bullet marks (•) in the row
    // Degree order in table: BAS, AA, AS, AAS, Dipl, Cert, COC
    const degreeOrder = ["BAS", "AA", "AS", "AAS", "Dipl", "Cert", "COC"];
    const degrees: string[] = [];

    // Split by <td> and look for bullets in cells 2-8 (degree columns)
    const cellsWithContent = row.match(/<td[^>]*>(.*?)<\/td>/g) || [];
    for (let i = 0; i < Math.min(degreeOrder.length, cellsWithContent.length - 2); i++) {
      const cellContent = cellsWithContent[i + 2] || "";
      if (cellContent.includes("•")) {
        degrees.push(degreeOrder[i]);
      }
    }

    programs.push({
      name,
      category,
      degrees: degrees.length > 0 ? degrees : ["AA", "AS"],
      slug,
    });

    await sleep(DELAY_MS);
  }

  console.log(`  ${programs.length} programs found`);
  return programs;
}

// ---------------------------------------------------------------------------
// WSC Acalog Programs
// ---------------------------------------------------------------------------

const WSC_BASE = "https://catalog.willistonstate.edu";
const WSC_CATOID = 1;

interface AcalogProgram {
  name: string;
  navoid: string;
}

async function discoverWscPrograms(): Promise<AcalogProgram[]> {
  // List programs page — typically at a high-level navoid
  const html = await retryFetch(
    `${WSC_BASE}/content.php?catoid=${WSC_CATOID}&navoid=1`,
    "wsc-programs-index"
  );
  if (!html) return [];

  const programs: AcalogProgram[] = [];
  const seen = new Set<string>();

  // Look for program links in Acalog's navigation structure
  // Pattern: <a href=".../navoid=NNN...">Program Name</a>
  const linkMatches = html.matchAll(
    /href="[^"]*navoid=(\d+)[^"]*"[^>]*>([^<]+(?:Associate|Degree|Program|Major)[^<]*)<\/a>/gi
  );

  for (const match of linkMatches) {
    const navoid = match[1];
    const name = match[2].trim();

    // Filter out nav items that aren't programs
    if (
      /^(course|content|program|degree|major)/i.test(name) &&
      !seen.has(name)
    ) {
      seen.add(name);
      programs.push({ name, navoid });
    }
  }

  return programs;
}

async function scrapeWscPrograms(): Promise<Program[]> {
  console.log("\n── WSC (Acalog) ──────────────────────────");

  const discovered = await discoverWscPrograms();
  console.log(`  Discovered ${discovered.length} potential programs`);

  const programs: Program[] = [];
  const seen = new Set<string>();

  for (const prog of discovered) {
    if (seen.has(prog.name)) continue;
    seen.add(prog.name);

    // Classify degree type by name heuristic
    let degrees: string[] = [];
    if (prog.name.toLowerCase().includes("certificate")) {
      degrees = ["Cert"];
    } else if (prog.name.toLowerCase().includes("diploma")) {
      degrees = ["Dipl"];
    } else {
      degrees = ["AA", "AS"]; // Default for community college
    }

    const slug = prog.name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");

    programs.push({
      name: prog.name,
      category: "Academic Program",
      degrees,
      slug,
    });

    await sleep(DELAY_MS);
  }

  console.log(`  ${programs.length} programs extracted`);
  return programs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const collegeArg = args.find((a) => a.startsWith("--college="))?.split("=")[1] || "all";

  console.log("ND Programs Scraper (BSC + WSC)");
  console.log(`  scope: ${collegeArg}`);

  const merged: Record<string, Program[]> = {};
  let bscCount = 0,
    wscCount = 0;

  if (collegeArg === "all" || collegeArg === "bsc") {
    const bsc = await scrapeBscPrograms();
    bscCount = bsc.length;
    merged["bismarck-state-college"] = bsc;
  }

  if (collegeArg === "all" || collegeArg === "wsc") {
    const wsc = await scrapeWscPrograms();
    wscCount = wsc.length;
    merged["williston-state-college"] = wsc;
  }

  const outDir = path.join(process.cwd(), "data", "nd", "programs");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const [college, programs] of Object.entries(merged)) {
    const outPath = path.join(outDir, `${college}.json`);
    fs.writeFileSync(outPath, JSON.stringify(programs, null, 2) + "\n");
    console.log(`  ✓ ${college}: ${programs.length} programs → ${outPath}`);
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`BSC: ${bscCount} programs`);
  console.log(`WSC: ${wscCount} programs`);
  console.log(`Total: ${bscCount + wscCount} unique program entries`);
  console.log(`→ ${outDir}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
