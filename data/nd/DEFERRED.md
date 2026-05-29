# Deferred Work — North Dakota

## Tribal Colleges (2 colleges, Phase 1 deferred)

The following tribal colleges have their SIS platforms out of scope for Phase 1 due to custom/proprietary platform requirements, WAF protections, or Jenzabar authentication gates:

### Not Deferred (PeopleSoft covered)
- **Cankdeska Cikana Community College** (CCCC) — verified: uses shared NDUS PeopleSoft NDCSPRD tenant for institutional courses (will be included in PS cluster scrape once implemented). **Note: Currently publishes fall 2026 only; Spring 2026 may not yet be open for public search.**
- **Nueta Hidatsa Sahnish College** (NHSC) — verified: uses shared NDUS PeopleSoft NDCSPRD tenant for institutional courses (will be included in PS cluster scrape once implemented).
- **Sitting Bull College** (SBC) — TBD: Jenzabar (proprietary); requires investigation of guest access paths.

## Future Work (Phases 2–3)

1. **Fall 2026 Course Scrape** (attempted 2026-05-29, PS stability blocker)
   - Attempted re-run of all 5 NDUS CC scrapers for Fall 2026 term (term code `2710` → `2026FA`)
   - **Status**: Failed at BSC [3/88] AGEC — PeopleSoft search endpoint became unstable (5 consecutive failures)
   - This is a known PS Community Access stability pattern; can be retried later or manual college supplement
   - Spring 2026 is complete and committed; Fall 2026 can be re-attempted if PS stabilizes or deferred to manual term supplement

2. **Cleancatalog Prereqs** (Dakota College at Bottineau, NDSCS; ~1.5 hrs)
   - Both colleges use Cleancatalog; currently Cloudflare WAF-blocked on direct HTTP
   - Requires Playwright-based catalog scraping with headless browser

3. **PDF-only Prereqs** (Lake Region State College; ~45 min)
   - LRSC publishes catalog as PDF only (no web-accessible Cleancatalog)
   - Will require PDF extraction + course regex parsing

4. **Jenzabar Course Scrape** (Sitting Bull; TBD)
   - Verify public guest access to class search before committing to scraper
   - If auth-gated, defer as manual TODO

5. **Major-Specific Articulations** (~3–4 hrs, future)
   - GERTA covers gen-ed 1:1 transfers only
   - Major-specific transfers would require per-receiver TES (CollegeSource) scraping
   - Out of scope for Phase 1 (covered in Phase 3)
