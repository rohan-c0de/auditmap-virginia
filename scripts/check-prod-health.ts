/**
 * Production smoke-test gate.
 *
 * Why this exists:
 * On 2026-06-01 the merge -> Supabase import pipeline silently froze for ~5.5
 * hours. Scrapers ran, PRs merged, scheduled-scrape jobs landed cleanly — and
 * none of it reached students because import-on-merge.yml was timing out at
 * the courses step. The CLAUDE.md "post-merge prod check" exists for exactly
 * this case, but it's a manual habit. This script automates it.
 *
 * What it checks:
 *   1. Production course-search returns a real (non-404, non-504) response
 *      for a small set of representative states (mix of big/small/recently-
 *      stranded). If any 504 or returns 0 sections, that's a finding.
 *   2. The most recent import-on-merge run that actually completed has a
 *      `success` conclusion AND happened recently enough (default: 6h). If
 *      every recent run is `cancelled`/`failure`, that means data is queuing
 *      up in the repo but not reaching Supabase — the exact incident shape.
 *
 * Exit code:
 *   0  all checks passed
 *   1  at least one check failed (the GH workflow turns this into a red
 *      check run + opens / comments on a single rolling issue)
 *
 * The state list deliberately sticks to ~5 — enough to cover the failure
 * modes we've actually seen (large-state 504, recently-stranded data, brand-
 * new states, default state) without burning the 30/min rate limit. The
 * import-age check is the cheaper and more important signal: it catches the
 * silent-freeze pattern even if every probed state happens to be healthy.
 */

const PROD_BASE = process.env.PROD_BASE_URL ?? "https://communitycollegepath.com";
const GH_REPO = process.env.GH_REPO ?? "rohan-c0de/cc-coursemap";
const IMPORT_WORKFLOW_FILE = "import-on-merge.yml";
const IMPORT_MAX_AGE_HOURS = Number(process.env.IMPORT_MAX_AGE_HOURS ?? "6");

// Representative probe set. Picked to cover the failure modes we've actually
// observed: ca = largest-state-by-data (504 risk), va = origin state (always
// must work), nh = the 2026-06-01 horizon bug (regression guard for #1045),
// ok = the 50k-transfer recovery (data-completeness regression guard), dc =
// smallest-data state (catches edge cases that fail for "0 colleges" reasons).
// Keep at ~5. Bigger = more rate-limit pressure with diminishing signal.
const PROBE_STATES = ["ca", "va", "nh", "ok", "dc"];
const PROBE_QUERY = "english";

interface ProdProbeResult {
  state: string;
  ok: boolean;
  detail: string;
}

interface SearchResponse {
  totalSections?: number;
  totalCourses?: number;
  servedTerm?: string;
  error?: string;
}

async function probeState(state: string): Promise<ProdProbeResult> {
  const url = `${PROD_BASE}/api/${state}/courses/search?q=${PROBE_QUERY}&limit=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "ccpath-prod-health/1.0" },
    });
    if (res.status === 504) {
      return { state, ok: false, detail: `HTTP 504 (function timeout)` };
    }
    if (!res.ok) {
      return { state, ok: false, detail: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as SearchResponse;
    if (body.error) return { state, ok: false, detail: `error: ${body.error}` };
    // 0 sections for "english" on any populated state strongly indicates the
    // current-term resolution or the import pipeline is broken. We don't
    // assert a minimum count — the canary is just "did we see ANYTHING."
    if (!body.totalSections || body.totalSections === 0) {
      return {
        state,
        ok: false,
        detail: `0 sections for q=${PROBE_QUERY} (servedTerm=${body.servedTerm ?? "?"})`,
      };
    }
    return {
      state,
      ok: true,
      detail: `${body.totalSections} sections, term=${body.servedTerm ?? "?"}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { state, ok: false, detail: `fetch failed: ${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

interface ImportAgeCheck {
  ok: boolean;
  detail: string;
}

async function checkImportAge(): Promise<ImportAgeCheck> {
  const url = `https://api.github.com/repos/${GH_REPO}/actions/workflows/${IMPORT_WORKFLOW_FILE}/runs?per_page=20`;
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    "User-Agent": "ccpath-prod-health/1.0",
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: `GitHub API fetch failed: ${msg}` };
  }
  if (!res.ok) {
    return { ok: false, detail: `GitHub API HTTP ${res.status}` };
  }
  const json = (await res.json()) as {
    workflow_runs?: Array<{
      conclusion: string | null;
      status: string;
      created_at: string;
      html_url: string;
    }>;
  };
  const runs = json.workflow_runs ?? [];
  // The new import-on-merge runs as a `plan` job that fans out to courses /
  // transfers / programs. The OVERALL `runs` API gives us the umbrella run's
  // conclusion. We accept `success` only — a `cancelled` or `failure` means
  // at least one datatype didn't land. (Programs/transfers/courses each fall
  // into the umbrella's conclusion via GH's job rollup.)
  const lastSuccess = runs.find((r) => r.conclusion === "success");
  if (!lastSuccess) {
    return {
      ok: false,
      detail: `no successful import in last ${runs.length} runs (looked back ${runs.length} runs)`,
    };
  }
  const ageMs = Date.now() - new Date(lastSuccess.created_at).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours > IMPORT_MAX_AGE_HOURS) {
    return {
      ok: false,
      detail: `last successful import was ${ageHours.toFixed(1)}h ago (threshold ${IMPORT_MAX_AGE_HOURS}h) — ${lastSuccess.html_url}`,
    };
  }
  return {
    ok: true,
    detail: `last successful import ${ageHours.toFixed(1)}h ago`,
  };
}

async function runProdHealthCheck() {
  console.log(`prod health check — base=${PROD_BASE} repo=${GH_REPO}`);
  console.log("");

  // Sequential probes — keeps us well under the 30/min IP rate limit on the
  // search route and produces interleaved logs that are easier to read.
  const probeResults: ProdProbeResult[] = [];
  for (const s of PROBE_STATES) {
    const r = await probeState(s);
    probeResults.push(r);
    console.log(`  ${r.ok ? "OK " : "FAIL"} probe ${s}: ${r.detail}`);
    // Brief throttle so we don't accidentally trip the 30/min limit when the
    // workflow runs alongside other automation hitting prod.
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log("");
  const importCheck = await checkImportAge();
  console.log(
    `  ${importCheck.ok ? "OK " : "FAIL"} import pipeline: ${importCheck.detail}`,
  );

  console.log("");
  const failures = [
    ...probeResults.filter((r) => !r.ok).map((r) => `probe ${r.state}: ${r.detail}`),
    ...(importCheck.ok ? [] : [`import pipeline: ${importCheck.detail}`]),
  ];
  if (failures.length === 0) {
    console.log(`PASS — ${probeResults.length} probes + import age check all green.`);
    process.exit(0);
  }
  console.log(`FAIL — ${failures.length} issue(s):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}

runProdHealthCheck().catch((err) => {
  console.error("prod-health-check crashed:", err);
  process.exit(2);
});

// Make this file a module so its top-level interfaces and `main` function
// don't pollute the global scope. Without this they collide with similarly-
// named declarations in other `scripts/**` files (e.g. ProdProbeResult / main
// in scripts/sc/discover-sc-systems.ts) under the project-wide tsc compile.
export {};
