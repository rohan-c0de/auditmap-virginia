/**
 * import-assist-articulation.ts — Import CA ASSIST.org fixtures into Supabase
 *
 * Reads 145 articulation JSON fixtures from scripts/ca/fixtures/articulation/,
 * parses each with the Phase 2 parser, and imports into assist_* tables.
 *
 * Usage:
 *   npx tsx scripts/import-assist-articulation.ts [--dry-run] [--force]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { parseAssistArticulation } from "./ca/parse-assist-articulation.js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseKey);
const fixturesDir = path.join(process.cwd(), "scripts", "ca", "fixtures", "articulation");

// Map of CC slugs to full names (from ASSIST institutions)
const CC_NAMES: Record<string, string> = {
  "american-river-college": "American River College",
  "de-anza-college": "De Anza College",
  "diablo-valley-college": "Diablo Valley College",
  "east-los-angeles-college": "East Los Angeles College",
  "fullerton-college": "Fullerton College",
  "long-beach-city-college": "Long Beach City College",
  "mount-san-antonio-college": "Mount San Antonio College",
  "orange-coast-college": "Orange Coast College",
  "pasadena-city-college": "Pasadena City College",
  "santa-monica-college": "Santa Monica College",
};

// Map of university slugs to full names
const UNI_NAMES: Record<string, string> = {
  "california-state-university-long-beach": "California State University, Long Beach",
  "san-diego-state-university": "San Diego State University",
  "university-of-california-berkeley": "University of California, Berkeley",
  "university-of-california-los-angeles": "University of California, Los Angeles",
  "university-of-california-san-diego": "University of California, San Diego",
};

interface ImportResult {
  filename: string;
  ccSlug: string;
  ccName: string;
  uniSlug: string;
  uniName: string;
  majorSlug: string;
  majorName: string;
  agreementId: number;
  groupsInserted: number;
  requirementsInserted: number;
  sendingOptionsInserted: number;
  error?: string;
}

async function main() {
  console.log(`ASSIST.org articulation import for CA (${dryRun ? "DRY RUN" : "LIVE"})\n`);

  // 1. Enumerate fixtures
  const files = fs
    .readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".json") && f !== "_index.json")
    .sort();

  console.log(`Found ${files.length} fixtures to import\n`);

  if (files.length === 0) {
    console.log("No fixtures found. Exiting.");
    return;
  }

  // 2. Load existing agreements (for change-detection)
  let existingCount = 0;
  if (!dryRun) {
    const { count } = await supabase
      .from("assist_agreements")
      .select("id", { count: "exact", head: true })
      .eq("state", "ca");
    existingCount = count || 0;
  }

  const results: ImportResult[] = [];

  // 3. Import each fixture
  for (const filename of files) {
    const filepath = path.join(fixturesDir, filename);

    try {
      // Parse fixture
      const rawJson = JSON.parse(fs.readFileSync(filepath, "utf-8"));
      const agreement = parseAssistArticulation(rawJson);

      // Extract metadata from filename: cc__uni__major.json
      const [ccSlug, uniSlug, ...majorParts] = filename.replace(".json", "").split("__");
      const majorSlug = majorParts.join("-");
      const majorName = majorParts.map((p) => p.replace(/-/g, " ")).join(" ");

      // Get institution names from the mapping (or use parser's major_label as fallback)
      const ccName = CC_NAMES[ccSlug] || ccSlug;
      const uniName = UNI_NAMES[uniSlug] || uniSlug;

      console.log(`  ${ccSlug} → ${uniSlug} / ${majorSlug}`);

      if (dryRun) {
        // Dry run: just report what would happen
        const totalGroups = agreement.requirement_groups.length;
        const totalRequirements = agreement.requirement_groups.reduce(
          (sum, g) => sum + g.requirements.length,
          0,
        );
        // Count total sending options by flattening each requirement's sending array
        const totalOptions = agreement.requirement_groups.reduce(
          (sum, g) =>
            sum +
            g.requirements.reduce((s, r) => {
              // Parser outputs r.sending as array of {conjunction, courses}
              // Each course in each group becomes one database row
              return s + (r.sending || []).reduce((cs, sg: any) => cs + (sg.courses?.length || 0), 0);
            }, 0),
          0,
        );

        results.push({
          filename,
          ccSlug,
          ccName,
          uniSlug,
          uniName,
          majorSlug,
          majorName,
          agreementId: 0,
          groupsInserted: totalGroups,
          requirementsInserted: totalRequirements,
          sendingOptionsInserted: totalOptions,
        });

        console.log(
          `    → ${totalGroups} groups, ${totalRequirements} requirements, ${totalOptions} options`,
        );
      } else {
        // Live import
        // 1. Upsert agreement
        // Note: the agreement_key column is UNIQUE, so we upsert on it
        const { data: agreementData, error: agErr } = await supabase
          .from("assist_agreements")
          .upsert(
            {
              state: "ca",
              cc_id: agreement.cc_id || 0,
              cc_name: ccName,
              cc_slug: ccSlug,
              receiving_institution_id: agreement.receiving_institution_id || 0,
              receiving_institution_name: uniName,
              receiving_institution_slug: uniSlug,
              major_name: majorName,
              major_slug: majorSlug,
              academic_year_id: 76,
              agreement_key: `ca-${ccSlug}-${uniSlug}-${majorSlug}`,
            },
            { onConflict: "agreement_key" },
          )
          .select("id")
          .single();

        if (agErr) throw new Error(`Agreement upsert failed: ${agErr.message}`);
        const agreementId = agreementData!.id;

        let totalGroups = 0;
        let totalRequirements = 0;
        let totalOptions = 0;

        // 2. Insert requirement groups and their requirements + options
        for (let gIdx = 0; gIdx < agreement.requirement_groups.length; gIdx++) {
          const group = agreement.requirement_groups[gIdx];

          const { data: groupData, error: gErr } = await supabase
            .from("assist_requirement_groups")
            .insert({
              agreement_id: agreementId,
              group_name: group.area, // Parser outputs 'area', not 'name'
              group_type: group.instruction, // This stores instruction type, not group type
              position: gIdx,
            })
            .select("id")
            .single();

          if (gErr) throw new Error(`Group insert failed: ${gErr.message}`);
          const groupId = groupData!.id;
          totalGroups++;

          // Insert requirements for this group
          for (let rIdx = 0; rIdx < group.requirements.length; rIdx++) {
            const req = group.requirements[rIdx];

            // Parser outputs receiving_label and receiving_courses array
            // For database, we need individual course fields or a single course
            const firstCourse = req.receiving_courses?.[0];
            const unitsStr = firstCourse
              ? `${firstCourse.min_units}${firstCourse.max_units && firstCourse.max_units !== firstCourse.min_units ? `-${firstCourse.max_units}` : ''}`
              : null;

            const { data: reqData, error: rErr } = await supabase
              .from("assist_requirements")
              .insert({
                group_id: groupId,
                receiving_course_prefix: firstCourse?.prefix || null,
                receiving_course_number: firstCourse?.number || null,
                receiving_course_title: firstCourse?.title || null,
                receiving_course_units: unitsStr,
                requirement_label: req.receiving_label,
                position: rIdx,
                no_articulation_reason: req.no_articulation_reason,
              })
              .select("id")
              .single();

            if (rErr) throw new Error(`Requirement insert failed: ${rErr.message}`);
            const requirementId = reqData!.id;
            totalRequirements++;

            // Insert sending options for this requirement
            // Parser outputs 'sending' as array of {conjunction: "and"|"or", courses: SimpleCourse[]}
            // Flatten these to individual database rows
            if (req.sending && req.sending.length > 0) {
              let optionIndex = 0;
              const optionsToInsert: any[] = [];

              for (const sendingGroup of req.sending) {
                for (const course of sendingGroup.courses || []) {
                  const courseUnits = `${course.min_units}${course.max_units && course.max_units !== course.min_units ? `-${course.max_units}` : ''}`;
                  optionsToInsert.push({
                    requirement_id: requirementId,
                    cc_course_prefix: course.prefix,
                    cc_course_number: course.number,
                    cc_course_title: course.title,
                    cc_course_units: courseUnits,
                    conjunction: sendingGroup.conjunction === "and" ? "AND" : "OR",
                    position: optionIndex++,
                  });
                }
              }

              if (optionsToInsert.length > 0) {
                const { error: oErr } = await supabase
                  .from("assist_sending_options")
                  .insert(optionsToInsert);

                if (oErr) throw new Error(`Sending options insert failed: ${oErr.message}`);
                totalOptions += optionsToInsert.length;
              }
            }
          }
        }

        results.push({
          filename,
          ccSlug,
          ccName,
          uniSlug,
          uniName,
          majorSlug,
          majorName,
          agreementId,
          groupsInserted: totalGroups,
          requirementsInserted: totalRequirements,
          sendingOptionsInserted: totalOptions,
        });

        console.log(
          `    ✓ ${totalGroups} groups, ${totalRequirements} requirements, ${totalOptions} options`,
        );
      }
    } catch (err: any) {
      results.push({
        filename,
        ccSlug: "",
        ccName: "",
        uniSlug: "",
        uniName: "",
        majorSlug: "",
        majorName: "",
        agreementId: 0,
        groupsInserted: 0,
        requirementsInserted: 0,
        sendingOptionsInserted: 0,
        error: err.message,
      });

      console.log(`    ✗ Error: ${err.message}`);
    }
  }

  // 4. Summary
  const successful = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);

  console.log(`\n=== Summary ===`);
  console.log(`  Successful: ${successful.length}/${files.length}`);
  console.log(`  Failed: ${failed.length}/${files.length}`);

  if (successful.length > 0) {
    const totalGroups = successful.reduce((s, r) => s + r.groupsInserted, 0);
    const totalReqs = successful.reduce((s, r) => s + r.requirementsInserted, 0);
    const totalOpts = successful.reduce((s, r) => s + r.sendingOptionsInserted, 0);

    console.log(`  Total: ${totalGroups} groups, ${totalReqs} requirements, ${totalOpts} options`);

    if (!dryRun && !force) {
      // Change-detection
      const newCount = existingCount + successful.length;
      const changeRatio = successful.length / (existingCount || successful.length);
      if (changeRatio < 0.5) {
        console.log(
          `\n⚠️  Warning: only ${successful.length} fixtures, but had ${existingCount} existing.`,
        );
        console.log(
          "  This might indicate missing data. Run with --force to proceed, or investigate.",
        );
        process.exit(1);
      }
    }
  }

  if (failed.length > 0) {
    console.log(`\nFailed imports:`);
    for (const r of failed) {
      console.log(`  ${r.filename}: ${r.error}`);
    }
  }

  if (dryRun) {
    console.log(`\n(Dry run — no data written to Supabase)`);
  } else {
    console.log(`\n✓ Import complete`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
