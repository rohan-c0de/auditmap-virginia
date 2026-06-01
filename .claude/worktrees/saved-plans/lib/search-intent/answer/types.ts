// Answer shapes returned by lookupAnswer(intent, state).
//
// Each answer carries a SourceCitation so the UI can render trust signals
// ("based on transfer-equiv data, last verified YYYY-MM-DD"). Required, not
// optional — first-gen students need provenance to verify enrollment-bearing
// answers against official sources.
//
// The status field on each typed answer is a discriminated union of
// outcomes: "yes / no / partial / missing-entity / no-data". The UI uses
// these to pick a card variant and copy.

import type { ChainNode } from "../../prereqs";

export interface SourceCitation {
  source: "transfer-equiv" | "prereqs" | "institutions" | "supabase-courses";
  state: string;
  // Where the data came from. For JSON files: path. For DB: table name.
  reference: string;
  // Best-effort freshness signal. May be undefined for files without metadata.
  lastUpdated?: string;
  // Optional URL pointing to the authoritative external source.
  upstreamUrl?: string;
}

export type Answer =
  | TransferAnswer
  | PrereqsAnswer
  | EligibilityAnswer
  | PathwayAnswer
  | NoAnswer;

// ─── Transfer ────────────────────────────────────────────────────────────

export type TransferStatus =
  | "yes" //              equivalency exists, full credit
  | "partial" //          equivalency exists but is_elective or no_credit
  | "no" //               course exists, university exists, no mapping
  | "no-destination" //   user didn't specify a destination — show options
  | "unknown-course" //   course doesn't exist in this state
  | "unknown-university"// university not in this state's transfer data
  | "no-data"; //         state has no transfer data at all

export interface TransferEquivalency {
  univ_course: string;
  univ_title: string;
  univ_credits: string;
  is_elective: boolean;
  no_credit: boolean;
  notes: string;
}

export interface TransferAnswer {
  type: "transfer";
  status: TransferStatus;
  course: { prefix: string; number: string };
  // null when status is "no-destination" or "unknown-university".
  university: { slug: string; name: string } | null;
  // Present when status is "yes" or "partial".
  equivalency?: TransferEquivalency;
  // For "no" / "no-destination": other universities where this course transfers.
  alternatives?: Array<{
    slug: string;
    name: string;
    univ_course: string;
    is_elective: boolean;
    no_credit: boolean;
  }>;
  // For "unknown-university": closest slug matches.
  suggestions?: Array<{ slug: string; name: string }>;
  source: SourceCitation;
  followups?: string[];
}

// ─── Prereqs ─────────────────────────────────────────────────────────────

export type PrereqsStatus =
  | "found" //              course has prereqs, chain returned
  | "unlocks" //            inverse: courses that this course unlocks
  | "no-prereqs" //         course exists, no prereqs documented
  | "no-unlocks" //         inverse: no courses require this as a prereq
  | "unknown-course" //     course doesn't exist in this state
  | "no-course-named" //    intent.course was null
  | "no-data"; //           state has no prereq data at all

export interface PrereqsAnswer {
  type: "prereqs";
  status: PrereqsStatus;
  // null when status is "no-course-named".
  course: { prefix: string; number: string } | null;
  // Present when status is "found". Reuses the existing ChainNode from
  // lib/prereqs.ts so the UI can share rendering with /api/[state]/prereqs/chain.
  chain?: ChainNode;
  // Present when status is "unlocks". List of courses this course is a
  // prerequisite for (inverse prereq lookup).
  unlocks?: string[];
  source: SourceCitation;
  followups?: string[];
}

// ─── Eligibility ─────────────────────────────────────────────────────────

export interface CollegeEligibility {
  slug: string;
  name: string;
  eligible: boolean;
  ageThreshold?: number;
  cost: string; // e.g. "free", "reduced", "same as credit"
  notes?: string;
}

export interface EligibilityAnswer {
  type: "eligibility";
  topic: "senior" | "audit" | "cost" | "veteran";
  state: string;
  // One-sentence state-wide summary, e.g. "Virginia residents 60+ may audit
  // any VCCS course for free under VA Code § 23.1-638."
  summary: string;
  colleges: CollegeEligibility[];
  source: SourceCitation;
  followups?: string[];
}

// ─── Pathway ────────────────────────────────────────────────────────────

export type PathwayStatus =
  | "found" //                pathway data exists for this university/major
  | "found-degree" //         CC degree requirement data found
  | "found-related" //        no exact-major match, but related programs found
  | "found-courses-only" //   no degree match at any level, but related courses
                              // exist in the state's catalog (Phase 3 LLM
                              // returned subjectPrefixes but no programTitles)
  | "no-data" //              no pathway data available yet
  | "unknown-university" //   university not recognized
  | "missing-entity"; //      no university specified

export interface DegreeRequirementSummary {
  title: string;
  credential: string;
  total_credits: number | null;
  gpa_minimum: number | null;
  catalog_url: string;
  groups: Array<{
    name: string;
    credits_required: number | null;
    course_count: number;
  }>;
}

/**
 * Aggregated info about a subject prefix used in a state's course catalog.
 * Surfaces when the answer pivots from "no degree" to "but here are
 * related courses you can take" — see #265 follow-up.
 */
export interface SubjectMatchSummary {
  prefix: string; // e.g. "GEO"
  name: string; // human-readable, e.g. "Geography"
  course_count: number;
  section_count: number;
  college_count: number;
  // Pre-built deep link into the per-state course search.
  search_url: string;
}

export interface PathwayAnswer {
  type: "pathway";
  status: PathwayStatus;
  university: { slug: string; name: string } | null;
  major: string | null;
  college: { slug: string; name: string } | null;
  degreeRequirements?: DegreeRequirementSummary[];
  /**
   * Optional course-level pivot. Populated either alongside
   * degreeRequirements (when found-related and the LLM also returned
   * subjects) or as the only content (when status is found-courses-only).
   */
  relatedSubjects?: SubjectMatchSummary[];
  source: SourceCitation;
  followups?: string[];
}

// ─── No-answer ───────────────────────────────────────────────────────────

export interface NoAnswer {
  type: "none";
  reason:
    | "intent-not-supported" // course intent — UI just shows search results
    | "missing-entity" //      not enough info to look up
    | "out-of-scope" //        unknown intent or vague query
    | "no-state-data"; //      state hasn't been populated yet
  message: string;
  // Optional: things the user could try instead.
  suggestions?: string[];
  followups?: string[];
}
