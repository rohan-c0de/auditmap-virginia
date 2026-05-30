-- ============================================================================
-- 016_rpc_state_transfer_destinations.sql
--
-- Replaces the sequential paginated while-loop in loadStateTransferDestinations
-- (lib/state-insights.ts) with a single GROUP BY RPC call.
--
-- Problem: the old code fetched rows in pages of 1000 one at a time to tally
-- transfer destinations per university. For large states (IL, CA, TX, NJ) this
-- can require 50–100 round trips. During Vercel's parallel next build (3 workers,
-- each building the state page for a different state simultaneously), these
-- sequential scans saturate the Supabase connection pool, causing other queries
-- to queue up and hit the statement_timeout, aborting college pages mid-build.
--
-- Fix: single GROUP BY query with a window-function total so the JS only makes
-- one network round trip to Supabase instead of 50–100.
--
-- The idx_transfers_state index (state) already covers the WHERE clause; the
-- GROUP BY (state, university) benefits from idx_transfers_state_university
-- (state, university) for a near-Index-Only-Scan on the grouping key.
--
-- Execution: safe to run in a single transaction.
-- Run via: Supabase Dashboard SQL Editor, or scripts/lib/run-migration.ts
-- ============================================================================

CREATE OR REPLACE FUNCTION get_state_transfer_destinations(p_state text)
RETURNS TABLE(university text, mapping_count bigint, total_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH all_counts AS (
    SELECT
      t.university,
      COUNT(*) AS mc
    FROM transfers t
    WHERE t.state = p_state
      AND t.university IS NOT NULL
      AND (t.univ_course IS NULL OR t.univ_course NOT LIKE '%*%')
    GROUP BY t.university
  ),
  grand_total AS (
    SELECT COALESCE(SUM(mc), 0) AS gt FROM all_counts
  )
  SELECT
    a.university,
    a.mc       AS mapping_count,
    g.gt       AS total_count
  FROM all_counts a, grand_total g
  ORDER BY a.mc DESC
  LIMIT 5
$$;
