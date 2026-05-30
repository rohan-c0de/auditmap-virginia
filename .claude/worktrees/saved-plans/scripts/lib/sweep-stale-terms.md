# Term retention policy

## Policy

For every state, the `courses` table in Supabase and the JSON files at
`data/{state}/courses/{college}/{term}.json` retain:

- **All terms ≥ current term** — the current term (broadest college coverage)
  plus everything in the future. Future terms appear early because colleges
  publish next year's schedule months ahead of the term start.
- **Up to 2 terms strictly older than current** — preserves a short trailing
  window for "did MTH-154 transfer last spring?" lookups and rollback safety.
- **Nothing older.** Anything beyond that floor gets swept on the monthly
  cron.

Term codes are sorted using `termSortKey()` in `lib/term-label.ts`, which
expects the canonical `YYYY{SP|SU|FA}` shape. Non-standard codes — IL's
`2026-FL`, CA's `26-FA`, NC's `2026CE1`, etc. — are reported as warnings
and **never deleted** by the sweep. They need a separate scraper-side fix
or manual cleanup.

## Mechanism

1. Determine `currentTerm` per state via the `get_term_college_counts` RPC
   (same logic as `lib/terms.ts#getCurrentTerm`).
2. List distinct terms in Supabase + JSON files on disk.
3. Filter to canonical-shape terms only. Sort newest-first.
4. Compute the keep set: terms with `termSortKey ≥ floor`, where the floor
   is the 2nd-oldest standard term still inside the window.
5. For every term outside the keep set:
   - `DELETE FROM courses WHERE state=? AND term=?`
   - `rm data/{state}/courses/*/{term}.json`

The sweep is idempotent — re-running with nothing stale to delete is a
no-op.

## Running it

```bash
# Dry-run across every state (default behavior for the first cron tick)
tsx scripts/lib/sweep-stale-terms.ts --dry-run

# Live sweep, all states
tsx scripts/lib/sweep-stale-terms.ts

# Limit to one state
tsx scripts/lib/sweep-stale-terms.ts --state va --dry-run
```

The `--dry-run` flag prints the planned deletes (per-state, per-term) and
flags any non-standard codes without writing anything.

## Scheduled run

`.github/workflows/sweep-stale-terms.yml` runs on the 15th of every month
at 06:00 UTC — mid-month, deliberately away from any term boundary or the
weekly scrape cron, so a still-rolling scraper can't race the sweep.

The first scheduled run is intentionally dry-run only (`SWEEP_MODE=dry-run`
env var). After the first month you can verify the planned deletions are
sane, flip the env to `SWEEP_MODE=live`, and let it run.

## What it deliberately does NOT do

- It does **not** rename or normalize non-canonical term codes. That's a
  scraper-correctness problem, not a retention problem.
- It does **not** touch transfer, programs, prereq, or articulation data —
  only `courses` and the per-term JSON files. Those datasets don't have a
  term dimension.
- It does **not** vacuum or reindex Supabase post-delete. Postgres
  handles that itself.
