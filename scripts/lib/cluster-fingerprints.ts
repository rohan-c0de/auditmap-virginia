/**
 * cluster-fingerprints.ts — group colleges that share an SIS infrastructure
 *
 * After `fingerprint-college.ts` classifies each college's platform, many
 * colleges fall into the catch-all "custom" / "unknown" / untemplated buckets.
 * Without further analysis, the orchestrator emits one TODO per college —
 * even when N of those colleges actually share the same SIS (multi-college
 * community college district pattern: LACCD's 9, Los Rios' 4, Peralta's 4,
 * etc.). One bespoke scraper can then cover N colleges instead of N scrapers.
 *
 * This module identifies those clusters with two signals:
 *
 *   1. **Registrable domain.** If 2+ colleges' IPEDS-listed URLs share the
 *      same 2nd-level domain (`arc.losrios.edu`, `crc.losrios.edu`, …),
 *      they form a cluster. Cheap, no network calls.
 *
 *   2. **Shared SIS host (deep probe).** For colleges still unclustered, GET
 *      the home page and extract outbound links to known SIS-hosting
 *      hostname patterns (`mycollege-*`, `myportal-*`, `*.elluciancloud.com`,
 *      etc.). Colleges that link to the same SIS host form a cluster. This
 *      catches districts where each college owns its own .edu but the
 *      registration backend is shared (LACCD: wlac.edu, elac.edu, …, all
 *      pointing at mycollege-guest.laccd.edu).
 *
 * Output:
 *   - clusters[]: each with a stable id, the shared signal, member slugs
 *   - singletons[]: colleges that didn't cluster with anyone
 *
 * Standalone CLI:
 *   npx tsx scripts/lib/cluster-fingerprints.ts --state ca [--probe-deep] [--json]
 *
 * Integrated path: `add-state.ts` calls `clusterFingerprints()` directly
 * between Phase 2a and Phase 2b.
 */

import type { FingerprintResult } from "./fingerprint-college.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClusterInput {
  slug: string;
  name?: string;
  primaryUrl: string; // bare host like "elac.edu" (no protocol)
  fingerprint?: FingerprintResult;
}

export interface Cluster {
  /** Stable identifier (e.g. "losrios-edu", "laccd-mycollege-guest"). */
  id: string;
  /** Human-readable signal that grouped these colleges. */
  sharedSignal: string;
  signalKind: "registrable-domain" | "shared-sis-host";
  memberSlugs: string[];
  /** Per-slug URLs/hosts that put each college in the cluster. */
  evidence: Record<string, string[]>;
}

export interface ClusteringResult {
  clusters: Cluster[];
  singletons: ClusterInput[];
  /** Summary counts for the orchestrator's report. */
  summary: {
    inputCount: number;
    clusterCount: number;
    clusteredCount: number;
    singletonCount: number;
  };
}

// ---------------------------------------------------------------------------
// Domain utilities
// ---------------------------------------------------------------------------

/**
 * Strip protocol/port/path. "https://wlac.edu/foo" → "wlac.edu".
 * Lowercases.
 */
function normalizeHost(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.split("/")[0];
  s = s.split(":")[0];
  return s;
}

/**
 * Registrable (2nd-level) domain. Naive — assumes `.edu` / `.com` / `.org`
 * (which covers virtually all US CCs). Sub-domains collapse to the parent:
 *   "arc.losrios.edu"   → "losrios.edu"
 *   "wlac.edu"          → "wlac.edu"
 *   "wf.westhillscollege.com" → "westhillscollege.com"
 */
export function registrableDomain(host: string): string {
  const h = normalizeHost(host);
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  return parts.slice(-2).join(".");
}

// ---------------------------------------------------------------------------
// Step 1 — registrable-domain clustering
// ---------------------------------------------------------------------------

function clusterByRegistrableDomain(
  colleges: ClusterInput[],
): { clustered: Cluster[]; orphans: ClusterInput[] } {
  const byDomain = new Map<string, ClusterInput[]>();
  for (const c of colleges) {
    const host = c.fingerprint?.domain || c.primaryUrl;
    const rd = registrableDomain(host);
    if (!byDomain.has(rd)) byDomain.set(rd, []);
    byDomain.get(rd)!.push(c);
  }

  const clustered: Cluster[] = [];
  const orphans: ClusterInput[] = [];

  for (const [domain, members] of byDomain) {
    if (members.length < 2) {
      orphans.push(...members);
      continue;
    }
    const evidence: Record<string, string[]> = {};
    for (const m of members) {
      evidence[m.slug] = [m.fingerprint?.domain || m.primaryUrl];
    }
    clustered.push({
      id: domain.replace(/\./g, "-"),
      sharedSignal: domain,
      signalKind: "registrable-domain",
      memberSlugs: members.map((m) => m.slug),
      evidence,
    });
  }

  // Sort clusters by size descending (largest first for stable presentation)
  clustered.sort((a, b) => b.memberSlugs.length - a.memberSlugs.length);
  return { clustered, orphans };
}

// ---------------------------------------------------------------------------
// Step 2 — deep probe for shared SIS hosts
// ---------------------------------------------------------------------------

/**
 * SIS-host patterns. Hosts matching any of these on a college's home page
 * are treated as candidate cluster signals. The regex captures the host
 * portion; we use that as the cluster key.
 *
 * Heuristic-only — extending this list improves recall but can never harm
 * correctness because false positives only create extra (still-useful)
 * cluster groupings.
 */
const SIS_HOST_PATTERNS: RegExp[] = [
  // Generic PS / SSB / class-search names hosted as a subdomain anywhere
  /https?:\/\/(my(?:college|portal|sis|ccd)[^"'\s/<>]+)/gi,
  /https?:\/\/(selfservice[^"'\s/<>]+)/gi,
  /https?:\/\/(ssb(?:[-_.][^"'\s/<>]+)?\.[a-z0-9.-]+\.[a-z]{2,})/gi,
  /https?:\/\/(ss(?:[-_.][^"'\s/<>]+)?\.[a-z0-9.-]+\.[a-z]{2,})/gi,
  /https?:\/\/(classsearch[^"'\s/<>]+)/gi,
  /https?:\/\/(reg-prod[^"'\s/<>]+)/gi,
  // Vendor-hosted SaaS
  /https?:\/\/([a-z0-9.-]+\.elluciancloud\.com)/gi,
  /https?:\/\/([a-z0-9.-]+\.banner\.elluciancloud\.com)/gi,
  /https?:\/\/([a-z0-9.-]+\.jenzabarcloud\.com)/gi,
  /https?:\/\/([a-z0-9.-]+\.oraclecloud\.com)/gi,
  /https?:\/\/([a-z0-9.-]+\.colleaguess\.com)/gi,
];

async function probeForSisHosts(
  primaryUrl: string,
  signal: AbortSignal,
): Promise<string[]> {
  const host = normalizeHost(primaryUrl);
  const url = `https://${host}/`;

  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal,
      redirect: "follow",
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }

  const hosts = new Set<string>();
  for (const re of SIS_HOST_PATTERNS) {
    re.lastIndex = 0; // reset because /g regex is stateful
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const h = m[1].toLowerCase().replace(/[/?#].*$/, "");
      // Skip if it's the same registrable domain (self-reference)
      if (registrableDomain(h) === registrableDomain(host)) continue;
      hosts.add(h);
    }
  }

  return Array.from(hosts);
}

interface OrphanProbe {
  college: ClusterInput;
  hosts: string[];
}

async function clusterByDeepProbe(
  orphans: ClusterInput[],
  options: { concurrency: number; perColumnTimeoutMs: number; onProgress?: (done: number, total: number) => void },
): Promise<{ clustered: Cluster[]; stillOrphans: ClusterInput[] }> {
  if (orphans.length === 0) {
    return { clustered: [], stillOrphans: [] };
  }

  const results: OrphanProbe[] = [];
  let done = 0;
  // Crude concurrency: chunk the orphans
  for (let i = 0; i < orphans.length; i += options.concurrency) {
    const chunk = orphans.slice(i, i + options.concurrency);
    const probed = await Promise.all(
      chunk.map(async (c) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.perColumnTimeoutMs);
        try {
          const hosts = await probeForSisHosts(c.primaryUrl, controller.signal);
          return { college: c, hosts };
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    results.push(...probed);
    done += chunk.length;
    options.onProgress?.(done, orphans.length);
  }

  // Cluster by shared host. A college joins the cluster of any host
  // that 2+ colleges have in common.
  const collegesByHost = new Map<string, ClusterInput[]>();
  const evidenceByCollege = new Map<string, Map<string, string[]>>();

  for (const r of results) {
    for (const h of r.hosts) {
      if (!collegesByHost.has(h)) collegesByHost.set(h, []);
      collegesByHost.get(h)!.push(r.college);
      if (!evidenceByCollege.has(h)) evidenceByCollege.set(h, new Map());
      const m = evidenceByCollege.get(h)!;
      if (!m.has(r.college.slug)) m.set(r.college.slug, []);
      m.get(r.college.slug)!.push(h);
    }
  }

  // Greedy cluster assignment: largest cluster first, each college joins exactly one cluster.
  const sortedHosts = Array.from(collegesByHost.entries())
    .filter(([, members]) => members.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  const assigned = new Set<string>();
  const clusters: Cluster[] = [];

  for (const [host, members] of sortedHosts) {
    const unassigned = members.filter((m) => !assigned.has(m.slug));
    if (unassigned.length < 2) continue;
    const evidence: Record<string, string[]> = {};
    for (const m of unassigned) {
      evidence[m.slug] = [host];
      assigned.add(m.slug);
    }
    // Cluster id from the host (e.g. "mycollege-guest-laccd-edu")
    const id = host
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 64);
    clusters.push({
      id,
      sharedSignal: host,
      signalKind: "shared-sis-host",
      memberSlugs: unassigned.map((m) => m.slug),
      evidence,
    });
  }

  const stillOrphans = orphans.filter((c) => !assigned.has(c.slug));
  return { clustered: clusters, stillOrphans };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface ClusterOptions {
  /** Whether to do step-2 HTTP probing (default: true). */
  probeDeep?: boolean;
  /** Concurrent probes (default: 6). */
  concurrency?: number;
  /** Per-college HTTP timeout in ms (default: 15000). */
  perColumnTimeoutMs?: number;
  onProgress?: (done: number, total: number) => void;
}

export async function clusterFingerprints(
  colleges: ClusterInput[],
  options: ClusterOptions = {},
): Promise<ClusteringResult> {
  const opts = {
    probeDeep: options.probeDeep ?? true,
    concurrency: options.concurrency ?? 6,
    perColumnTimeoutMs: options.perColumnTimeoutMs ?? 15000,
    onProgress: options.onProgress,
  };

  // Step 1: registrable-domain clustering
  const step1 = clusterByRegistrableDomain(colleges);

  // Step 2 (optional): deep probe orphans
  let step2: { clustered: Cluster[]; stillOrphans: ClusterInput[] } = {
    clustered: [],
    stillOrphans: step1.orphans,
  };
  if (opts.probeDeep && step1.orphans.length > 0) {
    step2 = await clusterByDeepProbe(step1.orphans, {
      concurrency: opts.concurrency,
      perColumnTimeoutMs: opts.perColumnTimeoutMs,
      onProgress: opts.onProgress,
    });
  }

  const clusters = [...step1.clustered, ...step2.clustered];
  const singletons = step2.stillOrphans;
  const clusteredCount = clusters.reduce((s, c) => s + c.memberSlugs.length, 0);

  return {
    clusters,
    singletons,
    summary: {
      inputCount: colleges.length,
      clusterCount: clusters.length,
      clusteredCount,
      singletonCount: singletons.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Standalone CLI — useful for testing on already-added states
// ---------------------------------------------------------------------------

async function maybeRunCli(): Promise<void> {
  // Detect CLI invocation: argv[1] ends in cluster-fingerprints.ts (or .js)
  const arg1 = process.argv[1] ?? "";
  if (!/cluster-fingerprints\.(ts|js)$/.test(arg1)) return;

  const args = process.argv.slice(2);
  let state: string | null = null;
  let probeDeep = true;
  let outputJson = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--state" && args[i + 1]) {
      state = args[i + 1].toLowerCase();
      i++;
    } else if (args[i] === "--no-probe-deep") {
      probeDeep = false;
    } else if (args[i] === "--json") {
      outputJson = true;
    }
  }

  if (!state) {
    console.error("Usage: tsx scripts/lib/cluster-fingerprints.ts --state <ca|nv|...> [--no-probe-deep] [--json]");
    process.exit(1);
  }

  // For CLI we don't have fresh fingerprint output — read institutions.json
  // and re-derive primaryUrl + assume all are 'custom'-equivalent (we cluster
  // them all). For real orchestrator integration, the fingerprint output is
  // passed in directly.
  const fs = await import("fs");
  const path = await import("path");
  const instPath = path.default.join(process.cwd(), "data", state, "institutions.json");
  if (!fs.default.existsSync(instPath)) {
    console.error(`No data/${state}/institutions.json found.`);
    process.exit(1);
  }
  const institutions = JSON.parse(fs.default.readFileSync(instPath, "utf8"));
  const colleges: ClusterInput[] = institutions
    .map((inst: any) => {
      const src = inst.audit_policy?.source_url || "";
      const host = normalizeHost(src);
      if (!host) return null;
      return {
        slug: inst.college_slug || inst.id,
        name: inst.name,
        primaryUrl: host,
      };
    })
    .filter((x: any) => x !== null);

  console.error(`Clustering ${colleges.length} colleges for ${state.toUpperCase()}...`);

  const result = await clusterFingerprints(colleges, {
    probeDeep,
    onProgress: (done, total) => {
      if (done % 5 === 0 || done === total) {
        process.stderr.write(`\r  probed ${done}/${total}`);
      }
    },
  });
  process.stderr.write("\n");

  if (outputJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Human-readable summary
  console.log(
    `\n${result.clusters.length} cluster(s), ${result.summary.clusteredCount} colleges clustered, ${result.summary.singletonCount} singletons:\n`,
  );
  for (const c of result.clusters) {
    console.log(
      `  ${c.signalKind === "registrable-domain" ? "🌐" : "🔗"} ${c.id}  (${c.memberSlugs.length} colleges, ${c.signalKind}: ${c.sharedSignal})`,
    );
    for (const slug of c.memberSlugs) {
      console.log(`     • ${slug}`);
    }
  }
  if (result.singletons.length > 0) {
    console.log(`\n${result.singletons.length} singleton(s):`);
    for (const s of result.singletons.slice(0, 25)) {
      console.log(`  • ${s.slug}  (${s.primaryUrl})`);
    }
    if (result.singletons.length > 25) {
      console.log(`  ... +${result.singletons.length - 25} more`);
    }
  }
}

maybeRunCli().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
