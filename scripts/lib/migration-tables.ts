/**
 * Pure helpers for the migration-drift check (scripts/check-migration-drift.ts).
 *
 * Extracts the public tables a migration SQL file CREATEs or DROPs, so the check
 * can compute the net set of tables the repo expects to exist and compare it
 * against what's actually deployed to prod. Kept dependency-free so it can be
 * unit-tested without a database.
 */

export interface TableOps {
  created: string[];
  dropped: string[];
}

/**
 * Strip `--` line comments and block comments so a commented-out CREATE TABLE
 * in a header (every migration here has a big comment block) doesn't count.
 */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

// Matches `CREATE TABLE [IF NOT EXISTS] [public.]<name>` with optional quoting.
const CREATE_SRC =
  'CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"?public"?\\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?';
// Matches `DROP TABLE [IF EXISTS] [public.]<name>`.
const DROP_SRC =
  'DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:"?public"?\\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?';

function matchNames(sql: string, source: string): string[] {
  // Fresh regex per call so the stateful `lastIndex` of a global regex can't
  // leak between invocations.
  const re = new RegExp("\\b" + source, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) out.push(m[1]);
  return [...new Set(out)];
}

export function parseTableOps(sql: string): TableOps {
  const clean = stripSqlComments(sql);
  return {
    created: matchNames(clean, CREATE_SRC),
    dropped: matchNames(clean, DROP_SRC),
  };
}

/**
 * Net set of public tables the repo expects to exist, given migration SQL
 * strings IN ORDER. A later DROP removes an earlier CREATE so renamed/removed
 * tables don't produce false positives.
 */
export function expectedTables(migrationSqls: string[]): string[] {
  const set = new Set<string>();
  for (const sql of migrationSqls) {
    const { created, dropped } = parseTableOps(sql);
    for (const t of created) set.add(t);
    for (const t of dropped) set.delete(t);
  }
  return [...set].sort();
}
