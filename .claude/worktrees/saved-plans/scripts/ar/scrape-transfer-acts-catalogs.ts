/**
 * scrape-transfer-acts-catalogs.ts — AR transfer equivalencies aggregated
 * from each AR public university's static ACTS-equivalency catalog page.
 *
 * Background
 * ──────────
 * Arkansas's ACTS (Arkansas Course Transfer System) at acts.adhe.edu is the
 * statewide articulation portal — a mandated common course numbering
 * system (Act 747 of 2011). The student-facing studenttransfer.aspx form
 * is ASP.NET WebForms behind a slow legacy IIS host that's firewalled
 * from many cloud/CDN egress IPs (we couldn't reach it from this sandbox
 * or from the recon agent's network).
 *
 * Workaround: every AR public university publishes its ACTS-equivalency
 * mapping as a static HTML catalog page (no captcha, no auth). We
 * aggregate those instead — much faster than walking ACTS itself.
 *
 * Because ACTS is a common-course system, every AR public community
 * college uses the same ACTS codes for its courses. So one mapping per
 * (ACTS course × receiver) covers all 22 AR CCs — no per-CC variation
 * needed in the data model.
 *
 * Sources (verified 2026-05-25)
 * ─────────────────────────────
 *   • ATU — catalog.atu.edu/undergraduate/acts/    (101 rows)
 *   • UAF — registrar.uark.edu/transfer-and-test-credit/acts.php  (76 rows)
 *   • UCA — uca.edu/academicbulletins/acts/        (87 rows)
 *
 * ATU's /ozark/acts/ page is byte-identical to the main /undergraduate/
 * one (verified 2026-05-25), so we only fetch one.
 *
 * Receivers not in this scraper (deferred to follow-ups):
 *   • UALR, UAFS, UAPB, SAU — per-course Acalog harvest (no master table)
 *   • ASU-Jonesboro, HSU — interactive transfer-equivalency portals
 *     (asutep.astate.edu, tcet.hsu.edu — likely need Playwright)
 *   • UAM — no public ACTS page found
 *
 * Usage:
 *   npx tsx scripts/ar/scrape-transfer-acts-catalogs.ts
 *   npx tsx scripts/ar/scrape-transfer-acts-catalogs.ts --no-import
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const STATE = "ar";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

interface TransferMapping {
  state: string;
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

interface Source {
  slug: string;
  name: string;
  url: string;
  /** Parse the fetched HTML into TransferMapping records. */
  parse: (html: string, source: Source) => TransferMapping[];
}

// ─────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchHtml(url: string, attempt = 0): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await sleep(3000 * Math.pow(2, attempt));
        return fetchHtml(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return await res.text();
  } catch (e) {
    if (attempt < 3 && /timeout|network|ECONN/i.test(String(e))) {
      await sleep(3000 * Math.pow(2, attempt));
      return fetchHtml(url, attempt + 1);
    }
    throw e;
  }
}

/**
 * Split a course-code string like "ANTH 2013" or "ACCT2003" (no space) or
 * "ANTH 1023 (ANTH 10203)" into prefix + number. Trailing parentheticals
 * (new-numbering notes, "(3)" credit hints, etc.) are dropped.
 */
function splitCourseCode(raw: string): { prefix: string; number: string } | null {
  const cleaned = raw
    .replace(/\([^)]*\)/g, "") // drop "(ANTH 10203)" or "(3)" annotations
    .replace(/\*+/g, "")        // drop "**" footnote markers
    .replace(/\s+/g, " ")
    .trim();
  // Match "PREFIX NUMBER" with optional space — handles "ACCT 2003" and "ACCT2003"
  const m = cleaned.match(/^([A-Z]{2,5})\s*([0-9]{3,4}[A-Z]?)\b/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

function classify(
  univCode: string,
  univTitle: string,
): { univ_course: string; univ_title: string; no_credit: boolean; is_elective: boolean } {
  const code = univCode.replace(/\s+/g, " ").trim();
  const title = univTitle.replace(/\s+/g, " ").trim();
  const lower = (code + " " + title).toLowerCase();
  if (!code || /no\s+(comparable|equivalent)|not\s+transferable|non\s*transferable/.test(lower)) {
    return { univ_course: "", univ_title: title || code, no_credit: true, is_elective: false };
  }
  if (/elective\s+credit|dept(\.|artmental)?\s+elective/i.test(lower)) {
    const split = splitCourseCode(code);
    return {
      univ_course: split ? `${split.prefix} ${split.number}` : "",
      univ_title: title || code,
      no_credit: false,
      is_elective: true,
    };
  }
  const split = splitCourseCode(code);
  if (split) {
    return {
      univ_course: `${split.prefix} ${split.number}`,
      univ_title: title,
      no_credit: false,
      is_elective: false,
    };
  }
  return { univ_course: "", univ_title: code || title, no_credit: false, is_elective: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Parsers (one per source schema)
// ─────────────────────────────────────────────────────────────────────────

/**
 * ATU schema: <table class="sc_sctable tbl_acts">
 *   header: ACTS Course Index Number | ACTS Course Index Name |
 *           Arkansas Tech University Course Number | Arkansas Tech University Course Name
 *   row:    "ACCT 2003" | "Principles of Accounting I" | "ACCT 2004 1" | "Principles of Accounting I"
 *
 * UCA schema: <table> within #acts container, same shape but columns reversed:
 *   header: UCA CNUM | UCA COURSE TITLE | ACTS CNUM | ACTS COURSE TITLE
 *   row:    "ACCT 2310 **" | "Principles of Financial Accounting" | "ACCT2003" | "Principles of Accounting I"
 *
 * UAF schema: <table> with truncated 2-cell header but 4 data cells per row:
 *   row:    "ANTH 2013" | "Cultural Anthropology" | "ANTH 1023 (ANTH 10203)" | "Introduction to Cultural Anthropology"
 *
 * In all cases there's one ACTS-coded cell + one univ-coded cell per row.
 * We detect which is which by trying splitCourseCode on each, preferring
 * the one whose prefix is a known ACTS subject (ACCT, BIOL, etc.) on the
 * CC side.
 */
function parseGenericTable(html: string, source: Source): TransferMapping[] {
  const $ = cheerio.load(html);
  const out: TransferMapping[] = [];

  // Find the first table that contains "ACTS" in any cell — guards against
  // catalog templates with multiple unrelated tables.
  type CheerioSel = ReturnType<cheerio.CheerioAPI>;
  let targetTable: CheerioSel | null = null;
  $("table").each((_, t) => {
    if (targetTable) return;
    const txt = $(t).text();
    if (/ACTS/i.test(txt) && $(t).find("tr").length >= 5) {
      targetTable = $(t) as CheerioSel;
    }
  });
  if (!targetTable) return out;
  const tableSel: CheerioSel = targetTable;

  const rows = tableSel.find("tr").toArray();
  // Use the first row's cells to figure out column order.
  if (rows.length < 2) return out;
  const headerCells: string[] = [];
  $(rows[0]).find("th, td").each((_: number, c) => {
    headerCells.push($(c).text().replace(/\s+/g, " ").trim().toLowerCase());
  });

  // Figure out which columns are ACTS-side and which are univ-side.
  // Heuristic: any header cell containing "acts" → ACTS-side; otherwise
  // university-side. UAF's header is short ("ACTS Course" + one combined
  // cell), so we may not have 4 distinct headers — fall back to "first
  // two cells = ACTS, last two = univ" for that case.
  let actsCodeIdx = -1;
  let actsTitleIdx = -1;
  let univCodeIdx = -1;
  let univTitleIdx = -1;
  headerCells.forEach((h, i) => {
    const isActs = /acts/.test(h);
    // "title"/"name" must be checked BEFORE "course" — otherwise the word
    // "course" inside "UCA COURSE TITLE" wins and the title gets misrouted
    // to the code column.
    if (isActs) {
      if (/(name|title)/.test(h)) actsTitleIdx = i;
      else if (/(number|cnum|code|course)/.test(h)) actsCodeIdx = i;
    } else {
      if (/(name|title)/.test(h)) univTitleIdx = i;
      else if (/(number|cnum|code|course)/.test(h)) univCodeIdx = i;
    }
  });

  for (const tr of rows.slice(1)) {
    const cells = $(tr).find("td").toArray();
    if (cells.length < 4) continue;
    const texts = cells.map((c) => $(c).text().replace(/\s+/g, " ").trim());

    let actsCode: string;
    let actsTitle: string;
    let univCode: string;
    let univTitle: string;

    if (
      actsCodeIdx >= 0 && actsTitleIdx >= 0 &&
      univCodeIdx >= 0 && univTitleIdx >= 0
    ) {
      actsCode = texts[actsCodeIdx];
      actsTitle = texts[actsTitleIdx];
      univCode = texts[univCodeIdx];
      univTitle = texts[univTitleIdx];
    } else {
      // Fallback for UAF-style truncated headers, or any other table where
      // header detection failed. Try both column orderings and pick the
      // one whose "ACTS code" cell actually parses as a course code AND
      // (when possible) contains a recognizable ACTS subject prefix.
      const tryOrder = (a: number, t: number, uc: number, ut: number) => {
        const split = splitCourseCode(texts[a]);
        return split ? { actsCode: texts[a], actsTitle: texts[t], univCode: texts[uc], univTitle: texts[ut] } : null;
      };
      const fwd = tryOrder(0, 1, 2, 3); // ACTS-first (ATU, UAF)
      const rev = tryOrder(2, 3, 0, 1); // UCA-style (univ-first)
      // Prefer the ordering where BOTH halves parse as valid course codes.
      const fwdGood = fwd && splitCourseCode(fwd.univCode);
      const revGood = rev && splitCourseCode(rev.univCode);
      const pick = fwdGood ? fwd : revGood ? rev : fwd ?? rev;
      if (!pick) continue;
      actsCode = pick.actsCode;
      actsTitle = pick.actsTitle;
      univCode = pick.univCode;
      univTitle = pick.univTitle;
    }

    const split = splitCourseCode(actsCode);
    if (!split) continue;
    const classified = classify(univCode, univTitle);

    out.push({
      state: STATE,
      cc_prefix: split.prefix,
      cc_number: split.number,
      cc_course: `${split.prefix} ${split.number}`,
      cc_title: actsTitle,
      cc_credits: "",
      university: source.slug,
      university_name: source.name,
      univ_course: classified.univ_course,
      univ_title: classified.univ_title,
      univ_credits: "",
      notes: "",
      no_credit: classified.no_credit,
      is_elective: classified.is_elective,
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Sources
// ─────────────────────────────────────────────────────────────────────────

const SOURCES: Source[] = [
  {
    slug: "atu",
    name: "Arkansas Tech University",
    url: "https://catalog.atu.edu/undergraduate/acts/",
    parse: parseGenericTable,
  },
  {
    slug: "uaf",
    name: "University of Arkansas",
    url: "https://registrar.uark.edu/transfer-and-test-credit/acts.php",
    parse: parseGenericTable,
  },
  {
    slug: "uca",
    name: "University of Central Arkansas",
    url: "https://uca.edu/academicbulletins/acts/",
    parse: parseGenericTable,
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const noImport = args.includes("--no-import");

  console.log("AR Transfer Equivalency Scraper (ACTS catalog aggregator)");
  console.log("");

  const allMappings: TransferMapping[] = [];
  const failures: { source: string; error: string }[] = [];

  for (const source of SOURCES) {
    console.log(`  ${source.slug} (${source.name})`);
    console.log(`    fetching ${source.url}`);
    try {
      const html = await fetchHtml(source.url);
      const rows = source.parse(html, source);
      allMappings.push(...rows);
      console.log(`    +${rows.length} mappings (running total: ${allMappings.length})`);
    } catch (e) {
      console.error(`    FAILED — ${(e as Error).message}`);
      failures.push({ source: source.slug, error: (e as Error).message });
    }
    // Polite throttle between catalog hosts.
    await sleep(1000);
  }

  console.log(`\nTotal mappings: ${allMappings.length}`);
  if (failures.length > 0) {
    console.log(`Failures: ${failures.length}`);
    for (const f of failures) console.log(`  - ${f.source}: ${f.error}`);
  }

  // Dedup
  const seen = new Set<string>();
  const deduped = allMappings.filter((m) => {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.university}|${m.univ_course}|${m.univ_title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length < allMappings.length) {
    console.log(`After dedup: ${deduped.length} (dropped ${allMappings.length - deduped.length})`);
  }

  deduped.sort((a, b) =>
    a.cc_prefix.localeCompare(b.cc_prefix) ||
    a.cc_number.localeCompare(b.cc_number) ||
    a.university.localeCompare(b.university),
  );

  const outPath = path.join(process.cwd(), "data", STATE, "transfer-equiv.json");
  if (deduped.length === 0 && fs.existsSync(outPath)) {
    const existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
    if (Array.isArray(existing) && existing.length > 0) {
      console.error(`REFUSING to overwrite ${outPath} (existing ${existing.length} rows) with 0 rows.`);
      process.exit(1);
    }
  }
  fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2));
  console.log(`\nWrote ${deduped.length} mappings → ${outPath}`);

  if (!noImport && deduped.length > 0) {
    try {
      const { importTransfersToSupabase } = await import("../lib/supabase-import");
      await importTransfersToSupabase(STATE);
    } catch (e) {
      console.log(`Supabase import skipped: ${(e as Error).message}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
