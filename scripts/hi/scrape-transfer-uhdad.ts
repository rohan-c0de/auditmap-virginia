/**
 * scrape-transfer-uhdad.ts — UH System course transfer equivalencies.
 *
 * The UH System operates a single statewide Banner SSB articulation database
 * at https://www.sis.hawaii.edu/uhdad/CourseTransfer.home covering all 10 UH
 * campuses (7 CCs + 3 four-years) as both senders and receivers. Public
 * guest endpoint, no login.
 *
 * Form (HTML POST, no JSON API):
 *   POST /uhdad/CourseTransfer.home
 *   Content-Type: application/x-www-form-urlencoded
 *   Body: s=<senderId>&i=<receiverId>&subj=&crse=&sem=&y=&btn=SEARCH&debug=N
 *
 * Leaving subj/crse blank returns ALL equivalencies for that (sender,
 * receiver) pair — one POST per pair → 6 CCs × 3 four-years = 18 requests
 * for full coverage.
 *
 * The result page is server-rendered HTML; equivalency rows live in a
 * results table with the sender course in one column and the receiver
 * course in another.
 *
 * Throttled at 1500ms between requests; Banner SSB is slow and we don't
 * want to compete with student traffic during peak registration.
 *
 * Usage:
 *   npx tsx scripts/hi/scrape-transfer-uhdad.ts
 *   npx tsx scripts/hi/scrape-transfer-uhdad.ts --college honolulu-community-college
 *   npx tsx scripts/hi/scrape-transfer-uhdad.ts --no-import
 */

import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const STATE = "hi";
const ENDPOINT = "https://www.sis.hawaii.edu/uhdad/CourseTransfer.home";
const DELAY_MS = 1500;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

// UH Banner institution IDs sourced from the form's `sbgiList`/`instList`
// datalists (verified via Wayback snapshot 2025-12-01). Sending side uses
// the 4-digit Banner SGBSTDN_STBL code. Receiving side uses the same
// code-space — UH four-year campuses also serve as senders for
// graduate-to-grad evals, but for cc-coursemap we only need CC → 4-year.
const CC_SENDERS: { id: string; slug: string }[] = [
  { id: "1801", slug: "hawaii-community-college" },
  { id: "4350", slug: "honolulu-community-college" },
  { id: "4377", slug: "kapiolani-community-college" },
  { id: "4378", slug: "kauai-community-college" },
  { id: "4410", slug: "leeward-community-college" },
  { id: "4976", slug: "windward-community-college" },
];

const RECEIVERS: { id: string; slug: string; name: string }[] = [
  { id: "4867", slug: "uh-manoa", name: "University of Hawaiʻi at Mānoa" },
  { id: "4869", slug: "uh-hilo", name: "University of Hawaiʻi at Hilo" },
  { id: "1042", slug: "uh-west-oahu", name: "University of Hawaiʻi—West Oʻahu" },
];

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** POST to UH SIS with retry on 502/5xx (Banner maintenance windows are common). */
async function postForm(body: string, attempt = 0): Promise<string> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/html,application/xhtml+xml",
      },
      body,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      // Banner SSB returns 502 ("service temporarily unavailable") during
      // nightly maintenance windows. Back off and retry up to 4x.
      if ((res.status === 502 || res.status === 429 || res.status >= 500) && attempt < 4) {
        const wait = 5000 * Math.pow(2, attempt);
        console.log(`    HTTP ${res.status}; retry ${attempt + 1}/4 in ${wait}ms`);
        await sleep(wait);
        return postForm(body, attempt + 1);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  } catch (e) {
    if (attempt < 4 && /timeout|network|ECONN|HTTP 5/i.test(String(e))) {
      await sleep(5000 * Math.pow(2, attempt));
      return postForm(body, attempt + 1);
    }
    throw e;
  }
}

/** Parse a course-code cell like "ENG 100" or "PHYL 141L". */
function splitCourseCode(raw: string): { prefix: string; number: string } | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const m = cleaned.match(/^([A-Z]{2,6})\s*(\d{1,4}[A-Z0-9]*)$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2] };
}

/** Classify a receiver-course cell into structured fields. */
function classifyReceiver(courseText: string, titleText: string): {
  univ_course: string;
  univ_title: string;
  no_credit: boolean;
  is_elective: boolean;
} {
  const code = courseText.replace(/\s+/g, " ").trim();
  const title = titleText.replace(/\s+/g, " ").trim();
  const lower = (code + " " + title).toLowerCase();

  if (!code || /no\s+equivalent|no\s+credit|not\s+transferable|non\s*transferable/.test(lower)) {
    return { univ_course: "", univ_title: title || code, no_credit: true, is_elective: false };
  }
  if (/^elective/i.test(code) || /elective\s+credit/i.test(lower)) {
    return { univ_course: "", univ_title: title || "Elective Credit", no_credit: false, is_elective: true };
  }
  // "DEPT ELECTIVE" or "ENG DEPT ELECTIVE"
  if (/\bdept\s+elective\b/i.test(code) || /\bdept\s+elective\b/i.test(title)) {
    return { univ_course: "", univ_title: code || title, no_credit: false, is_elective: true };
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
  // Fallback: opaque cell → keep raw text, treat as elective rather than drop.
  return { univ_course: "", univ_title: code, no_credit: false, is_elective: true };
}

/**
 * Parse the result HTML for one (sender, receiver) pair.
 *
 * UH SIS renders a table with columns roughly:
 *   [sender code, sender title, sender credits, receiver code, receiver title, receiver credits, sem/year]
 *
 * Column layout may vary across Banner versions, so we look up headers
 * by name when possible and fall back to positional indices.
 */
function parseResults(
  html: string,
  sender: { id: string; slug: string },
  receiver: { id: string; slug: string; name: string },
): TransferMapping[] {
  const $ = cheerio.load(html);
  const out: TransferMapping[] = [];

  // Find the results table — typically class "datadisplaytable" in Banner.
  let table: any = null;
  $("table").each((_, t) => {
    if (table) return;
    const klass = $(t).attr("class") || "";
    const summary = $(t).attr("summary") || "";
    if (/datadisplay|results|coursetransfer/i.test(klass + " " + summary)) {
      table = $(t);
    }
  });
  // Fallback: largest table by row count.
  if (!table) {
    let maxRows = 0;
    $("table").each((_, t) => {
      const rows = $(t).find("tr").length;
      if (rows > maxRows) {
        maxRows = rows;
        table = $(t);
      }
    });
  }
  if (!table) return out;

  // Determine column indices from the header row.
  const headerCells = table.find("tr").first().find("th, td");
  const headers: string[] = [];
  headerCells.each((_: number, c: any) => {
    headers.push($(c).text().replace(/\s+/g, " ").trim().toLowerCase());
  });

  // Indices: try by header text, fall back to positions.
  const findCol = (...needles: string[]) => {
    for (const n of needles) {
      const idx = headers.findIndex((h) => h.includes(n));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  // UH SIS columns observed in the Wayback snapshot:
  //   "TRANSFER" subject | course | title | credits | "UH" subject | course | title | credits
  // Map known headers; otherwise fall back to a sensible split.
  const senderSubjIdx = findCol("transfer subject", "subject");
  const senderCrseIdx = findCol("transfer course", "course");
  const senderTitleIdx = findCol("transfer title", "title");
  const senderCredIdx = findCol("transfer credits", "credits");
  const recvSubjIdx = headers.lastIndexOf("subject");
  const recvCrseIdx = headers.lastIndexOf("course");
  const recvTitleIdx = headers.lastIndexOf("title");
  const recvCredIdx = headers.lastIndexOf("credits");

  table.find("tr").slice(1).each((_: number, tr: any) => {
    const tds = $(tr).find("td");
    if (tds.length < 4) return;

    const cells: string[] = [];
    tds.each((_: number, c: any) => {
      cells.push($(c).text().replace(/\s+/g, " ").trim());
    });

    // Build sender side.
    let senderCode = "";
    let senderTitle = "";
    let senderCred = "";
    if (senderSubjIdx >= 0 && senderCrseIdx >= 0) {
      senderCode = `${cells[senderSubjIdx] || ""} ${cells[senderCrseIdx] || ""}`.trim();
    } else if (cells.length >= 2) {
      senderCode = `${cells[0]} ${cells[1]}`.trim();
    }
    if (senderTitleIdx >= 0) senderTitle = cells[senderTitleIdx] || "";
    if (senderCredIdx >= 0) senderCred = cells[senderCredIdx] || "";

    const senderSplit = splitCourseCode(senderCode);
    if (!senderSplit) return;

    // Build receiver side.
    let recvCode = "";
    let recvTitle = "";
    let recvCred = "";
    if (recvSubjIdx > senderCrseIdx && recvCrseIdx > senderCrseIdx) {
      recvCode = `${cells[recvSubjIdx] || ""} ${cells[recvCrseIdx] || ""}`.trim();
    } else if (cells.length >= 5) {
      recvCode = `${cells[cells.length - 4] || cells[cells.length - 3]} ${cells[cells.length - 3]}`.trim();
    }
    if (recvTitleIdx > senderTitleIdx) recvTitle = cells[recvTitleIdx] || "";
    if (recvCredIdx > senderCredIdx) recvCred = cells[recvCredIdx] || "";

    const classified = classifyReceiver(recvCode, recvTitle);

    out.push({
      state: STATE,
      cc_prefix: senderSplit.prefix,
      cc_number: senderSplit.number,
      cc_course: `${senderSplit.prefix} ${senderSplit.number}`,
      cc_title: senderTitle,
      cc_credits: senderCred,
      university: receiver.slug,
      university_name: receiver.name,
      univ_course: classified.univ_course,
      univ_title: classified.univ_title,
      univ_credits: recvCred,
      notes: "",
      no_credit: classified.no_credit,
      is_elective: classified.is_elective,
    });
  });

  return out;
}

async function scrapePair(
  sender: { id: string; slug: string },
  receiver: { id: string; slug: string; name: string },
): Promise<TransferMapping[]> {
  // Empty subj+crse = "show all equivalencies" per UH SIS form behavior.
  const body = `s=${sender.id}&i=${receiver.id}&subj=&crse=&sem=&y=&btn=SEARCH&debug=N`;
  const html = await postForm(body);
  // Drop snapshot HTML for inspection on the first pair so we can validate parser shape.
  if (sender.id === "1801" && receiver.id === "4867") {
    try {
      fs.writeFileSync("/tmp/uhdad-sample.html", html);
    } catch {
      /* best effort */
    }
  }
  return parseResults(html, sender, receiver);
}

async function main() {
  const args = process.argv.slice(2);
  const collegeIdx = args.indexOf("--college");
  const collegeFilter = collegeIdx >= 0 ? args[collegeIdx + 1] : undefined;
  const noImport = args.includes("--no-import");

  console.log("HI Transfer Equivalency Scraper (UH SIS uhdad)");
  console.log(`  Source: ${ENDPOINT}\n`);

  const senders = collegeFilter
    ? CC_SENDERS.filter((s) => s.slug === collegeFilter)
    : CC_SENDERS;
  if (senders.length === 0) {
    console.error(`Unknown college: ${collegeFilter}. Known: ${CC_SENDERS.map((s) => s.slug).join(", ")}`);
    process.exit(1);
  }

  const allMappings: TransferMapping[] = [];
  const failures: { sender: string; receiver: string; error: string }[] = [];

  for (const sender of senders) {
    let senderTotal = 0;
    for (const receiver of RECEIVERS) {
      try {
        const rows = await scrapePair(sender, receiver);
        allMappings.push(...rows);
        senderTotal += rows.length;
        console.log(`  ${sender.slug} → ${receiver.slug}: ${rows.length} mappings`);
      } catch (e) {
        console.error(`  ${sender.slug} → ${receiver.slug}: FAILED — ${(e as Error).message}`);
        failures.push({ sender: sender.slug, receiver: receiver.slug, error: (e as Error).message });
      }
      await sleep(DELAY_MS);
    }
    console.log(`    ${sender.slug}: +${senderTotal} mappings (running total: ${allMappings.length})`);
    try {
      fs.writeFileSync(
        "/tmp/hi-transfer-checkpoint.json",
        JSON.stringify({ done: sender.slug, rows: allMappings.length, failures: failures.length }),
      );
      fs.writeFileSync(
        "/tmp/hi-transfer-checkpoint-data.json",
        JSON.stringify(allMappings),
      );
    } catch {
      /* checkpoint is best-effort */
    }
  }

  console.log(`\n  Total mappings: ${allMappings.length}`);
  if (failures.length > 0) {
    console.log(`  Failures: ${failures.length}`);
    for (const f of failures) console.log(`    - ${f.sender} → ${f.receiver}: ${f.error}`);
  }

  // Dedup by (cc_course, university, univ_course, univ_title).
  const seen = new Set<string>();
  const deduped = allMappings.filter((m) => {
    const key = `${m.cc_prefix}|${m.cc_number}|${m.university}|${m.univ_course}|${m.univ_title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length < allMappings.length) {
    console.log(`  After dedup: ${deduped.length} (dropped ${allMappings.length - deduped.length} duplicates)`);
  }

  deduped.sort((a, b) =>
    (a.cc_prefix.localeCompare(b.cc_prefix) ||
      a.cc_number.localeCompare(b.cc_number) ||
      a.university.localeCompare(b.university)),
  );

  const outPath = path.join(process.cwd(), "data", STATE, "transfer-equiv.json");
  fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2));
  console.log(`\n  Wrote ${deduped.length} mappings → ${outPath}`);

  if (!noImport && deduped.length > 0) {
    try {
      const { importTransfersToSupabase } = await import("../lib/supabase-import");
      await importTransfersToSupabase(STATE);
    } catch (e) {
      console.log(`  Supabase import skipped: ${(e as Error).message}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
