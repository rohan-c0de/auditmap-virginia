// Pathway answer lookup.
//
// Two modes:
//   1. CC degree: "nursing degree at NOVA" → look up program requirements
//   2. Transfer pathway: "transfer to GMU for CS" → stub (future work)

import type { PathwayIntent } from "../types";
import type { Answer, PathwayAnswer, DegreeRequirementSummary } from "./types";
import { resolveUniversity } from "./validate";
import { loadInstitutions } from "../../institutions";
import {
  loadCollegePrograms,
  loadProgramAcrossColleges,
  findRelatedPrograms,
  stateHasProgramData,
  loadProgramsByTitles,
} from "../../programs/requirements";
import { matchProgramSlug } from "../../programs/matcher";
import {
  semanticResolveMajor,
  type SemanticResolveResult,
} from "../../programs/semantic-resolve";
import { summariseSubjectsByPrefix } from "../../programs/subject-vocab";
import type { Institution } from "../../types";
import type { ProgramRequirement } from "../../programs/requirements";

/**
 * Number of cross-college lexical hits above which we re-run the query
 * through the LLM resolver. Below this, the lexical layer's stem matches
 * are tight enough to trust without the cost. Above it, we've seen
 * promiscuous matches dominate ("coding" → 8 Medical Coding programs;
 * "data science" → "Data Cabling"). See #265.
 */
const LEXICAL_NOISE_THRESHOLD = 4;

export async function lookupPathway(
  intent: PathwayIntent,
  state: string,
): Promise<Answer> {
  if (intent.college) {
    return lookupDegree(intent, state);
  }

  if (intent.major && !intent.university) {
    return lookupDegreeByMajor(intent, state);
  }

  return lookupTransferPathway(intent, state);
}

async function lookupDegree(
  intent: PathwayIntent,
  state: string,
): Promise<Answer> {
  const college = resolveCollege(state, intent.college!);
  if (!college) {
    return makeAnswer({
      status: "missing-entity",
      university: null,
      major: intent.major,
      college: null,
      state,
      followups: [
        "What degree programs are available?",
        "What courses are available online?",
      ],
    });
  }

  const programs = await loadCollegePrograms(state, college.college_slug);

  if (programs.length === 0) {
    return makeAnswer({
      status: "no-data",
      university: null,
      major: intent.major,
      college: { slug: college.id, name: college.name },
      state,
      followups: [
        `What courses are offered at ${college.name}?`,
        "What are the prereqs for ENG 111?",
      ],
    });
  }

  let filtered = programs;
  if (intent.major) {
    const slug = matchProgramSlug(intent.major.replace(/-/g, " "));
    if (slug) {
      filtered = programs.filter((p) => p.matched_program_slug === slug);
    }
    if (filtered.length === 0) {
      filtered = programs.filter(
        (p) =>
          p.title.toLowerCase().includes(intent.major!.replace(/-/g, " ")),
      );
    }
  }

  if (intent.credential) {
    const cred = intent.credential.toUpperCase();
    const credFiltered = filtered.filter(
      (p) => p.credential.toUpperCase() === cred,
    );
    if (credFiltered.length > 0) filtered = credFiltered;
  }

  if (filtered.length === 0) filtered = programs.slice(0, 5);

  const degreeRequirements: DegreeRequirementSummary[] = filtered
    .slice(0, 5)
    .map((p) => ({
      title: p.title,
      credential: p.credential,
      total_credits: p.total_credits,
      gpa_minimum: p.gpa_minimum,
      catalog_url: p.catalog_url,
      groups: p.requirement_groups.map((g) => ({
        name: g.name,
        credits_required: g.credits_required,
        course_count: g.courses.length,
      })),
    }));

  const majorLabel = intent.major?.replace(/-/g, " ") ?? null;

  return makeAnswer({
    status: "found-degree",
    university: null,
    major: intent.major,
    college: { slug: college.id, name: college.name },
    degreeRequirements,
    state,
    followups: [
      `View all programs at ${college.name}`,
      ...(majorLabel
        ? [`Search for ${majorLabel} courses`]
        : []),
      `What courses are offered at ${college.name}?`,
    ],
  });
}

async function lookupDegreeByMajor(
  intent: PathwayIntent,
  state: string,
): Promise<Answer> {
  const slug = matchProgramSlug(intent.major!.replace(/-/g, " "));
  const programSlug = slug ?? intent.major!;

  const entries = await loadProgramAcrossColleges(state, programSlug);
  const majorLabel = intent.major!.replace(/-/g, " ");

  // No exact slug match. Resolve in three layers, returning the first
  // non-empty result:
  //   1. lexical stem match across program titles (Phase 2 — sync, free)
  //   2. LLM semantic resolution (Phase 3 — async, cached, costs cents on
  //      misses; handles synonyms / colloquialisms / domain knowledge)
  //   3. honest no-data when the state has no program data at all
  //
  // The LLM also runs when lexical was *promiscuous* (≥ 4 cross-college
  // hits). At that volume the matches are almost always lossy (e.g.
  // "coding" matches 8 Medical Coding programs but the user wanted CS;
  // "data science" matches Data Cabling). The LLM, given the full state
  // vocab, picks semantically-relevant titles instead. See #265.
  if (entries.length === 0) {
    if (stateHasProgramData(state)) {
      // Phase 2: lexical stems
      let related = await findRelatedPrograms(state, majorLabel, 8);

      // We hold onto the semantic result (if it was called) so we can
      // surface its subjectPrefixes alongside or instead of programs —
      // see the `relatedSubjects` field on PathwayAnswer.
      let semantic: SemanticResolveResult | null = null;

      // Phase 3a: lexical found nothing → try LLM. Wrapped in try/catch
      // so a transient classifier failure can't break the request.
      if (related.length === 0) {
        try {
          semantic = await semanticResolveMajor(state, majorLabel);
          if (semantic && semantic.programTitles.length > 0) {
            related = await loadProgramsByTitles(state, semantic.programTitles);
          }
        } catch {
          /* noop — proceed with empty `related` */
        }
      } else if (related.length >= LEXICAL_NOISE_THRESHOLD) {
        // Phase 3b: lexical was promiscuous — ask the LLM to refine.
        // Keep the lexical pool as fallback if the LLM returns nothing.
        try {
          semantic = await semanticResolveMajor(state, majorLabel);
          if (semantic && semantic.programTitles.length > 0) {
            const refined = await loadProgramsByTitles(
              state,
              semantic.programTitles,
            );
            if (refined.length > 0) related = refined;
          }
        } catch {
          /* keep the lexical results */
        }
      }

      const relatedSubjects = semantic?.subjectPrefixes
        ? summariseSubjectsByPrefix(state, semantic.subjectPrefixes)
        : [];

      if (related.length > 0) {
        return makeAnswer({
          status: "found-related",
          university: null,
          major: intent.major,
          college: null,
          degreeRequirements: summariseRequirements(related),
          relatedSubjects: relatedSubjects.length > 0 ? relatedSubjects : undefined,
          state,
          followups: [
            `${majorLabel} courses available this term`,
            `What are the prereqs for common ${majorLabel} courses?`,
          ],
        });
      }

      // No programs anywhere, but the LLM identified course-level
      // subjects we *do* have. Pivot to a course-level answer instead
      // of returning no-data.
      if (relatedSubjects.length > 0) {
        return makeAnswer({
          status: "found-courses-only",
          university: null,
          major: intent.major,
          college: null,
          relatedSubjects,
          state,
          followups: [
            `${majorLabel} courses available this term`,
            `Browse all programs in this state`,
          ],
        });
      }
    }
    return makeAnswer({
      status: "no-data",
      university: null,
      major: intent.major,
      college: null,
      state,
      followups: [
        `Search for ${majorLabel} courses`,
        "What programs are available?",
      ],
    });
  }

  return makeAnswer({
    status: "found-degree",
    university: null,
    major: intent.major,
    college: null,
    degreeRequirements: summariseRequirements(entries.slice(0, 3), 2),
    state,
    followups: [
      `${majorLabel} courses available this term`,
      `What are the prereqs for common ${majorLabel} courses?`,
    ],
  });
}

/**
 * Flatten a list of `{college, programs}` entries into the cross-college
 * `DegreeRequirementSummary[]` shape the answer card expects. `perCollege`
 * caps how many programs each college contributes — so a college with 50
 * programs doesn't crowd out colleges with just one.
 */
function summariseRequirements(
  entries: Array<{ college: Institution; programs: ProgramRequirement[] }>,
  perCollege?: number,
): DegreeRequirementSummary[] {
  const out: DegreeRequirementSummary[] = [];
  for (const entry of entries) {
    const programs =
      typeof perCollege === "number"
        ? entry.programs.slice(0, perCollege)
        : entry.programs;
    for (const p of programs) {
      out.push({
        title: `${p.title} — ${entry.college.name}`,
        credential: p.credential,
        total_credits: p.total_credits,
        gpa_minimum: p.gpa_minimum,
        catalog_url: p.catalog_url,
        groups: p.requirement_groups.map((g) => ({
          name: g.name,
          credits_required: g.credits_required,
          course_count: g.courses.length,
        })),
      });
    }
  }
  return out;
}

async function lookupTransferPathway(
  intent: PathwayIntent,
  state: string,
): Promise<Answer> {
  if (!intent.university) {
    return makeAnswer({
      status: "missing-entity",
      university: null,
      major: intent.major,
      college: null,
      state,
      followups: [
        "Does ENG 111 transfer?",
        "What courses are available online?",
      ],
    });
  }

  const resolution = await resolveUniversity(state, intent.university);
  if (!resolution.resolved) {
    return makeAnswer({
      status: "unknown-university",
      university: null,
      major: intent.major,
      college: null,
      state,
      followups: [
        "Does ENG 111 transfer?",
        "What courses are available online?",
      ],
    });
  }

  const { slug, name } = resolution.resolved;
  const majorLabel = intent.major?.replace(/-/g, " ") ?? null;

  return makeAnswer({
    status: "no-data",
    university: { slug, name },
    major: intent.major,
    college: null,
    state,
    followups: [
      `What courses transfer to ${name}?`,
      ...(majorLabel ? [`Search for ${majorLabel} courses`] : []),
      "What are the prereqs for ENG 111?",
    ],
  });
}

function resolveCollege(
  state: string,
  slugOrName: string,
): { id: string; name: string; college_slug: string } | null {
  const institutions = loadInstitutions(state);
  const normalized = slugOrName.toLowerCase().replace(/[^a-z0-9]/g, "");

  for (const inst of institutions) {
    if (inst.id === slugOrName || inst.college_slug === slugOrName) {
      return inst;
    }
  }

  for (const inst of institutions) {
    const normId = inst.id.replace(/[^a-z0-9]/g, "");
    const normSlug = inst.college_slug.replace(/[^a-z0-9]/g, "");
    if (normId === normalized || normSlug === normalized) {
      return inst;
    }
  }

  for (const inst of institutions) {
    const normName = inst.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (normName.includes(normalized) || normalized.includes(normName)) {
      return inst;
    }
  }

  return null;
}

function makeAnswer(
  parts: Omit<PathwayAnswer, "type" | "source"> & { state: string },
): PathwayAnswer {
  const { state, ...rest } = parts;
  return {
    type: "pathway",
    ...rest,
    source: {
      source: "supabase-courses",
      state,
      reference: `data/${state}/programs/`,
    },
  };
}
