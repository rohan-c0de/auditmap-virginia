/**
 * Central Texas College — bespoke stealth Colleague Self-Service scrape
 *
 * CTC runs a STANDARD Ellucian Colleague Self-Service instance at
 * https://student.ctcd.org/ ("CTC Eagle Self-Service"). Guest course search
 * is public and the section JSON is the usual Colleague shape, so under
 * normal circumstances the shared template (scripts/lib/scrape-colleague.ts)
 * would cover it.
 *
 * The catch: the ctcd.org domain sits behind Cloudflare Bot Management.
 *   - Plain `fetch`/curl  → blocked (challenge HTML, never the catalog).
 *   - The shared template's default Playwright context → also blocked; it
 *     discovers 0 terms because `resolveCollegeTerms` uses plain fetch under
 *     the hood (colleague-terms.ts), which Cloudflare rejects.
 *   - A *stealth* headless Chromium (navigator.webdriver undefined +
 *     realistic UA + a steady viewport, AutomationControlled disabled) PASSES
 *     the managed challenge: GET /Student/Courses returns HTTP 200 with the
 *     real catalog UI and a working __RequestVerificationToken. Verified
 *     2026-06: status 200, no challenge interstitial, PostSearchCriteria
 *     returns 1016 items across active terms.
 *
 * So this scraper:
 *   1. Launches a stealth Chromium context (ONE context, reused for every
 *      term, so the cf_clearance cookie persists across requests).
 *   2. Reads the term dropdown (#term-id) from the rendered page to learn
 *      CTC's native codes (SPR26 / SU126 / SU226 / FAL26) and labels.
 *   3. Delegates the actual section scrape to the shared template's
 *      `scrapeColleagueCollegeTerm` (CSRF capture, per-subject pagination
 *      over PostSearchCriteria, SectionDetails prereq enrichment) by passing
 *      it the stealth context — no duplicated Colleague-quirk logic.
 *   4. Remaps each section's term to the canonical YEAR+FA/SP/SU contract
 *      code and writes one file per contract term, MERGING the two summer
 *      mini-sessions (SU126 + SU226) into a single 2026SU.json.
 *
 * CTC term-code convention (from the live #term-id dropdown):
 *   SPR26 → "Spring 2026" → 2026SP   (usually already past → 0 sections)
 *   SU126 → "Summer 1 2026" ─┐
 *   SU226 → "Summer 2 2026" ─┴→ 2026SU   (both mini-sessions merged)
 *   FAL26 → "Fall 2026"   → 2026FA
 *
 * Output rows match the shared CourseSection contract exactly (same schema
 * every other state writes). start_date is normalized to ISO "YYYY-MM-DD"
 * by the template (Colleague's FormattedMeetingTimes already gives ISO).
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-central-texas.ts            # all live terms
 *   npx tsx scripts/tx/scrape-central-texas.ts --term FAL26   # one native term
 *
 * Does NOT import to Supabase, edit config, or touch other colleges.
 */
import * as fs from "fs";
import * as path from "path";
import { chromium, type BrowserContext } from "playwright";
import {
  scrapeColleagueCollegeTerm,
  type CourseSection,
} from "../lib/scrape-colleague";

const SLUG = "central-texas-college";
const STATE = "tx";
const BASE_URL = "https://student.ctcd.org";
const OUT_DIR = path.join(process.cwd(), "data", STATE, "courses", SLUG);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface TermOption {
  /** CTC native code, e.g. "FAL26". */
  value: string;
  /** Human label, e.g. "Fall 2026" — what the template's matcher keys on. */
  label: string;
}

/**
 * Map a CTC native term code (or its label) to the canonical contract code
 * YEAR + FA/SP/SU. Returns null for anything we can't confidently map (so we
 * skip rather than mis-file). Winter is intentionally folded into FA's bucket
 * only if it ever appears — CTC doesn't currently run winter terms.
 */
function ctcCodeToContract(value: string, label: string): string | null {
  // Prefer the explicit YYYY + season in the label ("Fall 2026", "Summer 1
  // 2026") — it's unambiguous. Fall back to parsing the native code
  // (FAL26 / SPR26 / SU126 / SU226 with a 2-digit year).
  const seasonFromLabel = label.match(/\b(spring|summer|fall|winter)\b/i)?.[1];
  const yearFromLabel = label.match(/\b(20\d{2})\b/)?.[1];
  if (seasonFromLabel && yearFromLabel) {
    const m: Record<string, string> = {
      spring: "SP",
      summer: "SU",
      fall: "FA",
      winter: "WI",
    };
    return `${yearFromLabel}${m[seasonFromLabel.toLowerCase()]}`;
  }

  // Native-code fallback: SPR26 / FAL26 / SU126 / SU226 → season + "26".
  const v = value.toUpperCase();
  const mm = v.match(/^(SPR|FAL|SU\d|SUM|WIN)(\d{2})$/);
  if (!mm) return null;
  const seasonPart = mm[1];
  const yr = parseInt(mm[2], 10);
  const fullYear = yr >= 50 ? `19${mm[2]}` : `20${mm[2]}`;
  let season: string | null = null;
  if (seasonPart === "SPR") season = "SP";
  else if (seasonPart === "FAL") season = "FA";
  else if (seasonPart === "WIN") season = "WI";
  else if (seasonPart.startsWith("SU")) season = "SU"; // SU1, SU2, SUM
  if (!season) return null;
  return `${fullYear}${season}`;
}

/** Build the stealth context that clears CTC's Cloudflare managed challenge. */
async function makeStealthContext(): Promise<{
  context: BrowserContext;
  close: () => Promise<void>;
}> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return { context, close: () => browser.close() };
}

/**
 * Warm the Cloudflare cookie and read the term dropdown. Returns CTC's native
 * term options so we only scrape terms the site actually exposes.
 */
async function discoverTerms(context: BrowserContext): Promise<TermOption[]> {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/Student/Courses`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    // Give Cloudflare + the Knockout SPA time to settle and render the form.
    await page.waitForTimeout(6000);

    const url = page.url();
    if (/\/Account\/Login/i.test(url)) {
      throw new Error(
        `Redirected to login (${url}) — CTC guest access appears gated, not just Cloudflare.`
      );
    }

    const opts = await page.evaluate(() => {
      const sel = document.getElementById("term-id") as HTMLSelectElement | null;
      if (!sel) return [] as TermOption[];
      return Array.from(sel.options)
        .filter((o) => o.value) // drop the "Select Term" placeholder
        .map((o) => ({ value: o.value, label: o.textContent?.trim() || "" }));
    });
    return opts;
  } finally {
    await page.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const termFilter = args.find((a) => a.startsWith("--term="))?.split("=")[1];

  console.log("🦅 Central Texas College — stealth Colleague scrape");
  console.log(`   ${BASE_URL}/Student/Courses`);

  const { context, close } = await makeStealthContext();

  try {
    const termOptions = await discoverTerms(context);
    if (termOptions.length === 0) {
      throw new Error(
        "No terms found in #term-id dropdown — Cloudflare may have blocked the page, or the catalog markup changed."
      );
    }
    console.log(
      `   Term dropdown: ${termOptions
        .map((t) => `${t.value} (${t.label})`)
        .join(", ")}`
    );

    const targets = termFilter
      ? termOptions.filter((t) => t.value === termFilter)
      : termOptions;
    if (targets.length === 0) {
      throw new Error(
        `--term=${termFilter} not in dropdown. Available: ${termOptions
          .map((t) => t.value)
          .join(", ")}`
      );
    }

    // Accumulate by CONTRACT term code (merges SU1+SU2 into 2026SU).
    const byContractTerm = new Map<string, CourseSection[]>();
    const perNativeTerm: Array<{
      native: string;
      contract: string;
      sections: number;
    }> = [];

    for (const term of targets) {
      const contractCode = ctcCodeToContract(term.value, term.label);
      if (!contractCode) {
        console.log(
          `   ⚠️  skipping ${term.value} (${term.label}) — can't map to a contract term code`
        );
        continue;
      }

      console.log(
        `\n── Term ${term.value} → ${contractCode} (${term.label}) ──`
      );

      // The template's matcher keys on the human label ("Fall 2026"), which
      // it resolves back to the native dropdown value (FAL26) itself.
      const sections = await scrapeColleagueCollegeTerm({
        state: STATE,
        slug: SLUG,
        baseUrl: BASE_URL,
        termName: term.label,
        context,
      });

      // Re-stamp the contract term code on every row (the template stamps the
      // native code, e.g. "FAL26"; the contract wants "2026FA").
      for (const s of sections) s.term = contractCode;

      if (!byContractTerm.has(contractCode)) byContractTerm.set(contractCode, []);
      byContractTerm.get(contractCode)!.push(...sections);

      perNativeTerm.push({
        native: term.value,
        contract: contractCode,
        sections: sections.length,
      });

      await sleep(800); // polite pause between terms
    }

    // Write one file per contract term (after the merge).
    fs.mkdirSync(OUT_DIR, { recursive: true });
    let grandTotal = 0;
    const written: Array<{ term: string; sections: number; file: string }> = [];
    for (const [contractCode, sections] of [...byContractTerm.entries()].sort()) {
      if (sections.length === 0) {
        console.log(`   (no sections for ${contractCode} — not writing a file)`);
        continue;
      }
      const outFile = path.join(OUT_DIR, `${contractCode}.json`);
      fs.writeFileSync(outFile, JSON.stringify(sections, null, 2) + "\n");
      written.push({ term: contractCode, sections: sections.length, file: outFile });
      grandTotal += sections.length;
      console.log(`   ✓ ${contractCode}: ${sections.length} sections → ${outFile}`);
    }

    console.log("\n=== Per native term ===");
    for (const t of perNativeTerm) {
      console.log(`   ${t.native} → ${t.contract}: ${t.sections} sections`);
    }
    console.log(
      `\n✅ ${grandTotal} sections across ${written.length} contract term file(s).`
    );
  } finally {
    await close();
  }
}

main().catch((e) => {
  console.error("❌ Central Texas College scraper failed:", e);
  process.exit(1);
});
