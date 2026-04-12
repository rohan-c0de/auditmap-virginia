-- ============================================================
-- Widen transfers.university column for NJ long slugs
-- e.g. "rutgers-edward-bloustein-sch-of-planning-amp-policy" (51 chars)
-- Run via Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE transfers ALTER COLUMN university TYPE VARCHAR(100);
