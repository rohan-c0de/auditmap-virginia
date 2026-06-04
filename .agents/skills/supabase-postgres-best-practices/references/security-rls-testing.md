---
title: Test RLS and SECURITY DEFINER Functions in a Rolled-Back Transaction
impact: HIGH
impactDescription: Prove owner-scoped writes work without polluting prod or needing a logged-in E2E
tags: rls, security-definer, testing, verification, auth
---

## Test RLS and SECURITY DEFINER Functions in a Rolled-Back Transaction

When a write is gated by RLS or runs inside a `SECURITY DEFINER` function keyed on `auth.uid()`, you often can't exercise it from an automated test (no real authenticated session) — and you must not leave test rows in production. Verify it server-side in a transaction you roll back.

**Incorrect (bypasses RLS, or pollutes prod):**

```sql
-- Running as the service_role / table owner BYPASSES RLS entirely,
-- so this proves nothing about the policy:
update saved_plans set target_university = 'x' where id = '...';

-- Or: insert a real test row and hope to delete it afterward — risky;
-- a failure leaves orphaned data in a real user's account.
```

**Correct (assume the real role, assert, then RAISE to roll back):**

```sql
-- Run as `authenticated` with a real user's JWT claims so RLS actually
-- applies; do the write, assert, then RAISE to abort — nothing persists.
-- The error message carries the assertion back to you.
DO $$
DECLARE pid uuid; got text;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"<real-auth-user-uuid>"}', true);
  SET LOCAL role authenticated;                 -- RLS now enforced for this txn
  INSERT INTO saved_plans (user_id, state, name, target_courses, plan_data)
    VALUES (auth.uid(), 'va', 'RLS TEST', '{}', '{}'::jsonb) RETURNING id INTO pid;
  UPDATE saved_plans SET target_university = 'university-of-virginia' WHERE id = pid;
  SELECT target_university INTO got FROM saved_plans WHERE id = pid;
  RAISE EXCEPTION 'RLS_TEST_OK got=%', got;     -- aborts the txn → 0 rows persist
END $$;
```

The same shape verifies a `SECURITY DEFINER` RPC: set the claims, `SELECT my_rpc(...)`, assert the effect, `RAISE` to roll back. It catches bugs the function body's *deferred* validation misses — e.g. a `rec->>'score'::integer` cast that throws on a real decimal value (`85.3`) but passed every fixture that used a whole number; cast via `::numeric::integer` to match how a JSON float is coerced on the live insert path. After running, confirm `select count(*)` of the sentinel row is `0` so you know the rollback held.

Reference: [Postgres DO blocks](https://www.postgresql.org/docs/current/sql-do.html) · [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
