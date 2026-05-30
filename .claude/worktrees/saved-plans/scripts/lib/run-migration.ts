/**
 * Run a Supabase SQL migration using the database connection string.
 *
 * Usage:
 *   npx tsx scripts/lib/run-migration.ts supabase/migrations/004_scraper_runs.sql
 *
 * Requires DATABASE_URL in .env.local, or pass as env var:
 *   DATABASE_URL="postgresql://postgres.REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres" \
 *     npx tsx scripts/lib/run-migration.ts supabase/migrations/004_scraper_runs.sql
 *
 * You can find your connection string at:
 *   Supabase Dashboard → Settings → Database → Connection string (URI)
 *   Use the "Session mode" (port 5432) connection string.
 */

import * as fs from "fs";
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  const migrationFile = process.argv[2];
  if (!migrationFile) {
    console.error("Usage: npx tsx scripts/lib/run-migration.ts <migration-file.sql>");
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("Missing DATABASE_URL. Set it in .env.local or pass as env var.");
    console.error("");
    console.error("Find it at: Supabase Dashboard → Settings → Database → Connection string (URI)");
    console.error("Use the Session mode (port 5432) connection string.");
    console.error("");
    console.error("Example:");
    console.error('  DATABASE_URL="postgresql://postgres.yobxppofcivecboztbzm:YOUR_PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres" \\');
    console.error("    npx tsx scripts/lib/run-migration.ts " + migrationFile);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationFile, "utf-8");
  console.log(`Running migration: ${migrationFile}`);
  console.log(`SQL length: ${sql.length} chars`);
  console.log("");

  // Use psql if available (most reliable for DDL)
  const { execSync } = await import("child_process");
  try {
    execSync(`psql "${dbUrl}" -f "${migrationFile}"`, {
      stdio: "inherit",
      env: { ...process.env, PGPASSWORD: undefined }, // password is in URL
    });
    console.log("\nMigration complete!");
  } catch (e) {
    console.error("\npsql failed. Trying node-postgres fallback...");
    // Fallback: try using fetch against Supabase SQL endpoint
    console.error("Could not execute migration. Please run manually:");
    const maskedUrl = dbUrl.replace(/:([^@]+)@/, ":****@");
    console.error(`  psql "${maskedUrl}" -f ${migrationFile}`);
    console.error("");
    console.error("Or paste the SQL into: Supabase Dashboard → SQL Editor");
    process.exit(1);
  }
}

main();
