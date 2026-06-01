/**
 * Scrape Cape Fear Community College course schedule from their public class finder.
 *
 * Source: https://www3.cfcc.edu/class-finder/
 * Data is embedded as `var data = [...]` JSON in the page HTML.
 * Contains all terms (SP, SU, FA) in one blob.
 *
 * Usage:
 *   npx tsx scripts/nc/scrape-cape-fear.ts
 *   npx tsx scripts/nc/scrape-cape-fear.ts --term 2026SU
 */

import fs from "fs";
import path from "path";

interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  crn: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  location: string;
  campus: string;
  mode: string;
  instructor: string;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

const COLLEGE_CODE = "cape-fear";
const URL = "https://www3.cfcc.edu/class-finder/";

const DAY_MAP: Record<string, string> = {
  monday: "M",
  tuesday: "T",
  wednesday: "W",
  thursday: "Th",
  friday: "F",
  saturday: "Sa",
  sunday: "Su",
};

function parseMeeting(meeting: string): { days: string; startTime: string; endTime: string; location: string } {
  if (!meeting) return { days: "", startTime: "", endTime: "", location: "" };

  // Strip HTML tags
  const clean = meeting.replace(/<[^>]+>/g, "");

  // Take first meeting line (before ,<br> or ;,)
  const firstLine = clean.split(/;,?\s*/).filter(Boolean)[0] || "";

  // Extract days: "Monday,Wednesday" or "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday"
  const dayNames = firstLine.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:,(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))*/i);
  let days = "";
  if (dayNames) {
    const dayList = dayNames[0].split(",").map(d => DAY_MAP[d.toLowerCase()] || "").filter(Boolean);
    days = dayList.join(" ");
  }

  // Extract times: "8:00AM-9:15AM" or "11:00AM-11:50AM"
  let startTime = "";
  let endTime = "";
  const timeMatch = firstLine.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (timeMatch) {
    startTime = timeMatch[1].replace(/([AP]M)/i, " $1").replace(/\s+/g, " ").trim().toUpperCase();
    endTime = timeMatch[2].replace(/([AP]M)/i, " $1").replace(/\s+/g, " ").trim().toUpperCase();
  }

  // Extract location from the text
  // Patterns: "Wilmington Campus Union Station (U) Room 469" or "ONLINE Room Online"
  let location = "";
  const locMatch = firstLine.match(/(Wilmington Campus|North Campus|On-Line Courses|ONLINE)/i);
  if (locMatch) location = locMatch[1];

  return { days, startTime, endTime, location };
}

function termCodeFromSecTerm(secTerm: string): string {
  // "2026SP:1st mini term" → "2026SP", "2026SU" → "2026SU"
  return secTerm.split(":")[0];
}

async function main() {
  const termIdx = process.argv.indexOf("--term");
  const targetTerm = termIdx >= 0 ? process.argv[termIdx + 1] : "2026SP";

  console.log(`Cape Fear Community College Class Finder Scraper`);
  console.log(`Target term: ${targetTerm}\n`);

  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const jsonMatch = html.match(/var\s+data\s*=\s*(\[[\s\S]*?\]);/);
  if (!jsonMatch) {
    console.error("Could not find 'var data = [...]' in page HTML");
    process.exit(1);
  }

  const parsed: unknown = JSON.parse(jsonMatch[1]);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.warn("Cape Fear: unexpected data shape, skipping");
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawData = parsed as any[];
  console.log(`Found ${rawData.length} total sections in embedded JSON`);

  // Filter to target term
  const termData = rawData.filter((r) => termCodeFromSecTerm(r.sec_term) === targetTerm);
  console.log(`${termData.length} sections for ${targetTerm}`);

  const sections: CourseSection[] = [];
  let skipped = 0;

  for (const raw of termData) {
    const nameMatch = (raw.sec_name || "").match(/^([A-Z]{2,4})-(\d{3}[A-Z]?)-(.+)$/);
    if (!nameMatch) {
      skipped++;
      continue;
    }

    const prefix = nameMatch[1];
    const number = nameMatch[2];

    // Delivery method
    let mode = "in-person";
    const delivery = (raw.xsec_delivery_method || "").toLowerCase();
    if (delivery.includes("internet") || delivery.includes("online")) mode = "online";
    else if (delivery.includes("hybrid") || delivery.includes("blended")) mode = "hybrid";

    const { days, startTime, endTime, location } = parseMeeting(raw.newmeeting || "");

    // Start date is already YYYY-MM-DD
    const startDate = raw.sec_start_date || "";

    const capacityRaw = parseInt(raw.sec_capacity, 10);
    const capacity = isNaN(capacityRaw) ? null : capacityRaw;
    const seatsAvailRaw = parseInt(raw.seatsavailable, 10);
    const seatsAvail = isNaN(seatsAvailRaw) ? null : seatsAvailRaw;

    sections.push({
      college_code: COLLEGE_CODE,
      term: targetTerm,
      course_prefix: prefix,
      course_number: number,
      course_title: raw.sec_short_title || "",
      credits: isNaN(parseFloat(raw.sec_min_cred)) ? 0 : parseFloat(raw.sec_min_cred),
      crn: raw.sec_name,
      days: mode === "online" && days.split(" ").length === 7 ? "M T W Th F Sa Su" : days,
      start_time: startTime,
      end_time: endTime,
      start_date: startDate,
      location: mode === "online" ? "Online" : location || raw.location_desc || "",
      campus: raw.location_desc || "",
      mode,
      instructor: raw.sec_faculty_info || "",
      seats_open: seatsAvail,
      seats_total: capacity,
      prerequisite_text: raw.requisites || null,
      prerequisite_courses: [],
    });
  }

  console.log(`\nParsed ${sections.length} sections (${skipped} skipped)`);

  const prefixes = new Set(sections.map((s) => s.course_prefix));
  const modes = { "in-person": 0, online: 0, hybrid: 0 };
  sections.forEach((s) => modes[s.mode as keyof typeof modes]++);
  console.log(`  Subject areas: ${prefixes.size}`);
  console.log(`  In-person: ${modes["in-person"]}, Online: ${modes.online}, Hybrid: ${modes.hybrid}`);

  const eng111 = sections.filter((s) => s.course_prefix === "ENG" && s.course_number === "111");
  if (eng111.length) {
    console.log(`\n  Spot check — ENG 111 sections: ${eng111.length}`);
    eng111.slice(0, 3).forEach((s) =>
      console.log(`    ${s.crn}: ${s.days} ${s.start_time}-${s.end_time} (${s.mode}) ${s.instructor} [${s.seats_open}/${s.seats_total}]`)
    );
  }

  const outDir = path.join(process.cwd(), "data", "nc", "courses", COLLEGE_CODE);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${targetTerm}.json`);
  fs.writeFileSync(outPath, JSON.stringify(sections, null, 2));
  console.log(`\nSaved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
