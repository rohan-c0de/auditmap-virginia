/**
 * scrape-lrsc-programs.ts — Lake Region State College programs.
 *
 * LRSC publishes programs via their /all-programs HTML page.
 * Programs are listed as links with descriptive names and categorization.
 *
 * Output: data/nd/programs/lake-region-state-college.json
 * Each entry: { name, category, degrees, slug }
 *
 * Usage:
 *   npx tsx scripts/nd/scrape-lrsc-programs.ts
 */

import * as fs from "fs";
import * as path from "path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DELAY_MS = 50;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Program {
  name: string;
  category: string;
  degrees: string[];
  slug: string;
}

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
        return "";
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500 * Math.pow(2, i));
  }
  console.error(`  ${label} failed after ${attempts}: ${lastErr}`);
  return "";
}

async function scrapeLrscPrograms(): Promise<Program[]> {
  console.log("\n── LRSC (HTML all-programs) ──────────────");

  const html = await retryFetch("https://www.lrsc.edu/all-programs", "lrsc-programs");
  if (!html) return [];

  const programs: Program[] = [];
  const seen = new Set<string>();

  // Extract program links: <a href="/programs/{slug}" hreflang="en">Program Name</a>
  // Pattern: /programs/[a-z0-9-]+ followed by the program name
  const programMatches = html.matchAll(
    /<a href="\/programs\/([a-z0-9-]+)"[^>]*>\s*([^<]+)\s*<\/a>/gi
  );

  for (const match of programMatches) {
    const slug = match[1];
    const name = match[2].trim();

    if (!name || seen.has(name)) continue;
    seen.add(name);

    // Classify degree type by name
    let degrees: string[] = [];
    const nameLower = name.toLowerCase();

    if (nameLower.includes("certificate")) {
      degrees = ["Cert"];
    } else if (nameLower.includes("diploma")) {
      degrees = ["Dipl"];
    } else if (nameLower.includes("associate")) {
      degrees = ["AAS", "AA"];
    } else if (nameLower.includes("transfer") || nameLower.includes("liberal")) {
      degrees = ["AA", "AS"];
    } else {
      // Default for LRSC: career/technical programs are mostly AAS
      degrees = ["AAS"];
    }

    programs.push({
      name,
      category: "Academic Program",
      degrees,
      slug,
    });

    await sleep(DELAY_MS);
  }

  console.log(`  ${programs.length} programs extracted`);
  return programs;
}

async function main() {
  console.log("LRSC Programs Scraper");

  const programs = await scrapeLrscPrograms();

  const outDir = path.join(process.cwd(), "data", "nd", "programs");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, "lake-region-state-college.json");
  fs.writeFileSync(outPath, JSON.stringify(programs, null, 2) + "\n");

  console.log(`\n${"=".repeat(50)}`);
  console.log(`LRSC: ${programs.length} programs`);
  console.log(`→ ${outPath}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
