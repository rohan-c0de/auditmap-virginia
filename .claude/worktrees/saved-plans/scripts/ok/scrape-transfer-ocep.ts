/**
 * scrape-transfer-ocep.ts
 *
 * Stub scraper for the Oklahoma Course Equivalency Project (OCEP), the
 * state-mandated articulation portal run by the Oklahoma State Regents
 * for Higher Education (OSRHE).
 *
 *   Public landing:    https://okhighered.org/transfer-students/course-transfer/
 *   Search tool (SPA): https://vita.okhighered.org/CourseSearch/
 *
 * STATUS: not yet implemented. This file exists so OK can be registered
 * in data/articulation-portals.json (the registry validator requires the
 * `scripts` field to point at a real file on disk). Running it currently
 * exits 0 with a clear TODO message; the auto-add-state orchestrator
 * treats that as a no-op and the per-run TODO list will still surface
 * "OCEP scraper not implemented" so it doesn't get silently skipped.
 *
 * Implementation notes for whoever picks this up:
 *   - The search tool is an ASP.NET MVC app (jQuery-driven), not a SPA.
 *     Inspect bundles/custom and the underlying form actions to see if
 *     it can be driven via plain HTTP POST (preferred) or needs Playwright.
 *   - OCEP covers ~all 13 OK two-year colleges × the OK state university
 *     system. A successful scrape would replace the per-receiver fallback
 *     for the entire state in one run (closer to the FL SCNS pattern than
 *     the VA per-receiver pattern).
 *   - Output schema: write to data/ok/transfer-equiv.json in the same
 *     shape the existing per-state transfer scrapers produce — see
 *     scripts/nc/scrape-transfer-cns.ts for a reference implementation.
 *
 * Usage:
 *   npx tsx scripts/ok/scrape-transfer-ocep.ts
 */

console.log(
  "[ok] OCEP scraper not yet implemented. Portal is registered in " +
    "data/articulation-portals.json so the auto-add-state orchestrator " +
    "no longer falls back to CollegeTransfer.Net for OK, but no transfer " +
    "data was written. See file header for implementation notes."
);
process.exit(0);
