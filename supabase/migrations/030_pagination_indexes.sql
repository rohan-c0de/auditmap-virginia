-- 030_pagination_indexes.sql
--
-- Composite indexes that let paginated reads iterate by primary key WITHOUT a
-- sort. The data layer paginates large result sets (course catalogs, transfer
-- tables, sitemaps) and now orders every page by `id` so pages don't skip or
-- duplicate rows (unordered OFFSET pagination is non-deterministic). But
-- `ORDER BY id` on a `(state, term)`-filtered query with no supporting index
-- forces Postgres to sort the whole partition per page — which trips
-- statement_timeout on large states (CA's 2026 term is ~98k sections; an
-- ORDER BY id LIMIT 5 timed out at ~3s before these indexes). These composite
-- indexes provide the rows already in id order for each query's filter, so
-- ordered range pagination is index-only and fast (deep offsets ~100ms).
--
-- Applied to prod (Project CC) on 2026-06-06 via Supabase MCP using
-- CREATE INDEX CONCURRENTLY (non-blocking for live scraper writes). This file
-- documents them for reproducibility; CONCURRENTLY cannot run inside the
-- transaction the migration runner uses, so apply by hand if recreating.

-- courses: full-state + per-college/per-subject ordered iteration
--   (loadAllCourses, getDistinctSubjects, getDistinctCourseCodes,
--    getSitemapCourseIndex, online sections — all filter (state, term))
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_courses_state_term_id
  ON public.courses USING btree (state, term, id);

-- transfers: state-wide ordered iteration
--   (loadTransferMappings, getUniversities, getUniversitiesWithCounts,
--    getUniversitySlugsForSitemap)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_state_id
  ON public.transfers USING btree (state, id);

-- transfers: per-university ordered iteration
--   (loadTransferMappingsByUniversity — the transfer-hub hot path; big
--    receivers like the CSU/UC system pages have tens of thousands of rows)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transfers_state_university_id
  ON public.transfers USING btree (state, university, id);
