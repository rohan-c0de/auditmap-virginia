/**
 * scrape-transfer.ts — Oklahoma transfer equivalencies (OCEP).
 *
 * The Oklahoma State Regents for Higher Education run the public Oklahoma
 * Course Equivalency Project (OCEP) at vita.okhighered.org. It is the
 * authoritative statewide source (CollegeTransfer.Net has no OK in-state data).
 *
 * OCEP is a *group* model: each course belongs to a statewide equivalency group
 * (e.g. "AC 201"), and every institution's course in that group is mutually
 * transferable. The tool is an ASP.NET MVC POST cascade (no JSON API):
 *   1. POST {Years}                         -> Institution dropdown
 *   2. POST {Years, Institutes}             -> Courses dropdown
 *        (option value = "<group>|<number>|<prefix>")
 *   3. POST {Years, Institutes, Courses, submitBtn} -> two HTML tables:
 *        Table 0 "Your Original Course" (source institution, code, common
 *          title, notes) and Table 1 "Equivalent Courses" ((institution, code)
 *          for every other institution sponsoring a course in the group).
 *
 * We enumerate each of the 12 OK community colleges' courses to discover the
 * statewide equivalency groups, query each group once for its full membership,
 * then emit edges from every one of our colleges present in a group to all
 * OTHER in-state institutions in that group (universities, regionals, and
 * other colleges). All members are Oklahoma institutions (in-state rule
 * satisfied by construction).
 *
 * Receiver course titles vary by institution and aren't exposed in the
 * equivalent list, so univ_title carries the OCEP "Oklahoma Common Course
 * Title" shared by the group.
 *
 * Usage:
 *   npx tsx scripts/ok/scrape-transfer.ts
 *   npx tsx scripts/ok/scrape-transfer.ts --no-import
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

const ENDPOINT = "https://vita.okhighered.org/CourseSearch/IHaveACourse";
const YEAR = "2526"; // 2025-26 (most current; returns the largest course set)
const UA = "Mozilla/5.0 (compatible; cc-coursemap)";

// Our 12 OCEP-registered OK community colleges (code → slug). College of the
// Muscogee Nation is not in OCEP, so it has no data here.
const SENDERS: { code: string; slug: string; name: string }[] = [
  { code: "CASC", slug: "carl-albert-state-college", name: "Carl Albert State College" },
  { code: "CSC", slug: "connors-state-college", name: "Connors State College" },
  { code: "EOSC", slug: "eastern-oklahoma-state-college", name: "Eastern Oklahoma State College" },
  { code: "RCC", slug: "redlands-community-college", name: "Redlands Community College" },
  { code: "MSC", slug: "murray-state-college", name: "Murray State College" },
  { code: "NOC", slug: "northern-oklahoma-college", name: "Northern Oklahoma College" },
  { code: "NEOAMC", slug: "northeastern-oklahoma-aandm-college", name: "Northeastern Oklahoma A&M College" },
  { code: "OCCC", slug: "oklahoma-city-community-college", name: "Oklahoma City Community College" },
  { code: "RSC", slug: "rose-state-college", name: "Rose State College" },
  { code: "SSC", slug: "seminole-state-college", name: "Seminole State College" },
  { code: "TCC", slug: "tulsa-community-college", name: "Tulsa Community College" },
  { code: "WOSC", slug: "western-oklahoma-state-college", name: "Western Oklahoma State College" },
];
const SENDER_NAME_TO_SLUG = new Map(SENDERS.map((s) => [s.name, s.slug]));

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
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

function splitCode(code: string): { prefix: string; number: string } {
  const m = code.trim().match(/^([A-Za-z]+)\s*([0-9][0-9A-Za-z]*)$/);
  if (m) return { prefix: m[1].toUpperCase(), number: m[2] };
  return { prefix: code.trim().toUpperCase(), number: "" };
}

async function post(data: Record<string, string>): Promise<string> {
  const body = new URLSearchParams(data).toString();
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (resp.status === 429 || resp.status >= 500) {
      await sleep((attempt + 1) * 2000);
      continue;
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.text();
  }
  throw new Error("retries exhausted");
}

function courseOptions(html: string): { value: string; text: string }[] {
  return [...html.matchAll(/<option value="([^"]*\|[^"]*)">([^<]+)<\/option>/g)].map((m) => ({
    value: m[1],
    text: decode(m[2]),
  }));
}

interface GroupData {
  commonTitle: string;
  notes: string;
  members: { name: string; code: string }[]; // every institution course in the group
}

function parseGroup(html: string): GroupData {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
  const members: { name: string; code: string }[] = [];
  let commonTitle = "";
  let notes = "";

  // Table 0: source course (institution, code, common title, notes).
  if (tables[0]) {
    const rows = [...tables[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
    for (const r of rows) {
      const cells = [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) =>
        decode(m[1].replace(/<[^>]+>/g, "")),
      );
      if (cells.length >= 3 && cells[0] && !/^institution$/i.test(cells[0]) && !/original course/i.test(cells[0])) {
        members.push({ name: cells[0], code: cells[1] });
        commonTitle = cells[2] || "";
        notes = cells[3] || "";
      }
    }
  }
  // Table 1: equivalent courses ((institution, code) pairs).
  if (tables[1]) {
    const rows = [...tables[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
    for (const r of rows) {
      const cells = [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) =>
        decode(m[1].replace(/<[^>]+>/g, "")),
      );
      if (cells.length >= 2 && cells[0] && !/^institution$/i.test(cells[0]) && !/equivalent courses/i.test(cells[0])) {
        members.push({ name: cells[0], code: cells[1] });
      }
    }
  }
  return { commonTitle, notes, members };
}

async function main() {
  const skipImport = process.argv.includes("--no-import");
  console.log("Oklahoma Course Equivalency Project (OCEP) Scraper\n");

  // 1) Enumerate each sender's courses → discover groups + a query handle each.
  // group -> { queryInstitutes, queryCourseValue }
  const groupQuery = new Map<string, { institutes: string; courseValue: string }>();
  let enumerated = 0;
  for (const s of SENDERS) {
    try {
      const html = await post({ Years: YEAR, Institutes: s.code });
      const opts = courseOptions(html);
      for (const o of opts) {
        const group = o.value.split("|")[0];
        if (!groupQuery.has(group)) groupQuery.set(group, { institutes: s.code, courseValue: o.value });
      }
      enumerated++;
      console.log(`  enumerated ${s.slug.padEnd(38)} ${opts.length} courses`);
    } catch (err) {
      console.error(`  enumerate ${s.slug}: FAILED — ${(err as Error).message}`);
    }
    await sleep(150);
  }
  console.log(`\n  ${groupQuery.size} unique equivalency groups discovered; querying each…\n`);

  // 2) Query each group once for full membership.
  const all: TransferMapping[] = [];
  let g = 0;
  for (const [group, q] of groupQuery) {
    try {
      const html = await post({ Years: YEAR, Institutes: q.institutes, Courses: q.courseValue, submitBtn: "submit" });
      const { commonTitle, notes, members } = parseGroup(html);

      // 3) Emit edges from every one of OUR colleges present in this group.
      for (const m of members) {
        const senderSlug = SENDER_NAME_TO_SLUG.get(m.name);
        if (!senderSlug) continue; // this member isn't one of our sending colleges
        const { prefix: ccPrefix, number: ccNumber } = splitCode(m.code);
        if (!ccNumber) continue;
        for (const r of members) {
          if (r.name === m.name) continue; // skip self-institution
          const { prefix: uPrefix, number: uNumber } = splitCode(r.code);
          if (!uNumber) continue;
          const elective = /elective/i.test(commonTitle);
          all.push({
            state: "ok",
            cc_prefix: ccPrefix,
            cc_number: ccNumber,
            cc_course: `${ccPrefix} ${ccNumber}`,
            cc_title: commonTitle,
            cc_credits: "",
            university: slugify(r.name),
            university_name: r.name,
            univ_course: `${uPrefix} ${uNumber}`,
            univ_title: commonTitle,
            univ_credits: "",
            notes: notes ? `[${senderSlug}] ${notes}` : `[${senderSlug}]`,
            no_credit: false,
            is_elective: elective,
          });
        }
      }
    } catch (err) {
      console.error(`  group ${group}: FAILED — ${(err as Error).message}`);
    }
    g++;
    if (g % 100 === 0) process.stdout.write(`    queried ${g}/${groupQuery.size} groups (${all.length} edges)\r`);
    await sleep(120);
  }

  // Dedupe identical edges.
  const seen = new Set<string>();
  const deduped = all.filter((m) => {
    const k = `${m.notes.match(/^\[([\w-]+)\]/)?.[1]}|${m.cc_course}|${m.university}|${m.univ_course}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const byRecv = new Map<string, number>();
  for (const m of deduped) byRecv.set(m.university_name, (byRecv.get(m.university_name) || 0) + 1);

  console.log("\n\n=== Summary ===");
  console.log(`  Senders enumerated: ${enumerated}/${SENDERS.length}`);
  console.log(`  Groups queried: ${groupQuery.size}`);
  console.log(`  Total edges: ${deduped.length}`);
  console.log("  Top receiving institutions:");
  for (const [r, c] of [...byRecv.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${r}: ${c}`);
  }

  if (deduped.length === 0) {
    console.warn("\n  WARN: no edges produced; leaving existing data untouched.");
    return;
  }

  const outPath = path.join(process.cwd(), "data", "ok", "transfer-equiv.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2) + "\n");
  console.log(`\nSaved ${deduped.length} mappings → ${outPath}`);

  if (!skipImport) {
    try {
      const imported = await importTransfersToSupabase("ok");
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
