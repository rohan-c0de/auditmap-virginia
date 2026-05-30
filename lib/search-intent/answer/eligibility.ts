// Eligibility answer lookup.
//
// Topics handled:
//   - "senior" → senior_discount fields per college + state-level waiver banner
//   - "audit"  → general audit-allowed + cost per college
//   - "cost"   → same surface as audit (cost_note + cost_model)
//   - "veteran"→ NOT in our data schema; returns NoAnswer
//
// State context is critical here: senior-tuition rules vary state-by-state
// (Virginia 60+ waiver, Tennessee >=65, etc.). The state-level summary is
// drawn from StateConfig.seniorWaiver when present.

import { loadInstitutions } from "../../institutions";
import { getStateConfig, isValidState } from "../../states/registry";
import type { EligibilityIntent } from "../types";
import type {
  Answer,
  CollegeEligibility,
  EligibilityAnswer,
} from "./types";
import { makeNoAnswer } from "./no-answer";

export async function lookupEligibility(
  intent: EligibilityIntent,
  state: string,
): Promise<Answer> {
  if (!isValidState(state)) {
    return makeNoAnswer({
      reason: "no-state-data",
      message: `We don't have data for state "${state}".`,
    });
  }

  if (intent.topic === "veteran") {
    return makeNoAnswer({
      reason: "no-state-data",
      message:
        "We don't track veteran-specific tuition data. Contact your state's Department of Veterans Services or your college's veteran-services office.",
    });
  }

  const institutions = loadInstitutions(state);
  if (institutions.length === 0) {
    return makeNoAnswer({
      reason: "no-state-data",
      message: `We don't have audit-policy data for ${state.toUpperCase()} yet.`,
    });
  }

  const cfg = getStateConfig(state);

  let summary: string;
  let colleges: CollegeEligibility[];

  if (intent.topic === "senior") {
    summary = buildSeniorSummary(cfg.name, cfg.seniorWaiver, intent.age);
    colleges = institutions.map((inst): CollegeEligibility => {
      const sd = inst.audit_policy.eligibility.senior_discount;
      return {
        slug: inst.college_slug,
        name: inst.name,
        eligible: sd.available,
        ageThreshold: sd.age_threshold || undefined,
        cost: sd.cost || "see college",
        notes: sd.notes || undefined,
      };
    });
  } else {
    // "audit" or "cost" — surface general audit policy
    summary = buildAuditSummary(cfg.name, institutions.length);
    colleges = institutions.map((inst): CollegeEligibility => {
      const ap = inst.audit_policy;
      return {
        slug: inst.college_slug,
        name: inst.name,
        eligible: ap.allowed === true,
        ageThreshold: ap.eligibility.minimum_age || undefined,
        cost: ap.cost_note || ap.cost_model || "see college",
        notes: ap.restrictions.length > 0 ? ap.restrictions.join("; ") : undefined,
      };
    });
  }

  const answer: EligibilityAnswer = {
    type: "eligibility",
    topic: intent.topic,
    state,
    summary,
    colleges,
    followups: buildFollowups(intent.topic),
    source: {
      source: "institutions",
      state,
      reference: `data/${state}/institutions.json`,
    },
  };
  return answer;
}

function buildSeniorSummary(
  stateName: string,
  waiver: ReturnType<typeof getStateConfig>["seniorWaiver"],
  askedAge: number | null,
): string {
  if (!waiver) {
    return `${stateName} has no statewide senior tuition waiver. Audit policies vary by college — see the breakdown below.`;
  }
  const ageNote = askedAge !== null
    ? askedAge >= waiver.ageThreshold
      ? `At ${askedAge}, you meet the threshold.`
      : `At ${askedAge}, you're below the ${waiver.ageThreshold}+ threshold.`
    : "";
  return [waiver.bannerSummary, ageNote].filter(Boolean).join(" ");
}

function buildAuditSummary(stateName: string, collegeCount: number): string {
  return `Audit policies in ${stateName} vary by college. Of the ${collegeCount} colleges we have data for, see eligibility and cost details below.`;
}

function buildFollowups(topic: EligibilityAnswer["topic"]): string[] {
  if (topic === "senior") {
    return [
      "How do I register to audit a course?",
      "What courses are available online?",
    ];
  }
  return [
    "What courses are available online?",
    "How much does a course cost?",
  ];
}
