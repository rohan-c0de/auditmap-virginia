/**
 * Scraper run logger — tracks every scraper execution in Supabase.
 *
 * Usage from any scraper:
 *   import { logScraperStart, logScraperEnd } from "../lib/scraper-logger";
 *
 *   const runId = await logScraperStart("ga/scrape-banner-ssb", "ga");
 *   try {
 *     const count = await scrapeAllColleges();
 *     await logScraperEnd(runId, "success", count);
 *   } catch (e) {
 *     await logScraperEnd(runId, "failure", 0, (e as Error).message);
 *     throw e;
 *   }
 *
 * Gracefully no-ops when Supabase credentials are missing (local dev).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "./load-env";

function getSupabase(): SupabaseClient | null {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Log the start of a scraper run. Returns the run ID for later logScraperEnd().
 * Returns -1 if Supabase is unavailable (graceful no-op).
 */
export async function logScraperStart(
  scraperName: string,
  state: string,
  meta?: { college?: string; term?: string }
): Promise<number> {
  const sb = getSupabase();
  if (!sb) return -1;

  try {
    const { data, error } = await sb
      .from("scraper_runs")
      .insert({
        scraper_name: scraperName,
        state,
        college_code: meta?.college || null,
        term: meta?.term || null,
        status: "running",
        workflow_run_id: process.env.GITHUB_RUN_ID || null,
      })
      .select("id")
      .single();

    if (error) {
      console.warn(`[scraper-logger] Failed to log start: ${error.message}`);
      return -1;
    }

    return data?.id ?? -1;
  } catch (e) {
    console.warn(`[scraper-logger] Failed to log start: ${(e as Error).message}`);
    return -1;
  }
}

/**
 * Log the end of a scraper run with final status and section count.
 * No-ops if runId is -1 (Supabase unavailable).
 */
export async function logScraperEnd(
  runId: number,
  status: "success" | "failure" | "partial",
  sectionsImported: number,
  errorMessage?: string
): Promise<void> {
  if (runId === -1) return;

  const sb = getSupabase();
  if (!sb) return;

  try {
    const { error } = await sb
      .from("scraper_runs")
      .update({
        status,
        sections_imported: sectionsImported,
        finished_at: new Date().toISOString(),
        error_message: errorMessage || null,
      })
      .eq("id", runId);

    if (error) {
      console.warn(`[scraper-logger] Failed to log end: ${error.message}`);
    }
  } catch (e) {
    console.warn(`[scraper-logger] Failed to log end: ${(e as Error).message}`);
  }
}
