/**
 * scrape-masstransfer.ts
 *
 * Scrapes transfer equivalency data from MassTransfer — the state-run
 * articulation system at https://www.mass.edu/masstransfer/equivalencies/.
 *
 * MassTransfer covers all 15 MA community colleges as senders (PriInstID
 * 1–15) and 14 state/UMass receivers (SecInstID 16–29). We issue one POST
 * per (sender, receiver) pair with CourseID=0 ("any course"), which returns
 * the full equivalency table between those two institutions in one request.
 * 15 × 14 = 210 requests total.
 *
 * The response is HTML. Each mapping row has this shape (simplified):
 *   <tr>
 *     <td>{sender name}</td>
 *     <td>{cc course code e.g. "ENG 111"}</td>
 *     <td>{cc course title}</td>
 *     <td>{cc credits}</td>
 *     <td>{MassTransfer block e.g. "A"}</td>
 *     <td><img alt="will transfer as equivalent to"/></td>
 *     <td>{receiver name}</td>
 *     <td>{univ course code}</td>
 *     <td>{univ course title}</td>
 *     <td>{transferred credits}</td>
 *     <td>{note}</td>
 *   </tr>
 *
 * Output: data/ma/transfer-equiv.json — same TransferMapping shape as other
 * states. `notes` carries "[slug]" prefix to identify the sender CC.
 *
 * Usage:
 *   npx tsx scripts/ma/scrape-masstransfer.ts
 *   npx tsx scripts/ma/scrape-masstransfer.ts --no-import
 *   npx tsx scripts/ma/scrape-masstransfer.ts --sender 3 --receiver 25   # one pair, for debugging
 */

import fs from "fs";
import path from "path";
import { importTransfersToSupabase } from "../lib/supabase-import.js";

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

// PriInstID → our college_slug (matches data/ma/institutions.json)
const SENDERS: Record<number, string> = {
  1: "berkshire",
  2: "bristol",
  3: "bhcc",
  4: "capecod",
  5: "gcc",
  6: "hcc",
  7: "massbay",
  8: "massasoit",
  9: "middlesex",
  10: "mwcc",
  11: "northshore",
  12: "necc",
  13: "qcc",
  14: "rcc",
  15: "stcc",
};

// SecInstID → institution name. Only 4-year institutions are interesting for
// transfer; CC→CC equivalencies (IDs 1–15) are omitted.
const RECEIVERS: Record<number, string> = {
  16: "Bridgewater State University",
  17: "Fitchburg State University",
  18: "Framingham State University",
  19: "Massachusetts College of Art and Design",
  20: "Massachusetts College of Liberal Arts",
  21: "Massachusetts Maritime Academy",
  22: "Salem State University",
  23: "Westfield State University",
  24: "Worcester State University",
  25: "University of Massachusetts at Amherst",
  26: "University of Massachusetts at Boston",
  27: "University of Massachusetts at Dartmouth",
  28: "University of Massachusetts at Lowell",
  29: "University of Massachusetts at Worcester",
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const URL = "https://www.mass.edu/masstransfer/equivalencies/PublicList.asp";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;?/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);?/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function splitCourseCode(code: string): { prefix: string; number: string } {
  // e.g. "ENG 111" → { prefix: "ENG", number: "111" }
  //      "ENGLWRIT 112" → { prefix: "ENGLWRIT", number: "112" }
  //      "ACC 101/102" → { prefix: "ACC", number: "101/102" }
  const m = code.trim().match(/^([A-Z]{2,10})\s+(.+)$/);
  if (m) return { prefix: m[1], number: m[2].trim() };
  return { prefix: "", number: code.trim() };
}

function isElective(uCode: string, uTitle: string): boolean {
  const codeUp = uCode.toUpperCase();
  const titleLow = uTitle.toLowerCase();
  if (/X{2,}$/.test(codeUp)) return true; // e.g. "ENG 1XX"
  if (/\b[1-9][Xx]{2,3}\b/.test(codeUp)) return true;
  // MassTransfer marks electives with an empty course code and titles like
  // "Major or general elective", "Major/general elective", "Free elective",
  // "Transfer credit only", etc.
  if (!codeUp.trim() && titleLow.trim()) return true;
  if (/\belective\b|\btransfer credit\b|\bunspecified\b/.test(titleLow)) return true;
  return false;
}

function isNoCredit(uCode: string, uTitle: string, note: string): boolean {
  const hay = (uCode + " " + uTitle + " " + note).toLowerCase();
  return /no (transfer )?credit|does not transfer|not transferable/.test(hay);
}

async function scrapePair(senderId: number, receiverId: number): Promise<TransferMapping[]> {
  const senderSlug = SENDERS[senderId];
  const receiverName = RECEIVERS[receiverId];
  if (!senderSlug || !receiverName) return [];

  const body = new URLSearchParams({
    dir: "from",
    PriInstID: String(senderId),
    CourseID: "0",
    SecInstID: String(receiverId),
    cmdList: "List course equivalencies",
  });

  const resp = await fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: body.toString(),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${senderSlug}→${receiverId}`);
  const html = await resp.text();

  // Find the results table — the one with `id="exTable"`.
  const tableMatch = html.match(/<div[^>]*id="exTable"[^>]*>([\s\S]*?)<\/div>/i);
  if (!tableMatch) return [];
  // Strip HTML comments before parsing: MassTransfer leaves commented-out
  // <td> cells in the markup that would otherwise be picked up by the cell
  // regex and shift column indices. Example near every row:
  //   <td ...>3</td> <!-- <td ...>B</td> --> <td ...></td>
  const tableHtml = tableMatch[1].replace(/<!--[\s\S]*?-->/g, "");

  const mappings: TransferMapping[] = [];

  // Each data row starts with a cell that has <strong>{sender name}</strong>
  // and has 10+ data cells ending with the university note. Split on <tr>
  // and parse cells.
  const rows = tableHtml.split(/<tr[^>]*>/i).slice(1);
  for (const row of rows) {
    // MassTransfer emits invalid HTML: the CC course-title cell is missing
    // its </td>, so a naive /<td>...<\/td>/ regex swallows multiple cells.
    // Terminate cells at the next <td / </td / </tr instead.
    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)(?=<td[^>]|<\/td>|<\/tr>)/gi;
    let m;
    while ((m = cellRegex.exec(row)) !== null) {
      cells.push(m[1]);
    }
    // Need 10+ cells to be a data row (header row has 11 but uses <a> links
    // rather than <strong>, and spacer rows have 1 cell).
    if (cells.length < 10) continue;

    const senderNameCell = decodeEntities(cells[0].replace(/<[^>]+>/g, ""));
    if (!senderNameCell) continue;

    const ccCodeRaw = decodeEntities(cells[1].replace(/<[^>]+>/g, ""));
    const ccTitle = decodeEntities(cells[2].replace(/<[^>]+>/g, ""));
    const ccCredits = decodeEntities(cells[3].replace(/<[^>]+>/g, ""));
    // cells[4] = Gen Ed Requirement (A, B, C, etc.)
    // cells[5] = equivalency arrow image
    const receiverNameCell = decodeEntities(cells[6].replace(/<[^>]+>/g, ""));
    const uCodeRaw = decodeEntities(cells[7].replace(/<[^>]+>/g, ""));
    const uTitle = decodeEntities(cells[8].replace(/<[^>]+>/g, ""));
    const uCredits = decodeEntities(cells[9].replace(/<[^>]+>/g, ""));
    const note = cells.length > 10 ? decodeEntities(cells[10].replace(/<[^>]+>/g, "")) : "";

    if (!ccCodeRaw) continue;
    if (ccCodeRaw.toLowerCase().startsWith("course code")) continue; // header leaked through
    // Keep rows with empty univ_course when title/note carries the info
    // (elective credit, "Not transferable", etc. — all useful signal).
    if (!uCodeRaw && !uTitle.trim()) continue;

    const { prefix: ccPrefix, number: ccNumber } = splitCourseCode(ccCodeRaw);
    if (!ccPrefix) continue;

    const noCredit = isNoCredit(uCodeRaw, uTitle, note);
    const elective = !noCredit && isElective(uCodeRaw, uTitle);
    const notePrefix = `[${senderSlug}]`;
    // MassTransfer uses "-" as a placeholder for empty notes; treat as empty.
    const cleanNote = note === "-" ? "" : note;
    const fullNote = cleanNote ? `${notePrefix} ${cleanNote}` : notePrefix;

    mappings.push({
      state: "ma",
      cc_prefix: ccPrefix,
      cc_number: ccNumber,
      cc_course: `${ccPrefix} ${ccNumber}`.trim(),
      cc_title: ccTitle,
      cc_credits: ccCredits,
      university: slugify(receiverName),
      university_name: receiverName,
      univ_course: uCodeRaw,
      univ_title: uTitle,
      univ_credits: uCredits,
      notes: fullNote,
      no_credit: noCredit,
      is_elective: elective,
    });
  }

  return mappings;
}

async function main() {
  const args = process.argv.slice(2);
  const senderArg = args.indexOf("--sender");
  const receiverArg = args.indexOf("--receiver");
  const singleSender = senderArg >= 0 ? parseInt(args[senderArg + 1]) : null;
  const singleReceiver = receiverArg >= 0 ? parseInt(args[receiverArg + 1]) : null;
  const skipImport = args.includes("--no-import");

  console.log("MassTransfer scraper — MA\n");
  const senders = singleSender ? [singleSender] : Object.keys(SENDERS).map(Number);
  const receivers = singleReceiver ? [singleReceiver] : Object.keys(RECEIVERS).map(Number);
  console.log(`  ${senders.length} senders × ${receivers.length} receivers = ${senders.length * receivers.length} requests\n`);

  const all: TransferMapping[] = [];
  const perSender = new Map<string, number>();

  for (const sid of senders) {
    for (const rid of receivers) {
      const slug = SENDERS[sid];
      const recvShort = RECEIVERS[rid].replace(/^University of Massachusetts at /, "UMass ").slice(0, 30);
      try {
        const mappings = await scrapePair(sid, rid);
        all.push(...mappings);
        perSender.set(slug, (perSender.get(slug) || 0) + mappings.length);
        process.stdout.write(`  ${slug.padEnd(12)} → ${recvShort.padEnd(32)} ${String(mappings.length).padStart(4)}\n`);
      } catch (err) {
        console.error(`  ${slug} → ${recvShort}  FAILED: ${(err as Error).message}`);
      }
      await sleep(300);
    }
  }

  const transferable = all.filter((m) => !m.no_credit);
  const direct = transferable.filter((m) => !m.is_elective).length;
  const elective = transferable.filter((m) => m.is_elective).length;

  console.log("\n=== Summary ===");
  console.log(`  Total mappings: ${all.length}`);
  console.log(`  Transferable: ${transferable.length}`);
  console.log(`    Direct equivalencies: ${direct}`);
  console.log(`    Elective credit: ${elective}`);
  console.log(`  No transfer: ${all.length - transferable.length}`);
  console.log(`\n  Per-sender:`);
  for (const [slug, count] of [...perSender.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${slug.padEnd(12)} ${count}`);
  }

  if (all.length === 0) {
    console.warn("No mappings scraped. Leaving existing data untouched.");
    return;
  }

  const outPath = path.join(process.cwd(), "data", "ma", "transfer-equiv.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2) + "\n");
  console.log(`\nSaved ${all.length} mappings → ${outPath}`);

  if (!skipImport) {
    try {
      const imported = await importTransfersToSupabase("ma");
      if (imported > 0) console.log(`Imported ${imported} rows to Supabase`);
    } catch (err) {
      console.error(`Supabase import failed: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
