/**
 * import-courses.ts
 *
 * Bulk import course data from JSON files into Supabase.
 *
 * Usage:
 *   npx tsx scripts/import-courses.ts --state va
 *   npx tsx scripts/import-courses.ts --all
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

// Load .env.local
function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.local may not exist
  }
}

loadEnv();

const BATCH_SIZE = 500;
const ALL_STATES = ["va", "nc", "sc", "dc"];

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface CourseRow {
  state: string;
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
  start_date: string | null;
  location: string;
  campus: string;
  mode: string;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

async function importState(state: string) {
  const sb = getSupabase();
  const coursesDir = path.join(process.cwd(), "data", state, "courses");

  if (!fs.existsSync(coursesDir)) {
    console.log(`  No courses directory for ${state}, skipping.`);
    return;
  }

  const collegeSlugs = fs.readdirSync(coursesDir).filter((s) => {
    return fs.statSync(path.join(coursesDir, s)).isDirectory();
  });

  console.log(`\nImporting ${state.toUpperCase()}: ${collegeSlugs.length} college(s)`);

  let totalInserted = 0;

  for (const slug of collegeSlugs) {
    const collegeDir = path.join(coursesDir, slug);
    const termFiles = fs.readdirSync(collegeDir).filter((f) => f.endsWith(".json"));

    for (const file of termFiles) {
      const term = file.replace(".json", "");
      const filePath = path.join(collegeDir, file);
      const raw = fs.readFileSync(filePath, "utf-8");
      const sections = JSON.parse(raw) as Array<Record<string, unknown>>;

      if (sections.length === 0) continue;

      // Delete existing rows for this (state, college, term)
      const { error: delError } = await sb
        .from("courses")
        .delete()
        .eq("state", state)
        .eq("college_code", slug)
        .eq("term", term);

      if (delError) {
        console.error(`  Error deleting ${slug}/${term}:`, delError.message);
        continue;
      }

      // Prepare rows
      const rows: CourseRow[] = sections.map((s) => ({
        state,
        college_code: (s.college_code as string) || slug,
        term: (s.term as string) || term,
        course_prefix: (s.course_prefix as string) || "",
        course_number: (s.course_number as string) || "",
        course_title: (s.course_title as string) || "",
        credits: (s.credits as number) || 0,
        crn: (s.crn as string) || "",
        days: (s.days as string) || "",
        start_time: (s.start_time as string) || "",
        end_time: (s.end_time as string) || "",
        start_date: (s.start_date as string) || null,
        location: (s.location as string) || "",
        campus: (s.campus as string) || "",
        mode: (s.mode as string) || "in-person",
        instructor: (s.instructor as string) || null,
        seats_open: s.seats_open != null ? (s.seats_open as number) : null,
        seats_total: s.seats_total != null ? (s.seats_total as number) : null,
        prerequisite_text: (s.prerequisite_text as string) || null,
        prerequisite_courses: (s.prerequisite_courses as string[]) || [],
      }));

      // Insert in batches
      let inserted = 0;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error: insError } = await sb.from("courses").insert(batch);
        if (insError) {
          console.error(`  Error inserting ${slug}/${term} batch ${i}:`, insError.message);
        } else {
          inserted += batch.length;
        }
      }

      totalInserted += inserted;
      console.log(`  ${slug}/${term}: ${inserted} sections`);
    }
  }

  console.log(`  Total for ${state.toUpperCase()}: ${totalInserted} sections`);
  return totalInserted;
}

async function main() {
  const args = process.argv.slice(2);
  const stateIdx = args.indexOf("--state");
  const isAll = args.includes("--all");

  let states: string[];
  if (isAll) {
    states = ALL_STATES;
  } else if (stateIdx >= 0) {
    const s = args[stateIdx + 1];
    if (!ALL_STATES.includes(s)) {
      console.error(`Unknown state: ${s}. Available: ${ALL_STATES.join(", ")}`);
      process.exit(1);
    }
    states = [s];
  } else {
    console.log(
      "Usage:\n" +
        "  npx tsx scripts/import-courses.ts --state va\n" +
        "  npx tsx scripts/import-courses.ts --all"
    );
    return;
  }

  console.log(`Importing courses for: ${states.join(", ")}`);

  let grandTotal = 0;
  for (const state of states) {
    const count = await importState(state);
    grandTotal += count || 0;
  }

  console.log(`\nDone. Total: ${grandTotal} sections imported.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
