import type { CourseRef, SearchIntent } from "../types";
import type { ExpectedIntent } from "./cases";

export interface MatchResult {
  matched: boolean;
  // Why the match failed, when it did. Useful for the eval report.
  reason?: string;
}

function eqCourse(a: CourseRef, b: CourseRef): boolean {
  return a.prefix.toUpperCase() === b.prefix.toUpperCase() && a.number === b.number;
}

function arrEq<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Returns true if `actual` satisfies the partial constraints in `expected`. */
export function matchesExpected(
  actual: SearchIntent,
  expected: ExpectedIntent,
): MatchResult {
  if (expected.type === "any-of") {
    if (!expected.oneOf.includes(actual.type)) {
      return {
        matched: false,
        reason: `expected one of [${expected.oneOf.join(", ")}], got "${actual.type}"`,
      };
    }
    return { matched: true };
  }

  if (actual.type !== expected.type) {
    return {
      matched: false,
      reason: `expected type "${expected.type}", got "${actual.type}"`,
    };
  }

  switch (expected.type) {
    case "transfer": {
      if (actual.type !== "transfer") return { matched: false }; // narrow
      if (expected.course) {
        if (!actual.course) {
          return { matched: false, reason: "expected course, got null" };
        }
        if (!eqCourse(actual.course, expected.course)) {
          return {
            matched: false,
            reason: `expected course ${expected.course.prefix} ${expected.course.number}, got ${actual.course.prefix} ${actual.course.number}`,
          };
        }
      }
      if (expected.university !== undefined) {
        if (actual.university !== expected.university) {
          return {
            matched: false,
            reason: `expected university "${expected.university}", got "${actual.university}"`,
          };
        }
      }
      return { matched: true };
    }

    case "pathway": {
      if (actual.type !== "pathway") return { matched: false };
      if (expected.university !== undefined && actual.university !== expected.university) {
        return {
          matched: false,
          reason: `expected university "${expected.university}", got "${actual.university}"`,
        };
      }
      if (expected.major !== undefined && actual.major !== expected.major) {
        return {
          matched: false,
          reason: `expected major "${expected.major}", got "${actual.major}"`,
        };
      }
      return { matched: true };
    }

    case "prereqs": {
      if (actual.type !== "prereqs") return { matched: false };
      if (expected.course) {
        if (!actual.course) {
          return { matched: false, reason: "expected course, got null" };
        }
        if (!eqCourse(actual.course, expected.course)) {
          return {
            matched: false,
            reason: `expected course ${expected.course.prefix} ${expected.course.number}, got ${actual.course.prefix} ${actual.course.number}`,
          };
        }
      }
      return { matched: true };
    }

    case "eligibility": {
      if (actual.type !== "eligibility") return { matched: false };
      if (expected.topic !== undefined && actual.topic !== expected.topic) {
        return {
          matched: false,
          reason: `expected topic "${expected.topic}", got "${actual.topic}"`,
        };
      }
      if (expected.age !== undefined && actual.age !== expected.age) {
        return {
          matched: false,
          reason: `expected age ${expected.age}, got ${actual.age}`,
        };
      }
      return { matched: true };
    }

    case "course": {
      if (actual.type !== "course") return { matched: false };
      const must = expected.mustExtract;
      if (!must) return { matched: true };
      if (must.course) {
        if (!actual.filters.course) {
          return {
            matched: false,
            reason: `expected filters.course ${must.course.prefix} ${must.course.number}, got none`,
          };
        }
        if (!eqCourse(actual.filters.course, must.course)) {
          return {
            matched: false,
            reason: `expected filters.course ${must.course.prefix} ${must.course.number}, got ${actual.filters.course.prefix} ${actual.filters.course.number}`,
          };
        }
      }
      if (must.mode !== undefined && actual.filters.mode !== must.mode) {
        return {
          matched: false,
          reason: `expected mode "${must.mode}", got "${actual.filters.mode}"`,
        };
      }
      if (must.timeOfDay !== undefined && actual.filters.timeOfDay !== must.timeOfDay) {
        return {
          matched: false,
          reason: `expected timeOfDay "${must.timeOfDay}", got "${actual.filters.timeOfDay}"`,
        };
      }
      if (must.term !== undefined && actual.filters.term !== must.term) {
        return {
          matched: false,
          reason: `expected term "${must.term}", got "${actual.filters.term}"`,
        };
      }
      if (must.days !== undefined) {
        if (!actual.filters.days || !arrEq(actual.filters.days, must.days)) {
          return {
            matched: false,
            reason: `expected days [${must.days.join(",")}], got [${actual.filters.days?.join(",") ?? ""}]`,
          };
        }
      }
      return { matched: true };
    }

    case "unknown":
      return { matched: true };
  }
}
