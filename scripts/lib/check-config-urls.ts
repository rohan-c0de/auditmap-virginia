/**
 * check-config-urls.ts
 *
 * Daily / weekly HEAD-request sweep of every URL declared in StateConfig
 * across every state in the registry. Catches dead links in:
 *   - StateConfig.systemUrl (one per state)
 *   - StateConfig.seniorWaiver.legalCitation (one per state, when present)
 *   - StateConfig.courseDiscoveryUrl(...) (sampled with one college's data)
 *   - StateConfig.collegeCoursesUrl(...) (sampled with one college's data)
 *
 * URLs go stale silently: a state agency rebrands, a college closes a
 * campus, a senior-waiver policy citation moves. Users hit 404s before
 * we hear about it. This check surfaces those before they reach the
 * site.
 *
 * Output: one JSON status file. Workflow opens / updates a single
 * rolling issue if any URL fails.
 *
 * Usage:
 *   npx tsx scripts/lib/check-config-urls.ts
 *   npx tsx scripts/lib/check-config-urls.ts --status-out /tmp/url-check.json
 *   npx tsx scripts/lib/check-config-urls.ts --timeout-ms 10000
 */

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAllStates } from "../../lib/states/registry";

interface CheckResult {
  state: string;
  field: string;
  url: string;
  status: number | null;
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const statusOut = arg("status-out");
const timeoutMs = parseInt(arg("timeout-ms") ?? "10000", 10);

// ---------------------------------------------------------------------------
// URL extraction
// ---------------------------------------------------------------------------

function pickSampleCollege(state: string): { slug: string; zip: string } | null {
  const path = join("data", state, "institutions.json");
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    const arr = Array.isArray(data) ? data : data.institutions ?? data.colleges ?? [];
    if (arr.length === 0) return null;
    const first = arr[0];
    return {
      slug: first.slug ?? first.collegeSlug ?? first.id ?? "",
      zip: first.zip ?? first.zipCode ?? "",
    };
  } catch {
    return null;
  }
}

function collectUrlsToCheck(): Array<{ state: string; field: string; url: string }> {
  const out: Array<{ state: string; field: string; url: string }> = [];
  for (const cfg of getAllStates()) {
    if (cfg.systemUrl) {
      out.push({ state: cfg.slug, field: "systemUrl", url: cfg.systemUrl });
    }
    if (cfg.seniorWaiver?.legalCitation) {
      const url = cfg.seniorWaiver.legalCitation;
      // Some legal citations are not URLs (raw § statute refs). Skip those.
      if (/^https?:\/\//i.test(url)) {
        out.push({ state: cfg.slug, field: "seniorWaiver.legalCitation", url });
      }
    }
    // Sample courseDiscoveryUrl / collegeCoursesUrl with one college's data.
    // We aren't trying to validate every college — just that the URL-shape
    // generator still produces a URL the source site recognizes. Empty
    // strings and non-http(s) returns are pushed under a synthetic
    // BOOTSTRAP_STUB_URL so probe() surfaces them as bootstrap leftovers —
    // auto-add-state seeds the helpers with "" when no per-college lookup
    // exists yet, and that needs to fail the URL-health check before the
    // state ships data (not be silently skipped).
    const sample = pickSampleCollege(cfg.slug);
    if (sample && sample.slug) {
      try {
        const url = cfg.courseDiscoveryUrl(sample.slug, "ENG", "101");
        if (url && /^https?:\/\//i.test(url)) {
          out.push({ state: cfg.slug, field: "courseDiscoveryUrl(sample)", url });
        } else {
          out.push({
            state: cfg.slug,
            field: "courseDiscoveryUrl(sample)",
            url: BOOTSTRAP_STUB_URL,
          });
        }
      } catch {
        // Some states throw if the slug isn't recognized — skip.
      }
      try {
        const url = cfg.collegeCoursesUrl(sample.slug);
        if (url && /^https?:\/\//i.test(url)) {
          out.push({ state: cfg.slug, field: "collegeCoursesUrl(sample)", url });
        } else {
          out.push({
            state: cfg.slug,
            field: "collegeCoursesUrl(sample)",
            url: BOOTSTRAP_STUB_URL,
          });
        }
      } catch {
        // Same — skip if slug not recognized.
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// HEAD probe
// ---------------------------------------------------------------------------

// Placeholder URLs left over from auto-add-state bootstrap that weren't
// curated. example.edu / example.com both legitimately resolve (returning
// 200), so probe() can't detect these — we filter them out separately and
// mark them as failed regardless of HTTP status. BOOTSTRAP_STUB_URL is a
// synthetic sentinel collectUrlsToCheck() emits when a state's
// courseDiscoveryUrl/collegeCoursesUrl returns "" or a non-http(s) value
// (the new bootstrap default — see scripts/lib/bootstrap-state.ts).
const PLACEHOLDER_HOSTS = ["example.edu", "example.com", "example.org"];
const BOOTSTRAP_STUB_URL = "https://bootstrap-stub.invalid/";

function isPlaceholder(url: string): boolean {
  if (url === BOOTSTRAP_STUB_URL) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PLACEHOLDER_HOSTS.some((p) => host === p || host.endsWith("." + p));
  } catch {
    return false;
  }
}

async function probe(url: string): Promise<{ status: number | null; ok: boolean; error?: string }> {
  if (isPlaceholder(url)) {
    const why =
      url === BOOTSTRAP_STUB_URL
        ? "empty / non-http(s) URL (auto-add-state bootstrap leftover — wire courseDiscoveryUrl/collegeCoursesUrl to a real per-college lookup)"
        : "placeholder URL (auto-add-state bootstrap leftover)";
    return { status: null, ok: false, error: why };
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Try HEAD first; many servers refuse HEAD with 405, fall back to GET.
    let resp = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "cc-coursemap-url-check/1.0" },
    });
    if (resp.status === 405 || resp.status === 501) {
      resp = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "cc-coursemap-url-check/1.0" },
      });
    }
    return { status: resp.status, ok: resp.ok };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: null, ok: false, error: msg };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const checks = collectUrlsToCheck();
  console.log(`Checking ${checks.length} URLs across ${getAllStates().length} states...`);

  // Bounded concurrency: don't pound any single state's host. Sequential by
  // (state, field) is plenty fast — ~17 states × ~4 URLs each, ~5s per
  // probe worst case = under 6 minutes.
  const results: CheckResult[] = [];
  for (const c of checks) {
    const r = await probe(c.url);
    results.push({
      state: c.state,
      field: c.field,
      url: c.url,
      status: r.status,
      ok: r.ok,
      error: r.error,
    });
    const flag = r.ok ? "✓" : "✗";
    console.log(`  ${flag} ${c.state}/${c.field} → ${r.status ?? "ERR"} ${c.url}`);
  }

  const failures = results.filter((r) => !r.ok);
  console.log(`\n${failures.length} failure(s) of ${results.length} checked.`);

  const summary = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    failures: failures.length,
    results,
  };

  if (statusOut) {
    writeFileSync(statusOut, JSON.stringify(summary, null, 2));
  }

  // Always print the failure list to stdout for workflow logs.
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  ${f.state}/${f.field}: ${f.status ?? "ERR"} ${f.url}${f.error ? ` — ${f.error}` : ""}`);
    }
  }

  // Exit code 0 either way — workflow looks at the JSON to decide whether
  // to open / update / close the rolling issue.
}

main().catch((err) => {
  console.error("URL check failed:", err);
  process.exit(1);
});
