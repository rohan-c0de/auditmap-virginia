/**
 * check-migration-drift.ts — fail CI when a table defined in
 * supabase/migrations/ was never applied to the prod database.
 *
 * Background: migrations here are applied BY HAND (Supabase Dashboard / MCP) —
 * there is no automated migration-on-deploy, so the committed migration files
 * are NOT a reliable record of what's actually live. On 2026-06-04 we found 4
 * migrations authored-but-never-applied, which silently broke "Save plan"
 * (saved_plans didn't exist), seat-watch, and the /ask cache. This check parses
 * the tables the migrations CREATE and probes prod (service-role REST client)
 * to confirm each one exists. Read-only; never writes.
 *
 * Creds: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (from .env.local
 * locally, or CI secrets). If either is missing it SKIPS (exit 0) with a clear
 * message, so it never blocks forks or unconfigured CI — the owner must add the
 * secrets to make it enforce.
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./lib/load-env";
import { expectedTables } from "./lib/migration-tables";

loadEnv();

async function main() {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const sqls = files.map((f) => fs.readFileSync(path.join(dir, f), "utf-8"));
  const expected = expectedTables(sqls);
  console.log(
    `Parsed ${expected.length} expected public table(s) from ${files.length} migration file(s).`
  );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(
      "⏭  SKIP: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — " +
        "cannot probe prod.\n   Add them as CI secrets to enforce the drift check."
    );
    process.exit(0);
  }

  // Service-role REST client (bypasses RLS; mirrors lib/supabase getServiceClient).
  const sb = createClient(url, key);
  const missing: string[] = [];
  const errored: string[] = [];

  for (const table of expected) {
    // A 0-row select resolves the relation without transferring data. An
    // existing table → { error: null }; a missing one → a PostgREST error.
    const { error } = await sb.from(table).select("*").limit(0);
    if (!error) continue;
    const blob = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
    if (
      error.code === "PGRST205" ||
      blob.includes("could not find the table") ||
      blob.includes("does not exist")
    ) {
      missing.push(table);
    } else {
      errored.push(`${table}: ${error.code ?? ""} ${error.message ?? ""}`.trim());
    }
  }

  if (errored.length) {
    console.error(
      `\n⚠  ${errored.length} table(s) could not be checked (unexpected error — failing):`
    );
    for (const e of errored) console.error(`   - ${e}`);
    process.exit(1);
  }

  if (missing.length) {
    console.error(
      `\n❌ MIGRATION DRIFT — ${missing.length} table(s) defined in supabase/migrations/ ` +
        "are MISSING from prod:"
    );
    for (const t of missing) console.error(`   - ${t}`);
    console.error(
      "\nThese migrations were authored but never applied. Apply them to prod " +
        "(Supabase Dashboard SQL editor or scripts/lib/run-migration.ts) before merging " +
        "anything that depends on them. See memory feedback_verify_prod_schema_before_assuming."
    );
    process.exit(1);
  }

  console.log(`✅ No drift — all ${expected.length} migration-defined table(s) exist in prod.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("check-migration-drift crashed:", e);
  process.exit(1);
});
