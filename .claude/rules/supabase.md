---
paths:
  - "supabase/**/*.sql"
  - "scripts/import-*.ts"
  - "scripts/lib/run-migration.ts"
---
# Supabase migration rules

## File naming
- `supabase/migrations/NNN_description.sql` — zero-padded 3-digit prefix, snake_case description.
- Next number is `max(existing) + 1`. Check `ls supabase/migrations/` first — don't reuse a number.

## Every migration must
- Start with a header comment block: what it changes, why, and any operational caveats (lock impact, row counts affected, whether it can run in a transaction).
- Be **idempotent**: use `IF NOT EXISTS` / `IF EXISTS` / `CREATE OR REPLACE` so reruns are safe.
- State its execution path: Supabase Dashboard SQL Editor, or `scripts/lib/run-migration.ts`.

## Large-table operations
- The `courses` table is large (~450k rows and growing). For index creation on `courses`, use `CREATE INDEX CONCURRENTLY`. CONCURRENTLY cannot run inside a transaction — the migration must be run statement-by-statement (note this in the header).
- Never add a `NOT NULL` column to `courses` without a default; do it as a multi-step migration.

## Data content
- **Never insert fake or placeholder course data** as part of a migration or import. If a scraper produces zero rows, import zero rows — do not backfill with dummy values. Student-facing data must reflect reality.
- Imports to Supabase go through `scripts/import-courses.ts` and `scripts/import-transfers.ts`. Don't add a parallel import path.

## RLS
- Every user-owned table needs RLS enabled and policies for `select`, `insert`, `update`, `delete` scoped to `auth.uid()`. If you're unsure a table is covered, check before writing the migration — don't assume.
