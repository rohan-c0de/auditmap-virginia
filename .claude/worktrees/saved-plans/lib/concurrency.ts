/**
 * Concurrency-bounded task runner.
 *
 * Why this exists: several places in the data layer (`loadAllCourses`,
 * `buildTransferLookupForCourses`) fan out to dozens of parallel Supabase
 * queries via `Promise.all`. During `next build`, with multiple worker
 * processes each running these calls simultaneously, the unbounded
 * parallelism saturated Supabase's pgbouncer pool and surfaced as
 * "Timed out acquiring connection from connection pool" errors that
 * killed the production build (commit 8391a60, 2026-05-27). Capping each
 * call to a small concurrency limit trades a tiny wall-clock cost for
 * build resilience.
 *
 * Each task is a thunk — `() => Promise<T>` — so the work only starts
 * when a worker picks it up, not at array-construction time.
 */
export async function runPooled<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit), tasks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}
