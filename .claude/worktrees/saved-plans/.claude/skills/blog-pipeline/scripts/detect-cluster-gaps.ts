#!/usr/bin/env tsx
/**
 * Trigger C — cluster gap detection.
 * See ../references/triggers.md §"Trigger C"
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { articles, type ArticleMeta } from "../../../../content/blog/index";
import { getAllStates } from "../../../../lib/states/registry";

const REPO_ROOT = resolve(__dirname, "../../../..");
const DISABLED = resolve(REPO_ROOT, ".blog-pipeline/DISABLED");

type Candidate = {
  triggerSource: "cluster-gap";
  topic: string;
  targetReader: string;
  searchIntentHypothesis: string;
  articleType: "state-spoke" | "college-spoke";
  state: string;
  college?: string;
  cluster: string;
  nonDuplicateRationale: string;
  dataSlicePaths: string[];
  rankScore: number;
};

type Institution = {
  id?: string;
  college_slug?: string;
  name: string;
  audit_policy?: {
    allowed?: boolean;
    cost_model?: string;
    application_process?: {
      steps?: string[];
      contact_email?: string;
      contact_phone?: string;
    };
    eligibility?: {
      senior_discount?: { available?: boolean };
    };
  };
};

function readInstitutions(stateSlug: string): Institution[] {
  const path = resolve(REPO_ROOT, `data/${stateSlug}/institutions.json`);
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function hasRichAuditPolicy(inst: Institution): boolean {
  const ap = inst.audit_policy;
  if (!ap?.allowed) return false;
  const proc = ap.application_process;
  if (!proc?.steps || proc.steps.length < 3) return false;
  if (!proc.contact_email) return false;
  return true;
}

function transferEquivCount(stateSlug: string): number {
  const path = resolve(REPO_ROOT, `data/${stateSlug}/transfer-equiv.json`);
  if (!existsSync(path)) return 0;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

function institutionCount(stateSlug: string): number {
  const path = resolve(REPO_ROOT, `data/${stateSlug}/institutions.json`);
  if (!existsSync(path)) return 0;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

function detect(): Candidate[] {
  const hubs = articles.filter((a) => a.clusterRole === "hub");
  const states = getAllStates();
  const candidates: Candidate[] = [];

  for (const hub of hubs) {
    const cluster = hub.cluster;
    if (!cluster) continue;

    const spokes = articles.filter(
      (a) => a.cluster === cluster && a.clusterRole === "spoke"
    );
    const coveredStates = new Set(
      spokes.map((s) => s.state).filter((s): s is string => s !== null)
    );

    // Theme detection drives whether a state has the data backing required
    // to support this hub's spoke. Hubs without a clear theme don't get
    // gap candidates — they need editorial judgment, not automation.
    const isTransferTheme =
      hub.category === "transfer-confusion" ||
      hub.tags.includes("transfer");
    const isSeniorTheme =
      hub.category === "senior-waivers" ||
      hub.tags.includes("seniors");
    const isSessionTheme =
      hub.category === "session-timing" ||
      hub.tags.includes("session-timing");
    const isAuditAtCollegeTheme = cluster === "audit-at-college-guide";

    if (isAuditAtCollegeTheme) {
      // Per-college spokes — one candidate per qualifying college, not
      // per state. The hub answers "what is auditing"; spokes answer
      // "how do I audit at THIS college" using the institution's actual
      // audit_policy data (cost, contact email, application steps).
      const coveredColleges = new Set(
        spokes
          .map((s) => s.college)
          .filter((c): c is string => Boolean(c))
      );
      for (const s of states) {
        const insts = readInstitutions(s.slug);
        for (const inst of insts) {
          const collegeSlug = inst.college_slug ?? inst.id;
          if (!collegeSlug) continue;
          if (coveredColleges.has(collegeSlug)) continue;
          if (!hasRichAuditPolicy(inst)) continue;
          candidates.push({
            triggerSource: "cluster-gap",
            topic: `${inst.name}: state-specific audit guide for "${hub.title}"`,
            targetReader: `${s.name} community college student or ${s.name} resident considering auditing a course at ${inst.name}`,
            searchIntentHypothesis: `User searching "audit class ${inst.name.toLowerCase()}" or "${inst.name.toLowerCase()} audit cost" wants to know whether ${inst.name} accepts auditors, what it costs, and how to apply`,
            articleType: "college-spoke",
            state: s.slug,
            college: collegeSlug,
            cluster,
            nonDuplicateRationale: `Cluster "${cluster}" has ${spokes.length} spoke(s); none for college "${collegeSlug}". Institution has rich audit_policy data (allowed=true, application steps >= 3, contact email present).`,
            dataSlicePaths: [
              `data/${s.slug}/institutions.json#${collegeSlug}`,
              `lib/states/${s.slug}/config.ts`,
            ],
            rankScore: 100 + (inst.audit_policy?.eligibility?.senior_discount?.available ? 50 : 0),
          });
        }
      }
      continue;
    }

    if (!isTransferTheme && !isSeniorTheme && !isSessionTheme) continue;

    const gaps = states.filter((s) => {
      if (coveredStates.has(s.slug)) return false;
      if (isTransferTheme) {
        return s.transferSupported && transferEquivCount(s.slug) >= 5;
      }
      if (isSeniorTheme) {
        return Boolean(s.seniorWaiver);
      }
      if (isSessionTheme) {
        // Session-timing spokes only make sense for states where we have
        // real course data — the spoke needs to cite actual session codes
        // and start dates from the schedule. Use institution count as the
        // proxy for "we have data here."
        return institutionCount(s.slug) >= 1;
      }
      return false;
    });

    if (gaps.length === 0) continue;

    // Surface every qualifying gap as a candidate. Stage 2 of the pipeline
    // priority-orders candidates and the quality gates (G3 banned-phrase,
    // G4 embedding similarity) block thin or near-duplicate output. The
    // earlier "pick gaps[0]" cap was a crude per-hub throttle; with three
    // hubs that capped the entire pipeline at three candidates per run no
    // matter how many real gaps existed. Ranking still happens — the
    // priority bands consume rankScore — it just doesn't truncate.
    gaps.sort((a, b) => {
      const aScore =
        institutionCount(a.slug) * 2 + transferEquivCount(a.slug);
      const bScore =
        institutionCount(b.slug) * 2 + transferEquivCount(b.slug);
      return bScore - aScore;
    });

    for (const gap of gaps) {
      const stateName = gap.name;
      const slicePaths = isTransferTheme
        ? [`data/${gap.slug}/transfer-equiv.json`, `lib/states/${gap.slug}/config.ts`]
        : isSessionTheme
          ? [`data/${gap.slug}/courses`, `lib/states/${gap.slug}/config.ts`]
          : [`lib/states/${gap.slug}/config.ts`];

      const topic = isTransferTheme
        ? `${stateName} community college transfer: state-specific spoke for "${hub.title}"`
        : isSessionTheme
          ? `${stateName} community college sessions and calendar timing: state-specific spoke for "${hub.title}"`
          : `${stateName} senior tuition waivers: state-specific spoke for "${hub.title}"`;
      const targetReader = isTransferTheme
        ? `${stateName} community college student planning to transfer`
        : isSessionTheme
          ? `${stateName} community college student planning a schedule across full-term, 8-week, mini-mester, and summer sessions`
          : `${stateName} resident 60+ considering free or reduced-cost classes`;
      const searchIntentHypothesis = isTransferTheme
        ? `User searching "${stateName.toLowerCase()} community college transfer" wants to know how the in-state articulation works and what their credits will count for`
        : isSessionTheme
          ? `User searching "${stateName.toLowerCase()} community college 8-week classes" or "${stateName.toLowerCase()} mini-mester" wants to know what session formats local colleges actually offer and when they run`
          : `User searching "${stateName.toLowerCase()} senior tuition waiver" wants to know if they qualify and what restrictions apply`;

      candidates.push({
        triggerSource: "cluster-gap",
        topic,
        targetReader,
        searchIntentHypothesis,
        articleType: "state-spoke",
        state: gap.slug,
        cluster,
        nonDuplicateRationale: `Cluster "${cluster}" has ${spokes.length} spoke(s), none for ${stateName}. Verified by querying articles[].cluster.`,
        dataSlicePaths: slicePaths,
        rankScore:
          institutionCount(gap.slug) * 2 + transferEquivCount(gap.slug),
      });
    }
  }

  return candidates;
}

function main() {
  if (existsSync(DISABLED)) {
    process.stdout.write(JSON.stringify({ candidates: [], disabled: true }));
    process.exit(0);
  }

  try {
    const candidates = detect();
    process.stderr.write(
      `[detect-cluster-gaps] found ${candidates.length} candidate(s)\n`
    );
    process.stdout.write(JSON.stringify({ candidates }, null, 2));
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[detect-cluster-gaps] error: ${String(err)}\n`);
    process.stdout.write(JSON.stringify({ candidates: [], error: String(err) }));
    process.exit(1);
  }
}

main();
