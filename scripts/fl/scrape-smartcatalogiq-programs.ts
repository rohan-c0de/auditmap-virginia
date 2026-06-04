/**
 * scrape-smartcatalogiq-programs.ts — FL SmartCatalogIQ program scraper.
 *
 * Reads data/fl/catalog-discovery.json (produced by discover-catalogs.ts),
 * filters the colleges fingerprinted as `smartcatalogiq`, and scrapes each
 * with the shared SmartCatalogIQ template. catalogYear / catalogPath are
 * auto-discovered from the catalog homepage so next year's edition is picked
 * up without a code change.
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-smartcatalogiq-programs.ts
 *   npx tsx scripts/nc/scrape-smartcatalogiq-programs.ts --college bladen
 */
import * as fs from "fs";
import * as path from "path";
import { scrapeSmartCatalogIqPrograms } from "../lib/scrape-smartcatalogiq-programs.js";
import { applyProgramMatching } from "../../lib/programs/matcher.js";

interface Discovery {
  slug: string;
  domain: string;
  platform: string;
  catalogUrl: string | null;
}

function baseFromUrl(u: string): string {
  const m = u.match(/^https?:\/\/[^/]+/);
  return m ? m[0] : u.replace(/\/$/, "");
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Detect catalog year, catalog path, and the programs section path by reading
 * the catalog landing page's TOC. SmartCatalogIQ instances name the programs
 * section inconsistently (programs-of-study, curriculum-programs-of-study,
 * academic-programs, program-areas-of-study, …) — scan for it rather than guess.
 */
async function detectCatalog(
  baseUrl: string
): Promise<{ catalogYear: string; catalogPath: string; programsPaths: string[] } | null> {
  try {
    // Step 1: from the root, find the latest catalog year + catalogPath.
    const rootHtml = await (
      await fetch(baseUrl, { headers: { "User-Agent": UA }, redirect: "follow" })
    ).text();
    const yre = /\/en\/(\d{4}-\d{4})\/([^/"'#?]+)/g;
    const editions: { year: string; cat: string }[] = [];
    let ym;
    while ((ym = yre.exec(rootHtml)) !== null) editions.push({ year: ym[1], cat: ym[2] });
    if (editions.length === 0) return null;
    editions.sort((a, b) => b.year.localeCompare(a.year));
    const { year, cat: catalogPath } = editions[0];

    // Step 2: fetch that edition's index, collect its top-level sections.
    const idxHtml = await (
      await fetch(`${baseUrl}/en/${year}/${catalogPath}/`, {
        headers: { "User-Agent": UA },
        redirect: "follow",
      })
    ).text();
    const sre = new RegExp(`/en/${year}/${catalogPath}/([^/"'#?]+)`, "g");
    const secSet = new Set<string>();
    let sm;
    while ((sm = sre.exec(idxHtml)) !== null) secSet.add(sm[1]);
    // Candidate program sections by name; reject the courses index outright.
    const candidates = [...secSet].filter((s) => {
      const t = s.toLowerCase();
      if (/^courses?$/.test(t) || (/course/.test(t) && !/program/.test(t))) return false;
      return /program|curriculum|of-study|degree|certificate/.test(t);
    });
    if (candidates.length === 0) return null;
    // Probe each candidate for actual child-link count. Some catalogs keep all
    // programs under one parent (e.g. "2026-2027-programs"); others split them
    // across award-type siblings (associate-…-degrees, diplomas, certificates).
    // Keep EVERY section that has program children and walk them all, so split
    // catalogs aren't truncated to a single award type.
    const populated: string[] = [];
    for (const sec of candidates) {
      try {
        const html = await (
          await fetch(`${baseUrl}/en/${year}/${catalogPath}/${sec}/`, {
            headers: { "User-Agent": UA },
            redirect: "follow",
          })
        ).text();
        const childRe = new RegExp(`/en/${year}/${catalogPath}/${sec}/[^/"'#?]+`, "g");
        const count = new Set(html.match(childRe) ?? []).size;
        if (count > 0) populated.push(sec);
      } catch { /* skip */ }
    }
    if (populated.length === 0) return null;
    return { catalogYear: year, catalogPath, programsPaths: populated };
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const collegeArg =
    args.find((a) => a.startsWith("--college="))?.split("=")[1] ||
    (args.indexOf("--college") >= 0 ? args[args.indexOf("--college") + 1] : null);

  const disc: Discovery[] = JSON.parse(
    fs.readFileSync("data/fl/catalog-discovery.json", "utf8")
  );
  let colleges = disc.filter((d) => d.platform === "smartcatalogiq" && d.catalogUrl);
  if (collegeArg) colleges = colleges.filter((c) => c.slug === collegeArg);

  const outDir = path.join(process.cwd(), "data", "fl", "programs");
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`FL SmartCatalogIQ program scraper — ${colleges.length} college(s)\n`);
  let totalPrograms = 0;
  const summary: { slug: string; programs: number; matched: number }[] = [];

  for (const c of colleges) {
    console.log(`\n${"=".repeat(60)}\nScraping ${c.slug} (${c.catalogUrl})\n${"=".repeat(60)}`);
    try {
      const base = baseFromUrl(c.catalogUrl!);
      const det = await detectCatalog(base);
      if (det) console.log(`  detected: year=${det.catalogYear} path=${det.catalogPath} sections=[${det.programsPaths.join(", ")}]`);

      let data;
      if (det && det.programsPaths.length > 0) {
        // Walk every populated program section and merge (dedup by url/title).
        const merged: Awaited<ReturnType<typeof scrapeSmartCatalogIqPrograms>>["programs"] = [];
        const seen = new Set<string>();
        let meta: Awaited<ReturnType<typeof scrapeSmartCatalogIqPrograms>> | null = null;
        for (const programsPath of det.programsPaths) {
          const part = await scrapeSmartCatalogIqPrograms({
            collegeSlug: c.slug,
            baseUrl: base,
            catalogYear: det.catalogYear,
            catalogPath: det.catalogPath,
            programsPath,
          });
          meta ??= part;
          for (const p of part.programs) {
            const key = p.catalog_url ?? p.title;
            if (!seen.has(key)) { seen.add(key); merged.push(p); }
          }
        }
        data = { ...(meta ?? { college_slug: c.slug, catalog_year: det.catalogYear, scraped_at: new Date().toISOString() }), programs: merged };
      } else {
        data = await scrapeSmartCatalogIqPrograms({ collegeSlug: c.slug, baseUrl: base });
      }

      if (data.programs.length === 0) {
        console.log(`  No programs found for ${c.slug}, skipping.`);
        summary.push({ slug: c.slug, programs: 0, matched: 0 });
        continue;
      }
      const { matched, unmatched } = applyProgramMatching(data.programs);
      console.log(`  Matcher: ${matched} matched, ${unmatched} unmatched`);
      const outPath = path.join(outDir, `${c.slug}.json`);
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
      console.log(`  ✓ Wrote ${data.programs.length} programs → ${outPath}`);
      totalPrograms += data.programs.length;
      summary.push({ slug: c.slug, programs: data.programs.length, matched });
    } catch (e) {
      console.error(`  ERROR scraping ${c.slug}: ${e}`);
      summary.push({ slug: c.slug, programs: -1, matched: 0 });
    }
  }

  console.log(`\n${"=".repeat(60)}\nDone. ${totalPrograms} programs across ${colleges.length} college(s).`);
  console.table(summary);
}

main().catch((e) => { console.error(e); process.exit(1); });
