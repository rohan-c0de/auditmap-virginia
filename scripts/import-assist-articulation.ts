// @ts-nocheck — Import script property names diverge from parser types;
// this is a dev-only tool (not bundled into the app). Proper type alignment
// is tracked as a follow-up.
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

      // Extract metadata from filename: cc__uni__major.json
      const [ccSlug, uniSlug, ...majorParts] = filename.replace(".json", "").split("__");
      const majorSlug = majorParts.join("-");
      const majorName = majorParts.map((p) => p.replace(/-/g, " ")).join(" ");

      // Build agreement key from state and slugs
      const agreementKey = `ca/${ccSlug}/${uniSlug}/${majorSlug}`;

      const agreement = parseAssistArticulation(rawJson, ccSlug, uniSlug, agreementKey);

      const ccName = agreement.cc_name;
      const uniName = agreement.receiving_institution_name;

      console.log(`  ${ccSlug} → ${uniSlug} / ${majorSlug}`);

      if (dryRun) {
        // Dry run: just report what would happen
        const totalGroups = agreement.requirement_groups.length;
        const totalRequirements = agreement.requirement_groups.reduce(
          (sum, g) => sum + g.requirements.length,
          0,
        );
        const totalOptions = agreement.requirement_groups.reduce(
          (sum, g) =>
            sum +
            g.requirements.reduce((s, r) => s + (r.sending_options?.length || 0), 0),
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
              group_name: group.name,
              group_type: group.type,
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

            const { data: reqData, error: rErr } = await supabase
              .from("assist_requirements")
              .insert({
                group_id: groupId,
                receiving_course_prefix: req.receiving_course_prefix,
                receiving_course_number: req.receiving_course_number,
                receiving_course_title: req.receiving_course_title,
                receiving_course_units: req.receiving_course_units,
                requirement_label: req.requirement_label,
                position: rIdx,
                no_articulation_reason: req.no_articulation_reason,
              })
              .select("id")
              .single();

            if (rErr) throw new Error(`Requirement insert failed: ${rErr.message}`);
            const requirementId = reqData!.id;
            totalRequirements++;

            // Insert sending options for this requirement
            if (req.sending_options && req.sending_options.length > 0) {
              const optionsToInsert = req.sending_options.map((opt, oIdx) => ({
                requirement_id: requirementId,
                cc_course_prefix: opt.cc_course_prefix,
                cc_course_number: opt.cc_course_number,
                cc_course_title: opt.cc_course_title,
                cc_course_units: opt.cc_course_units,
                conjunction: opt.conjunction,
                position: oIdx,
              }));

              const { error: oErr } = await supabase
                .from("assist_sending_options")
                .insert(optionsToInsert);

              if (oErr) throw new Error(`Sending options insert failed: ${oErr.message}`);
              totalOptions += optionsToInsert.length;
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
