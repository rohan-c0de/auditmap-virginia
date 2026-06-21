/**
 * aggregate-prereqs.ts (tn) — rebuild data/tn/prereqs.json from course sections.
 *
 * Runs FIRST in tn's scheduled prereqs job, before scrape-catalog-prereqs.ts.
 *
 * WHY a tn-specific wrapper rather than the generic scripts/lib version:
 *   - The generic scripts/lib/aggregate-prereqs.ts SKIPS any state whose
 *     StateConfig declares dedicated prereq scrape jobs (tn does) unless
 *     --force is passed — that guard stops the post-scrape `aggregate-prereqs
 *     <state>` step in scheduled-scrape-v2.yml from clobbering catalog output.
 *   - tn is a *hybrid*: ≈628 prereqs come from real section prerequisite_text
 *     (aggregation re-derives these every run, so they stay fresh as courses
 *     change) and ≈79 come only from the Pellissippi catalog. We want both.
 *
 * So this wrapper forces the section rebuild; preserveSourcedEntries() inside
 * aggregateState carries over the catalog scraper's `source: "pstcc"` entries
 * from the committed file, and then scrape-catalog-prereqs.ts re-merges fresh
 * catalog data on top. Net effect each run: 628 (live section-derived) + 79
 * (catalog-only) = ≈707, with neither source able to silently drop the other.
 *
 * Usage: npx tsx scripts/tn/aggregate-prereqs.ts   (extra flags ignored)
 */

import { aggregateState } from "../lib/aggregate-prereqs";

const count = aggregateState("tn", { force: true });
console.log(`✓ tn section-aggregated prereqs rebuilt: ${count} entries`);
