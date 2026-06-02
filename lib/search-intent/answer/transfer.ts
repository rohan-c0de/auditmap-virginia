// Transfer answer lookup.
//
// Maps a TransferIntent + state slug to a TransferAnswer. The decision tree:
//
//   intent.course == null, intent.subjectPrefix == null
//     ↓
//     status: "missing-entity" → NoAnswer (can't lookup without a course)
//
//   intent.course == null, intent.subjectPrefix present
//     ↓
//     status: "browse-subject" → NoAnswer with browse guidance
//     (UI shows courses matching the prefix in the results grid)
//
//   intent.course present, intent.university == null
//     ↓
//     "no-destination": list top-N alternatives where this course transfers
//
//   intent.university present
//     ↓
//     resolveUniversity → unknown-university? → suggestions
//                       → resolved? → look up mapping → yes / partial / no

import { getTransferInfo } from "../../transfer";
import { bestMappingForUniversity } from "../../transfer-rank";
import type { TransferIntent } from "../types";
import type {
  Answer,
  TransferAnswer,
  TransferEquivalency,
} from "./types";
import { courseExists, resolveUniversity } from "./validate";
import { makeNoAnswer } from "./no-answer";
import { subjectName } from "../../subjects";

const MAX_ALTERNATIVES = 5;

export async function lookupTransfer(
  intent: TransferIntent,
  state: string,
): Promise<Answer> {
  const { course } = intent;

  if (!course) {
    if (intent.subjectPrefix) {
      const name = subjectName(intent.subjectPrefix);
      const dest = intent.university
        ? await resolveUniversity(state, intent.university)
        : null;
      const destName = dest?.resolved?.name;
      const msg = destName
        ? `Showing ${name} courses — pick one to check if it transfers to ${destName}.`
        : `Showing ${name} courses — pick one to check transfer equivalency.`;
      return makeNoAnswer({
        reason: "missing-entity",
        message: msg,
      });
    }
    return makeNoAnswer({
      reason: "missing-entity",
      message:
        "Which course are you asking about? Try 'Does ENG 111 transfer to GMU?'",
    });
  }

  // Validate course exists in this state.
  const courseCheck = await courseExists(state, course.prefix, course.number);
  if (!courseCheck.exists) {
    return makeAnswer({
      status: "unknown-course",
      course,
      university: null,
      state,
    });
  }

  // Pull all transfer mappings for this course in this state.
  const mappings = await getTransferInfo(course.prefix, course.number, state);
  if (mappings.length === 0) {
    // No mappings at all — could be either no transfer data for this state
    // or this specific course has none.
    return makeAnswer({
      status: "no",
      course,
      university: null,
      state,
    });
  }

  // No destination specified → return alternatives list, no specific equivalency.
  if (!intent.university) {
    return makeAnswer({
      status: "no-destination",
      course,
      university: null,
      alternatives: mappings.slice(0, MAX_ALTERNATIVES).map((m) => ({
        slug: m.university,
        name: m.university_name,
        univ_course: m.univ_course,
        is_elective: m.is_elective,
        no_credit: m.no_credit,
      })),
      state,
    });
  }

  // Destination specified → resolve and look up.
  const resolution = await resolveUniversity(state, intent.university);
  if (!resolution.resolved) {
    return makeAnswer({
      status: "unknown-university",
      course,
      university: null,
      suggestions: resolution.suggestions,
      state,
    });
  }

  // One-to-many: a course can map to the destination with several rows of
  // different status. Answer with the best outcome (direct > elective >
  // no-credit), not whichever row is first — otherwise "Does X transfer to Y?"
  // can say "partial" when a direct equivalent exists. See lib/transfer-rank.ts.
  const match = bestMappingForUniversity(mappings, resolution.resolved.slug);
  if (!match) {
    // University exists in the state's transfer space, but this course
    // doesn't map to it. Surface alternatives.
    return makeAnswer({
      status: "no",
      course,
      university: resolution.resolved,
      alternatives: mappings.slice(0, MAX_ALTERNATIVES).map((m) => ({
        slug: m.university,
        name: m.university_name,
        univ_course: m.univ_course,
        is_elective: m.is_elective,
        no_credit: m.no_credit,
      })),
      state,
    });
  }

  const equivalency: TransferEquivalency = {
    univ_course: match.univ_course,
    univ_title: match.univ_title,
    univ_credits: match.univ_credits,
    is_elective: match.is_elective,
    no_credit: match.no_credit,
    notes: match.notes,
  };
  const status =
    match.no_credit || match.is_elective ? "partial" : "yes";

  return makeAnswer({
    status,
    course,
    university: resolution.resolved,
    equivalency,
    state,
  });
}

// Tiny builder so we don't repeat `source: { ... }` six times.
function makeAnswer(
  parts: Omit<TransferAnswer, "type" | "source"> & { state: string },
): TransferAnswer {
  const { state, ...rest } = parts;
  return {
    type: "transfer",
    ...rest,
    followups: buildFollowups(rest),
    source: {
      source: "transfer-equiv",
      state,
      reference: `data/${state}/transfer-equiv.json`,
    },
  };
}

function buildFollowups(parts: Omit<TransferAnswer, "type" | "source">): string[] {
  const courseCode = `${parts.course.prefix} ${parts.course.number}`;
  const univName = parts.university?.name ?? null;

  switch (parts.status) {
    case "yes":
    case "partial":
      return [
        `What are the prereqs for ${courseCode}?`,
        univName
          ? `Does ${courseCode} transfer to other universities?`
          : `Where does ${courseCode} transfer?`,
      ];
    case "no":
      return [
        `Where does ${courseCode} transfer?`,
        `What are the prereqs for ${courseCode}?`,
      ];
    case "no-destination":
      return (parts.alternatives ?? []).slice(0, 3).map(
        (a) => `Does ${courseCode} transfer to ${a.name}?`,
      );
    case "unknown-course":
      return [`Search for ${parts.course.prefix} courses`];
    default:
      return [];
  }
}
