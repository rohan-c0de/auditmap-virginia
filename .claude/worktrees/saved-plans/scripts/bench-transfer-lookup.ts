/**
 * Benchmark for issue #44: compares the OR-chain query (old path) against
 * the per-prefix IN query (new path) on real MA transfer data.
 *
 * Usage: tsx scripts/bench-transfer-lookup.ts
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

// Tiny .env.local loader so we don't need dotenv as a dep.
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(url, key);

const STATE = "ma";

async function pickRepresentativePairs(): Promise<{ prefix: string; number: string }[]> {
  // Pick a real MA college and use its actual course catalog as the input —
  // that's the shape buildTransferLookupForCourses sees on /college/[id].
  const { data: courses, error } = await supabase
    .from("courses")
    .select("course_prefix, course_number, college_code")
    .eq("state", STATE)
    .limit(20000);
  if (error) throw error;
  // Group by college and pick the one with the most distinct (prefix, number)
  // pairs — a worst-case build-time scenario.
  const byCollege = new Map<string, Map<string, { prefix: string; number: string }>>();
  for (const c of courses ?? []) {
    const slug = c.college_code as string;
    let m = byCollege.get(slug);
    if (!m) { m = new Map(); byCollege.set(slug, m); }
    const p = c.course_prefix as string;
    const n = c.course_number as string;
    m.set(`${p}-${n}`, { prefix: p, number: n });
  }
  let bestSlug = "";
  let bestPairs: { prefix: string; number: string }[] = [];
  for (const [slug, m] of byCollege) {
    if (m.size > bestPairs.length) {
      bestSlug = slug;
      bestPairs = Array.from(m.values());
    }
  }
  console.log(`Sample: ${bestSlug} → ${bestPairs.length} unique (prefix, number) pairs`);
  return bestPairs;
}

function rowKey(r: { cc_prefix: string; cc_number: string; university: string; univ_course: string | null }) {
  return `${r.cc_prefix}|${r.cc_number}|${r.university}|${r.univ_course ?? ""}`;
}

function diff(a: unknown[], b: unknown[]) {
  const A = new Set(a.map((r) => rowKey(r as { cc_prefix: string; cc_number: string; university: string; univ_course: string | null })));
  const B = new Set(b.map((r) => rowKey(r as { cc_prefix: string; cc_number: string; university: string; univ_course: string | null })));
  const onlyA = [...A].filter((k) => !B.has(k));
  const onlyB = [...B].filter((k) => !A.has(k));
  return { onlyA: onlyA.length, onlyB: onlyB.length };
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<{ ms: number; rows: number }> {
  const t0 = Date.now();
  const result = (await fn()) as { length?: number };
  const ms = Date.now() - t0;
  const rows = result?.length ?? 0;
  console.log(`  ${label}: ${ms}ms, ${rows} rows`);
  return { ms, rows };
}

async function runOldOrChain(pairs: { prefix: string; number: string }[]) {
  const CHUNK = 100;
  const chunks: typeof pairs[] = [];
  for (let i = 0; i < pairs.length; i += CHUNK) chunks.push(pairs.slice(i, i + CHUNK));
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const orClauses = chunk
        .map(
          (p) =>
            `and(cc_prefix.eq.${encodeURIComponent(p.prefix)},cc_number.eq.${encodeURIComponent(p.number)})`
        )
        .join(",");
      const { data, error } = await supabase
        .from("transfers")
        .select("cc_prefix, cc_number, university, univ_course, is_elective, no_credit")
        .eq("state", STATE)
        .or(orClauses);
      if (error) throw new Error(`OLD: ${error.message}`);
      return data ?? [];
    })
  );
  return results.flat();
}

async function runNewPerPrefixIn(pairs: { prefix: string; number: string }[]) {
  const byPrefix = new Map<string, Set<string>>();
  for (const p of pairs) {
    let s = byPrefix.get(p.prefix);
    if (!s) { s = new Set(); byPrefix.set(p.prefix, s); }
    s.add(p.number);
  }
  const queries: { prefix: string; numbers: string[] }[] = [];
  for (const [prefix, numSet] of byPrefix) {
    const numbers = Array.from(numSet);
    const CHUNK = 200;
    for (let i = 0; i < numbers.length; i += CHUNK) {
      queries.push({ prefix, numbers: numbers.slice(i, i + CHUNK) });
    }
  }
  const results = await Promise.all(
    queries.map(async ({ prefix, numbers }) => {
      const { data, error } = await supabase
        .from("transfers")
        .select("cc_prefix, cc_number, university, univ_course, is_elective, no_credit")
        .eq("state", STATE)
        .eq("cc_prefix", prefix)
        .in("cc_number", numbers);
      if (error) throw new Error(`NEW: ${error.message}`);
      return data ?? [];
    })
  );
  return results.flat();
}

(async () => {
  const pairs = await pickRepresentativePairs();
  const distinctPrefixes = new Set(pairs.map((p) => p.prefix)).size;
  console.log(`MA dataset, ${pairs.length} unique (prefix, number) pairs across ${distinctPrefixes} prefixes\n`);

  console.log("Equivalence check:");
  const oldRows = await runOldOrChain(pairs);
  const newRows = await runNewPerPrefixIn(pairs);
  const d = diff(oldRows, newRows);
  console.log(`  OLD: ${oldRows.length} rows  |  NEW: ${newRows.length} rows  |  onlyOLD=${d.onlyA}, onlyNEW=${d.onlyB}`);

  console.log("\nMeasured (3 runs each, alternating):");
  const old: number[] = [];
  const fresh: number[] = [];
  for (let i = 0; i < 3; i++) {
    old.push((await timed(`OLD #${i + 1}`, () => runOldOrChain(pairs))).ms);
    fresh.push((await timed(`NEW #${i + 1}`, () => runNewPerPrefixIn(pairs))).ms);
  }

  const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  console.log(`\nOLD avg: ${avg(old)}ms  |  NEW avg: ${avg(fresh)}ms  |  speedup: ${(avg(old) / avg(fresh)).toFixed(2)}x`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
