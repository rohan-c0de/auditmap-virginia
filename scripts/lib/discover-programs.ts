/**
 * discover-programs.ts (Phase 6 helper)
 *
 * Probes each college's known web domains for a catalog hosting one of the
 * platforms we have program scrapers for (`scripts/lib/scrape-{platform}-
 * programs.ts`), and returns a per-college dispatch plan. The orchestrator
 * uses the result to write a `scripts/{state}/scrape-programs.ts` wrapper
 * with the right config per college.
 *
 * Deliberately does NOT execute the program scrape itself — catalog data is
 * higher-stakes per row than course sections (degree requirements), so the
 * operator validates the discovered URLs and runs the wrapper manually
 * before committing.
 *
 * Detected platforms (match scripts/lib/scrape-{x}-programs.ts):
 *   - acalog            (preview_program.php + body marker "acalog")
 *   - courseleaf        (body marker "courseleaf" or "leepfrog")
 *   - smartcatalogiq    (host *.smartcatalogiq.com or body marker)
 *   - coursedog         (body marker "coursedog" or static.catalog.prod.coursedog.com)
 *   - cleancatalog      (host *.cleancatalog.net or body marker)
 *
 * Unmatched / private (Modern Campus, custom HTML, PDF-only) bubble up as
 * `[programs]` TODOs.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type ProgramPlatform =
  | "acalog"
  | "courseleaf"
  | "smartcatalogiq"
  | "coursedog"
  | "cleancatalog";

export interface ProgramCatalogHit {
  collegeSlug: string;
  platform: ProgramPlatform;
  catalogUrl: string;
}

export interface ProgramCatalogMiss {
  collegeSlug: string;
  triedUrls: string[];
  reason: string;
}

export interface DiscoverProgramsResult {
  hits: ProgramCatalogHit[];
  misses: ProgramCatalogMiss[];
}

interface CollegeInput {
  /** college_slug, e.g. "wake-tech" */
  slug: string;
  /** Primary web domain, e.g. "waketech.edu" — derive from institutions.json or the
   *  course-scraper baseUrl. Don't pass full URLs; extract the host first. */
  primaryDomain: string;
}

function candidatesFor(domain: string, slug: string): string[] {
  // Strip leading "www." so we don't double-prefix.
  const d = domain.replace(/^www\./, "");
  return [
    `https://catalog.${d}/`,
    `https://${slug}.smartcatalogiq.com/`,
    `https://${slug}.cleancatalog.net/`,
    `https://www.${d}/catalog/`,
    `https://www.${d}/academics/catalog/`,
  ];
}

function identifyPlatform(
  url: string,
  body: string,
): ProgramPlatform | null {
  const u = url.toLowerCase();
  if (u.includes(".smartcatalogiq.com")) return "smartcatalogiq";
  if (u.includes(".cleancatalog.net")) return "cleancatalog";
  // Body-marker checks — order matters; courseleaf and acalog have very
  // distinctive markers, coursedog ships a static asset host.
  if (/preview_program\.php|powered by .*acalog|"acalog"/i.test(body)) return "acalog";
  if (/courseleaf|leepfrog/i.test(body)) return "courseleaf";
  if (/static\.catalog\.prod\.coursedog\.com|coursedog/i.test(body)) return "coursedog";
  if (/smartcatalogiq/i.test(body)) return "smartcatalogiq";
  if (/cleancatalog/i.test(body)) return "cleancatalog";
  return null;
}

async function probe(url: string): Promise<{
  ok: boolean;
  status: number;
  body: string;
  finalUrl: string;
}> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": UA, "Accept": "text/html" },
      signal: AbortSignal.timeout(12000),
    });
    // Treat 5xx and 4xx alike — we still need a 200 with a real body.
    if (!res.ok) {
      return { ok: false, status: res.status, body: "", finalUrl: res.url };
    }
    const body = await res.text();
    return { ok: true, status: 200, body, finalUrl: res.url };
  } catch {
    return { ok: false, status: 0, body: "", finalUrl: url };
  }
}

export async function discoverPrograms(
  colleges: CollegeInput[],
): Promise<DiscoverProgramsResult> {
  const hits: ProgramCatalogHit[] = [];
  const misses: ProgramCatalogMiss[] = [];

  for (const college of colleges) {
    const urls = candidatesFor(college.primaryDomain, college.slug);
    let found: ProgramCatalogHit | null = null;
    const tried: string[] = [];

    for (const url of urls) {
      tried.push(url);
      const r = await probe(url);
      if (!r.ok) continue;
      const platform = identifyPlatform(r.finalUrl, r.body);
      if (platform) {
        found = {
          collegeSlug: college.slug,
          platform,
          catalogUrl: new URL(r.finalUrl).origin,
        };
        break;
      }
    }

    if (found) {
      hits.push(found);
    } else {
      misses.push({
        collegeSlug: college.slug,
        triedUrls: tried,
        reason: "no public catalog matched a known platform (acalog/courseleaf/smartcatalogiq/coursedog/cleancatalog)",
      });
    }
  }

  return { hits, misses };
}

/** Render a per-state `scripts/{state}/scrape-programs.ts` wrapper from
 *  discovered hits. Returns null if no hits — caller surfaces a TODO. */
export function renderProgramsWrapper(
  state: string,
  hits: ProgramCatalogHit[],
): string | null {
  if (hits.length === 0) return null;

  // Group by platform so the wrapper imports each template once.
  const byPlatform = new Map<ProgramPlatform, ProgramCatalogHit[]>();
  for (const h of hits) {
    const arr = byPlatform.get(h.platform) || [];
    arr.push(h);
    byPlatform.set(h.platform, arr);
  }

  const imports: string[] = [];
  const blocks: string[] = [];

  for (const [platform, list] of byPlatform) {
    const fnName = `scrape${platform[0].toUpperCase()}${platform.slice(1)}Programs`
      .replace("Smartcatalogiq", "SmartCatalogIq")
      .replace("Cleancatalog", "CleanCatalog");
    imports.push(`import { ${fnName} } from "../lib/scrape-${platform}-programs.js";`);

    for (const hit of list) {
      blocks.push(
        `  // ${hit.collegeSlug} (${platform})\n` +
          `  await run("${hit.collegeSlug}", () =>\n` +
          `    ${fnName}({ collegeSlug: "${hit.collegeSlug}", baseUrl: "${hit.catalogUrl}" }),\n` +
          `  );`,
      );
    }
  }

  return `/**
 * scrape-programs.ts — degree/program requirements for ${state.toUpperCase()}.
 *
 * Auto-generated by scripts/lib/discover-programs.ts. Each entry maps a
 * college slug to the catalog platform discovered for that college. Edit
 * configs (catoid, catalogYear, programNavoids, etc.) per the platform
 * template's options interface before relying on the data.
 *
 * Usage:
 *   npx tsx scripts/${state}/scrape-programs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { applyProgramMatching } from "../../lib/programs/matcher.js";
${imports.join("\n")}

async function run(
  slug: string,
  scrape: () => Promise<{ programs: unknown[]; catalog_year: string; catalog_url: string; college_slug: string; scraped_at: string }>,
): Promise<void> {
  console.log(\`\\n=== \${slug} ===\`);
  try {
    const data = await scrape();
    if (data.programs.length === 0) {
      console.log(\`  No programs found for \${slug}.\`);
      return;
    }
    const { matched, unmatched } = applyProgramMatching(data.programs as never);
    console.log(\`  Matcher: \${matched} matched / \${unmatched} unmatched\`);
    const outDir = path.join(process.cwd(), "data", "${state}", "programs");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, \`\${slug}.json\`);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(\`  ✓ Wrote \${data.programs.length} programs → \${outPath}\`);
  } catch (e) {
    console.error(\`  ✗ \${slug} failed: \${e}\`);
  }
}

async function main() {
  console.log("${state.toUpperCase()} program scraper");
${blocks.join("\n\n")}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
`;
}
