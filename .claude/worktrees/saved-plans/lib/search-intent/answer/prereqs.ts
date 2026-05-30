// Prereqs answer lookup.
//
// Decision tree:
//
//   intent.course == null
//     → status: "no-course-named" → "Which course?"
//
//   prereqs map for state is empty
//     → status: "no-data" — state has no prereq data yet
//
//   course not in prereqs map (and doesn't exist in courses table)
//     → status: "unknown-course"
//
//   course in prereqs map but no recorded prereqs
//     → status: "no-prereqs"
//
//   else
//     → status: "found", chain returned

import { buildChain, buildInverseIndex, loadPrereqs } from "../../prereqs";
import type { PrereqsIntent } from "../types";
import type { Answer, PrereqsAnswer } from "./types";
import { courseExists } from "./validate";

export async function lookupPrereqs(
  intent: PrereqsIntent,
  state: string,
): Promise<Answer> {
  const { course } = intent;

  if (!course) {
    return makeAnswer({
      status: "no-course-named",
      course: null,
      state,
    });
  }

  const prereqs = loadPrereqs(state);
  if (prereqs.size === 0) {
    return makeAnswer({
      status: "no-data",
      course,
      state,
    });
  }

  if (intent.direction === "inverse") {
    return lookupInverse(course, prereqs, state);
  }

  return lookupForward(course, prereqs, state);
}

async function lookupForward(
  course: { prefix: string; number: string },
  prereqs: ReturnType<typeof loadPrereqs>,
  state: string,
): Promise<Answer> {
  const key = `${course.prefix.toUpperCase()} ${course.number}`;
  const entry = prereqs.get(key);

  if (!entry) {
    const check = await courseExists(state, course.prefix, course.number);
    if (!check.exists) {
      return makeAnswer({ status: "unknown-course", course, state });
    }
    return makeAnswer({ status: "no-prereqs", course, state });
  }

  if ((!entry.text || entry.text.trim() === "") && entry.courses.length === 0) {
    return makeAnswer({ status: "no-prereqs", course, state });
  }

  const chain = buildChain(key, prereqs, new Set(), 0);
  return makeAnswer({ status: "found", course, chain, state });
}

async function lookupInverse(
  course: { prefix: string; number: string },
  prereqs: ReturnType<typeof loadPrereqs>,
  state: string,
): Promise<Answer> {
  const key = `${course.prefix.toUpperCase()} ${course.number}`;

  const inMap = prereqs.has(key);
  if (!inMap) {
    const check = await courseExists(state, course.prefix, course.number);
    if (!check.exists) {
      return makeAnswer({ status: "unknown-course", course, state });
    }
  }

  const inverse = buildInverseIndex(prereqs);
  const unlocked = inverse.get(key);

  if (!unlocked || unlocked.length === 0) {
    return makeAnswer({ status: "no-unlocks", course, state });
  }

  unlocked.sort();
  return makeAnswer({ status: "unlocks", course, unlocks: unlocked, state });
}

function makeAnswer(
  parts: Omit<PrereqsAnswer, "type" | "source"> & { state: string },
): PrereqsAnswer {
  const { state, ...rest } = parts;
  return {
    type: "prereqs",
    ...rest,
    followups: buildFollowups(rest),
    source: {
      source: "prereqs",
      state,
      reference: `data/${state}/prereqs.json`,
    },
  };
}

function buildFollowups(parts: Omit<PrereqsAnswer, "type" | "source">): string[] {
  if (!parts.course) return [];
  const courseCode = `${parts.course.prefix} ${parts.course.number}`;

  switch (parts.status) {
    case "found": {
      const followups = [`Does ${courseCode} transfer?`];
      const firstPrereq = parts.chain?.children[0]?.course;
      if (firstPrereq) followups.push(`What are the prereqs for ${firstPrereq}?`);
      followups.push(`What can I take after ${courseCode}?`);
      return followups;
    }
    case "unlocks": {
      const followups = [`What are the prereqs for ${courseCode}?`];
      const first = parts.unlocks?.[0];
      if (first) followups.push(`Does ${first} transfer?`);
      return followups;
    }
    case "no-unlocks":
      return [
        `What are the prereqs for ${courseCode}?`,
        `Does ${courseCode} transfer?`,
      ];
    case "no-prereqs":
      return [
        `Does ${courseCode} transfer?`,
        `Search for ${parts.course.prefix} courses`,
      ];
    case "unknown-course":
      return [`Search for ${parts.course.prefix} courses`];
    default:
      return [];
  }
}
