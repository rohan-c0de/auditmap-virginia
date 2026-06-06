/**
 * Smart Schedule Builder — core algorithm.
 *
 * Given user constraints (subjects, days, times, distance, modality),
 * generates ranked conflict-free course schedule combinations across
 * all community colleges in the selected state.
 *
 * Performance target: <100ms per request for typical queries.
 */

import type {
  CourseSection,
  Institution,
  ScheduleRequest,
  ScheduleResponse,
  GeneratedSchedule,
  ScheduleSection,
  ScoreBreakdown,
  TransferStatus,
} from "./types";
import { loadAllCourses } from "./courses";
import { getZipCoordinates, calculateDistance } from "./geo";
import { parseTimeToMinutes, daysToBitmask } from "./time-utils";
import { isInProgress } from "./course-status";
import { getCurrentTerm } from "./terms";
import { subjectPrefixesForName } from "./subjects";
import { bestTransferEntry } from "./transfer-rank";
import { describeSeats } from "./seats";
const MAX_RESULTS = 20;
const MAX_HEAP_SIZE = 50;
const MAX_COMBINATIONS_EVALUATED = 100_000;
const TOP_COURSES_PER_PREFIX = 5;

// ---------------------------------------------------------------------------
// Enriched section with pre-parsed numeric fields for fast comparison
// ---------------------------------------------------------------------------

/** Transfer lookup: courseKey → transfer status at target university */
export type TransferLookup = Record<
  string,
  { university: string; type: TransferStatus; course: string }[]
>;

export interface EnrichedSection extends CourseSection {
  _startMin: number; // minutes since midnight, -1 if TBA
  _endMin: number;
  _dayMask: number; // bitmask of days
  _courseKey: string; // e.g. "ART-101"
  _distance: number | null;
  _collegeName: string;
  _isAsync: boolean;
  _transferStatus: TransferStatus;
  _transferCourse: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function generateSchedules(
  request: ScheduleRequest,
  institutions: Institution[],
  state: string,
  transferLookup?: TransferLookup | null,
  targetUniversity?: string | null
): Promise<ScheduleResponse> {
  const t0 = performance.now();

  // Build institution lookup
  const instMap = new Map<string, Institution>();
  for (const inst of institutions) {
    instMap.set(inst.college_slug, inst);
  }

  // Pre-compute distance map: college slug → nearest campus distance
  let userCoords: { lat: number; lng: number } | null = null;
  const distanceMap = new Map<string, number>();

  if (request.zip) {
    const zipInfo = getZipCoordinates(request.zip, state);
    if (zipInfo) {
      userCoords = { lat: zipInfo.lat, lng: zipInfo.lng };
      for (const inst of institutions) {
        if (!inst.campuses || inst.campuses.length === 0) continue;
        const minDist = Math.min(
          ...inst.campuses.map((c) =>
            calculateDistance(userCoords!.lat, userCoords!.lng, c.lat, c.lng)
          )
        );
        distanceMap.set(inst.college_slug, Math.round(minDist * 10) / 10);
      }
    }
  }

  // Parse subject queries
  const { exactCourses, subjectPrefixes, keywordGroups } = parseSubjectQueries(
    request.subjects
  );

  // Parse user's available day bitmask
  const availableDayMask = request.daysAvailable.reduce(
    (mask, d) => mask | (daysToBitmask(d)),
    0
  );

  // Parse time window to minutes
  const timeWindow = parseTimeWindow(
    request.timeWindowStart,
    request.timeWindowEnd
  );

  // Stage 1: Filter all sections to candidates
  const term = request.term || await getCurrentTerm(state);
  const allSections = await loadAllCourses(term, state);
  const hideFullSections = request.hideFullSections !== false; // default true
  const { sections: candidates, filteredFullCount } = filterSections(
    allSections,
    exactCourses,
    subjectPrefixes,
    keywordGroups,
    availableDayMask,
    timeWindow,
    request.mode || "any",
    request.maxDistance ?? Infinity,
    distanceMap,
    instMap,
    request.includeInProgress ?? false,
    hideFullSections,
    transferLookup ?? null,
    targetUniversity ?? null
  );

  // Stage 2: Group by course, deduplicate by schedule signature
  const courseMap = new Map<string, EnrichedSection[]>();
  for (const s of candidates) {
    if (!courseMap.has(s._courseKey)) {
      courseMap.set(s._courseKey, []);
    }
    courseMap.get(s._courseKey)!.push(s);
  }

  // Deduplicate within each course: keep one section per unique
  // college+days+time combo to avoid generating identical-looking schedules
  for (const [key, sections] of courseMap) {
    const seen = new Set<string>();
    const deduped: EnrichedSection[] = [];
    for (const s of sections) {
      const sig = `${s.college_code}:${s._dayMask}:${s._startMin}-${s._endMin}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        deduped.push(s);
      }
    }
    courseMap.set(key, deduped);
  }

  const candidateCourses = courseMap.size;

  // Stage 3: Select course combinations
  const courseCombinations = selectCourseCombinations(
    courseMap,
    request.maxCourses,
    exactCourses,
    subjectPrefixes
  );

  // Stage 4: Find valid schedules with conflict-free sections
  const heap: GeneratedSchedule[] = [];
  let combinationsEvaluated = 0;

  for (const combo of courseCombinations) {
    if (combinationsEvaluated >= MAX_COMBINATIONS_EVALUATED) break;

    const courseSections = combo.map((key) => courseMap.get(key) || []);
    const found = findValidSchedules(
      courseSections,
      request.minBreakMinutes,
      request.maxDistance ?? Infinity,
      distanceMap,
      heap,
      combinationsEvaluated
    );
    combinationsEvaluated += found.evaluated;
    // Merge found schedules into heap
    for (const schedule of found.schedules) {
      insertIntoHeap(heap, schedule);
    }
  }

  // Sort heap by score descending, take top N
  heap.sort((a, b) => b.score - a.score);
  const results = heap.slice(0, MAX_RESULTS);

  const timeTakenMs = Math.round(performance.now() - t0);

  let message: string | undefined;
  if (allSections.length === 0) {
    message =
      "No course data available for this term yet. Check back soon — new schedules are added regularly.";
  } else if (candidateCourses === 0) {
    message =
      "No courses matched your subjects. Check the course code (e.g. HIST) or try a broader term.";
  } else if (candidateCourses < request.maxCourses) {
    message = `Only ${candidateCourses} matching course${candidateCourses === 1 ? "" : "s"} found. Try adding more subjects or reducing max courses to ${candidateCourses}.`;
  } else if (results.length === 0 && candidates.length > 0) {
    message =
      "No conflict-free schedules found. Try fewer courses, different days, or a wider time window.";
  } else if (candidates.length === 0) {
    message =
      "No sections match your constraints. Try broader filters (more days, wider time window, or larger distance).";
  }

  return {
    schedules: results,
    meta: {
      candidateSections: candidates.length,
      candidateCourses,
      combinationsEvaluated,
      timeTakenMs,
      message,
      filteredFullSections: filteredFullCount > 0 ? filteredFullCount : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Subject query parsing
// ---------------------------------------------------------------------------

/**
 * Filler words stripped from free-text subject queries before matching, so a
 * natural phrase like "history courses" or "intro to psychology" reduces to its
 * meaningful tokens (["history"], ["intro","psychology"]).
 */
const SUBJECT_FILLER_WORDS = new Set([
  "course",
  "courses",
  "class",
  "classes",
  "the",
  "of",
  "to",
  "and",
  "for",
  "in",
  "a",
  "an",
]);

export function parseSubjectQueries(subjects: string[]): {
  exactCourses: string[]; // e.g. ["PSY-200", "ART-101"]
  subjectPrefixes: string[]; // clean prefixes + prefixes resolved from names
  keywordGroups: string[][]; // tokenized free text, AND-matched against titles
} {
  const exactCourses: string[] = [];
  const subjectPrefixes: string[] = [];
  const keywordGroups: string[][] = [];

  for (const raw of subjects) {
    const trimmed = raw.trim().toUpperCase();
    // "PSY 200" or "PSY200"
    const exact = trimmed.match(/^([A-Z]{2,4})\s*(\d{3})$/);
    if (exact) {
      exactCourses.push(`${exact[1]}-${exact[2]}`);
      continue;
    }
    // "ART" or "art" — a bare course prefix
    const prefix = trimmed.match(/^([A-Z]{2,4})$/);
    if (prefix) {
      subjectPrefixes.push(prefix[1]);
      continue;
    }

    // Free text ("history courses", "intro to psychology"): tokenize, drop
    // filler, then both (a) resolve the subject NAME to course prefixes and
    // (b) keep the cleaned tokens to AND-match against course titles. The two
    // are complementary — prefixes catch titles that omit the word; title
    // tokens catch states whose prefixes aren't in the name map.
    const tokens = raw
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && !SUBJECT_FILLER_WORDS.has(t));
    if (tokens.length === 0) continue;

    // Try the whole cleaned phrase first ("computer science"), then each token.
    const synonymPrefixes = new Set<string>(
      subjectPrefixesForName(tokens.join(" "))
    );
    if (synonymPrefixes.size === 0) {
      for (const tok of tokens) {
        for (const p of subjectPrefixesForName(tok)) synonymPrefixes.add(p);
      }
    }
    for (const p of synonymPrefixes) subjectPrefixes.push(p);

    keywordGroups.push(tokens);
  }

  return { exactCourses, subjectPrefixes, keywordGroups };
}

/**
 * Does a course match the parsed subject query? A match is any of:
 *  - exact course code (e.g. "HIST-101")
 *  - course prefix (clean prefix or one resolved from a subject name)
 *  - a keyword group where every token is a substring of the title (or equals
 *    the prefix) — AND semantics, so "world history" needs both words.
 */
export function matchesSubjectQuery(
  coursePrefix: string,
  courseTitle: string,
  courseKey: string,
  exactSet: Set<string>,
  prefixSet: Set<string>,
  keywordGroups: string[][]
): boolean {
  if (exactSet.size > 0 && exactSet.has(courseKey)) return true;
  if (prefixSet.has(coursePrefix)) return true;
  if (keywordGroups.length > 0) {
    const titleLower = courseTitle.toLowerCase();
    const prefixLower = coursePrefix.toLowerCase();
    for (const group of keywordGroups) {
      if (group.every((t) => titleLower.includes(t) || t === prefixLower)) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Time window parsing
// ---------------------------------------------------------------------------

export function parseTimeWindow(
  startStr: string,
  endStr: string
): { startMin: number; endMin: number } {
  // Handle bucket names
  const buckets: Record<string, { startMin: number; endMin: number }> = {
    morning: { startMin: 0, endMin: 720 }, // midnight–12 PM
    afternoon: { startMin: 720, endMin: 1020 }, // 12 PM–5 PM
    evening: { startMin: 1020, endMin: 1440 }, // 5 PM–midnight
  };

  const startBucket = buckets[startStr.toLowerCase()];
  const endBucket = buckets[endStr.toLowerCase()];
  if (startBucket && endBucket) {
    return { startMin: startBucket.startMin, endMin: endBucket.endMin };
  }
  if (startBucket) return startBucket;

  // Parse specific times
  const startMin = parseTimeToMinutes(startStr);
  const endMin = parseTimeToMinutes(endStr);

  // Default to all day if parsing fails
  if (startMin < 0 || endMin < 0) return { startMin: 0, endMin: 1440 };

  return { startMin, endMin };
}

// ---------------------------------------------------------------------------
// Stage 1: Filter sections
// ---------------------------------------------------------------------------

function filterSections(
  allSections: CourseSection[],
  exactCourses: string[],
  subjectPrefixes: string[],
  keywordGroups: string[][],
  availableDayMask: number,
  timeWindow: { startMin: number; endMin: number },
  modeFilter: string,
  maxDistance: number,
  distanceMap: Map<string, number>,
  instMap: Map<string, Institution>,
  includeInProgress: boolean,
  hideFullSections: boolean,
  transferLookup: TransferLookup | null,
  targetUniversity: string | null
): { sections: EnrichedSection[]; filteredFullCount: number } {
  const exactSet = new Set(exactCourses);
  const prefixSet = new Set(subjectPrefixes);

  const results: EnrichedSection[] = [];
  let filteredFullCount = 0;

  for (const s of allSections) {
    const courseKey = `${s.course_prefix}-${s.course_number}`;

    // Subject/course matching
    if (
      !matchesSubjectQuery(
        s.course_prefix,
        s.course_title,
        courseKey,
        exactSet,
        prefixSet,
        keywordGroups
      )
    ) {
      continue;
    }

    // Date filter: skip sections that already started (unless opted in)
    if (!includeInProgress && isInProgress(s.start_date)) continue;

    // Mode filter
    // Mode filter: "online" also matches "zoom" sections
    if (modeFilter !== "any") {
      if (modeFilter === "online" ? (s.mode !== "online" && s.mode !== "zoom") : s.mode !== modeFilter) continue;
    }

    // Pre-parse times and days
    const startMin = parseTimeToMinutes(s.start_time);
    const endMin = parseTimeToMinutes(s.end_time);
    const dayMask = daysToBitmask(s.days);
    const isAsync = startMin < 0 || endMin < 0 || dayMask === 0;

    // If user wants in-person, exclude sections with no scheduled times (TBA)
    if (modeFilter === "in-person" && isAsync) continue;

    // Day filter: section's days must be a subset of available days
    // (async sections pass through)
    if (!isAsync && (dayMask & ~availableDayMask) !== 0) continue;

    // Time window filter. Timed sections must fall inside the requested window.
    // Async / no-meeting-time sections normally "fit any schedule" and pass
    // through — BUT when the student narrowed Time of day (Morning/Afternoon/
    // Evening, i.e. a window tighter than all-day), they're asking for classes
    // that MEET then. An async course has no meeting time, so letting it pass
    // silently ignored that availability: picking "Evening" returned a wall of
    // anytime-online courses that don't meet in the evening. Keep async only
    // when Time is "Any" (full-day window) or the student explicitly wants
    // online/zoom/hybrid.
    const timeConstrained = timeWindow.startMin > 0 || timeWindow.endMin < 1440;
    const wantsOnline = modeFilter === "online" || modeFilter === "hybrid";
    if (isAsync) {
      if (timeConstrained && !wantsOnline) continue;
    } else if (startMin < timeWindow.startMin || endMin > timeWindow.endMin) {
      continue;
    }

    // Distance filter
    const dist = distanceMap.get(s.college_code) ?? null;
    if (!isAsync && dist !== null && dist > maxDistance) continue;
    // If mode is in-person and no distance data but maxDistance is set, let it through
    // (we only filter when we have data)

    // Seat availability filter (checked after all other criteria so count is
    // accurate). "Full" means 0 OR negative seats_open — a negative value is a
    // full section with a waitlist (35 states), which the old `=== 0` check
    // missed. Routed through lib/seats so sentinels/flags aren't mistaken for
    // full. Unknown (null) sections are kept.
    if (hideFullSections && isFullSection(s)) {
      filteredFullCount++;
      continue;
    }

    const inst = instMap.get(s.college_code);

    // Resolve transfer status for this course
    let transferStatus: TransferStatus = "unknown";
    let transferCourse = "";
    if (transferLookup && targetUniversity) {
      const entries = transferLookup[courseKey];
      if (entries) {
        // One-to-many: a course can map to the target university with several
        // statuses. Surface the best (direct > elective > no-credit), not
        // whichever row happens to be first. See lib/transfer-rank.ts.
        const match = bestTransferEntry(entries, targetUniversity);
        if (match) {
          transferStatus = match.type;
          transferCourse = match.course;
        }
      }
    }

    results.push({
      ...s,
      _startMin: startMin,
      _endMin: endMin,
      _dayMask: dayMask,
      _courseKey: courseKey,
      _distance: isAsync ? null : dist, // Online sections get null distance
      _collegeName: inst?.name || s.college_code,
      _isAsync: isAsync,
      _transferStatus: transferStatus,
      _transferCourse: transferCourse,
    });
  }

  return { sections: results, filteredFullCount };
}

// ---------------------------------------------------------------------------
// Stage 3: Select course combinations
// ---------------------------------------------------------------------------

function selectCourseCombinations(
  courseMap: Map<string, EnrichedSection[]>,
  maxCourses: number,
  exactCourses: string[],
  subjectPrefixes: string[]
): string[][] {
  const allKeys = Array.from(courseMap.keys());

  // If fewer courses available than requested, just use what we have
  const effectiveMax = Math.min(maxCourses, allKeys.length);
  if (effectiveMax === 0) return [];

  // If exact courses specified, use them directly
  if (exactCourses.length > 0 && exactCourses.length >= effectiveMax) {
    // Only include exact courses that have sections
    const available = exactCourses.filter((k) => courseMap.has(k));
    if (available.length === 0) return [];
    return combinations(available, effectiveMax);
  }

  // For prefix-based queries: take top N courses per prefix by section count
  const byPrefix = new Map<string, { key: string; count: number }[]>();
  for (const [key, sections] of courseMap) {
    const prefix = key.split("-")[0];
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix)!.push({ key, count: sections.length });
  }

  // Sort each prefix's courses by section count, take top N
  const topKeys: string[] = [];
  for (const [, courses] of byPrefix) {
    courses.sort((a, b) => b.count - a.count);
    for (const c of courses.slice(0, TOP_COURSES_PER_PREFIX)) {
      topKeys.push(c.key);
    }
  }

  // If mixed exact + prefix, include exact courses plus top prefix courses
  if (exactCourses.length > 0) {
    const available = exactCourses.filter((k) => courseMap.has(k));
    const prefixKeys = topKeys.filter((k) => !available.includes(k));
    const allCandidates = [...available, ...prefixKeys];
    return combinations(allCandidates, effectiveMax);
  }

  return combinations(topKeys, effectiveMax);
}

/** Generate all C(n, k) combinations of an array */
export function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  if (k === arr.length) return [arr];

  const results: T[][] = [];

  function recurse(start: number, current: T[]) {
    if (current.length === k) {
      results.push([...current]);
      return;
    }
    const remaining = k - current.length;
    for (let i = start; i <= arr.length - remaining; i++) {
      current.push(arr[i]);
      recurse(i + 1, current);
      current.pop();
    }
  }

  recurse(0, []);
  return results;
}

// ---------------------------------------------------------------------------
// Stage 4: Find valid (conflict-free) schedules
// ---------------------------------------------------------------------------

export function hasTimeConflict(
  a: EnrichedSection,
  b: EnrichedSection
): boolean {
  // Async sections never conflict
  if (a._isAsync || b._isAsync) return false;

  // Check day overlap via bitmask
  if ((a._dayMask & b._dayMask) === 0) return false;

  // Check time overlap
  return a._startMin < b._endMin && b._startMin < a._endMin;
}

export function hasBreakViolation(
  a: EnrichedSection,
  b: EnrichedSection,
  minBreakMinutes: number
): boolean {
  if (minBreakMinutes <= 0) return false;
  if (a._isAsync || b._isAsync) return false;
  if ((a._dayMask & b._dayMask) === 0) return false;

  // Check if classes are close enough that break is violated
  const gapAB = b._startMin - a._endMin;
  const gapBA = a._startMin - b._endMin;

  // If they overlap, that's caught by hasTimeConflict
  // Check the gap between the end of one and start of another
  if (gapAB > 0 && gapAB < minBreakMinutes) return true;
  if (gapBA > 0 && gapBA < minBreakMinutes) return true;

  return false;
}

function findValidSchedules(
  courseSections: EnrichedSection[][],
  minBreakMinutes: number,
  maxDistance: number,
  distanceMap: Map<string, number>,
  existingHeap: GeneratedSchedule[],
  currentEvalCount: number
): { schedules: GeneratedSchedule[]; evaluated: number } {
  const schedules: GeneratedSchedule[] = [];
  let evaluated = 0;
  const maxEval = MAX_COMBINATIONS_EVALUATED - currentEvalCount;

  const n = courseSections.length;
  if (n === 0) return { schedules, evaluated: 0 };

  if (n === 1) {
    // Single course — each section is a valid schedule
    for (const s of courseSections[0]) {
      evaluated++;
      if (evaluated > maxEval) break;
      const schedule = buildSchedule([s], maxDistance, distanceMap);
      schedules.push(schedule);
    }
    return { schedules, evaluated };
  }

  if (n === 2) {
    for (const s1 of courseSections[0]) {
      for (const s2 of courseSections[1]) {
        evaluated++;
        if (evaluated > maxEval) return { schedules, evaluated };

        if (hasTimeConflict(s1, s2)) continue;
        if (hasBreakViolation(s1, s2, minBreakMinutes)) continue;

        const schedule = buildSchedule([s1, s2], maxDistance, distanceMap);
        schedules.push(schedule);
      }
    }
    return { schedules, evaluated };
  }

  // n >= 3: generic recursive approach with early pruning
  const picked: EnrichedSection[] = [];

  function recurse(depth: number) {
    if (evaluated > maxEval) return;
    if (depth === n) {
      const schedule = buildSchedule([...picked], maxDistance, distanceMap);
      schedules.push(schedule);
      return;
    }

    for (const candidate of courseSections[depth]) {
      evaluated++;
      if (evaluated > maxEval) return;

      // Check conflicts with all previously-picked sections
      let conflict = false;
      for (const prev of picked) {
        if (hasTimeConflict(candidate, prev) || hasBreakViolation(candidate, prev, minBreakMinutes)) {
          conflict = true;
          break;
        }
      }
      if (conflict) continue;

      picked.push(candidate);
      recurse(depth + 1);
      picked.pop();
    }
  }

  recurse(0);
  return { schedules, evaluated };
}

// ---------------------------------------------------------------------------
// Build + Score a schedule
// ---------------------------------------------------------------------------

function buildSchedule(
  sections: EnrichedSection[],
  maxDistance: number,
  distanceMap: Map<string, number>
): GeneratedSchedule {
  const scheduleSections: ScheduleSection[] = sections.map((s) => {
    // Strip internal fields
    const { _startMin, _endMin, _dayMask, _courseKey, _distance, _collegeName, _isAsync, _transferStatus, _transferCourse, ...base } = s;
    return {
      ...base,
      collegeName: _collegeName,
      distance: _distance,
      transferStatus: _transferStatus !== "unknown" ? _transferStatus : undefined,
      transferCourse: _transferCourse || undefined,
    };
  });

  const scoreBreakdown = scoreSchedule(sections, maxDistance);
  const score =
    scoreBreakdown.timeCompactness +
    scoreBreakdown.distanceScore +
    scoreBreakdown.dayConsolidation +
    scoreBreakdown.varietyScore +
    scoreBreakdown.seatAvailability +
    scoreBreakdown.transferScore;

  // Deterministic ID — group by course+college+schedule to deduplicate
  // visually identical results (e.g., multiple CRNs of same async course)
  const id = sections
    .map((s) => `${s._courseKey}@${s.college_code}:${s.days || "ASYNC"}:${s._startMin}`)
    .sort()
    .join("|");

  return {
    id,
    score: Math.round(score * 10) / 10,
    sections: scheduleSections,
    scoreBreakdown,
  };
}

function scoreSchedule(
  sections: EnrichedSection[],
  maxDistance: number
): ScoreBreakdown {
  return {
    timeCompactness: scoreTimeCompactness(sections),
    distanceScore: scoreDistance(sections, maxDistance),
    dayConsolidation: scoreDayConsolidation(sections),
    varietyScore: scoreVariety(sections),
    seatAvailability: scoreSeatAvailability(sections),
    transferScore: scoreTransfer(sections),
  };
}

/** Time Compactness (0-20): ratio of class time to total span per day */
function scoreTimeCompactness(sections: EnrichedSection[]): number {
  const MAX = 20;
  const inPerson = sections.filter((s) => !s._isAsync);
  if (inPerson.length === 0) return MAX; // All async = perfectly compact

  // Group by day
  const byDay = new Map<number, { start: number; end: number; duration: number }[]>();
  for (const s of inPerson) {
    const duration = s._endMin - s._startMin;
    // For each day bit set
    for (let bit = 1; bit <= 32; bit <<= 1) {
      if (s._dayMask & bit) {
        if (!byDay.has(bit)) byDay.set(bit, []);
        byDay.get(bit)!.push({
          start: s._startMin,
          end: s._endMin,
          duration,
        });
      }
    }
  }

  let totalRatio = 0;
  let dayCount = 0;

  for (const [, classes] of byDay) {
    if (classes.length === 0) continue;
    dayCount++;

    const earliest = Math.min(...classes.map((c) => c.start));
    const latest = Math.max(...classes.map((c) => c.end));
    const span = latest - earliest;
    const totalClassTime = classes.reduce((sum, c) => sum + c.duration, 0);

    totalRatio += span > 0 ? totalClassTime / span : 1;
  }

  const avgRatio = dayCount > 0 ? totalRatio / dayCount : 1;
  return Math.round(avgRatio * MAX * 10) / 10;
}

/** Distance Score (0-20): lower average distance = higher score */
function scoreDistance(
  sections: EnrichedSection[],
  maxDistance: number
): number {
  const MAX = 20;
  if (!isFinite(maxDistance) || maxDistance <= 0) return MAX;

  const distances: number[] = [];
  for (const s of sections) {
    if (s._isAsync || s._distance === null) {
      distances.push(0); // Online = 0 distance (best)
    } else {
      distances.push(s._distance);
    }
  }

  if (distances.length === 0) return MAX;

  const avg = distances.reduce((a, b) => a + b, 0) / distances.length;
  const ratio = 1 - Math.min(avg / maxDistance, 1);
  return Math.round(ratio * MAX * 10) / 10;
}

/** Day Consolidation (0-20): fewer unique days = higher score */
function scoreDayConsolidation(sections: EnrichedSection[]): number {
  let combinedMask = 0;
  for (const s of sections) {
    if (!s._isAsync) {
      combinedMask |= s._dayMask;
    }
  }

  // Count bits set
  let dayCount = 0;
  for (let bit = 1; bit <= 32; bit <<= 1) {
    if (combinedMask & bit) dayCount++;
  }

  if (dayCount === 0) return 20; // All async

  // Score: 1 day = 20, 2 = 20, 3 = 18, 4 = 12, 5 = 6, 6 = 2
  // MWF (3 days) is a standard academic pattern and scores close to TTh (2 days)
  const scores = [20, 20, 20, 18, 12, 6, 2];
  return scores[Math.min(dayCount, 6)];
}

/** Variety Score (0-10): more distinct subject prefixes = higher score */
function scoreVariety(sections: EnrichedSection[]): number {
  const MAX = 10;
  const prefixes = new Set(sections.map((s) => s.course_prefix));
  const total = sections.length;
  if (total <= 1) return MAX;

  const uniquePrefixes = prefixes.size;
  // All different = 10, all same = 3
  const ratio = uniquePrefixes / total;
  return Math.round((3 + ratio * 7) * 10) / 10;
}

/** A section is "full" (no enrollable seats) when seats_open is 0 or negative
 *  (negative = full with a waitlist). Sentinels/flags/unknown are NOT full. */
export function isFullSection(s: {
  seats_open: number | null;
  seats_total: number | null;
}): boolean {
  return describeSeats(s.seats_open, s.seats_total).status === "full";
}

/** Seat Availability (0-15): more open seats = higher score */
export function scoreSeatAvailability(
  sections: Pick<EnrichedSection, "seats_open" | "seats_total">[],
): number {
  const MAX = 15;
  let totalScore = 0;
  let count = 0;

  for (const s of sections) {
    count++;
    // Route through lib/seats so negatives (waitlist) score as full and
    // sentinels (≥1000, e.g. 9999) aren't turned into a bogus fill ratio.
    const info = describeSeats(s.seats_open, s.seats_total);
    if (info.status === "unknown") {
      totalScore += 0.5; // no data — neutral (mid-range), unchanged
      continue;
    }
    if (info.status === "full") {
      totalScore += 0; // 0 or waitlisted — no availability
      continue;
    }
    if (info.status === "open" || info.total == null) {
      // Available, but no trustworthy capacity (sentinel/online-unlimited, a
      // flag-state open, or an open count with no sane total). Score it
      // "available but uncertain" — high, but below a confirmed wide-open
      // section, so an unknown-capacity section is never ranked most-available.
      totalScore += 0.75;
      continue;
    }
    // Real count with a sane total → graded fill ratio.
    const fillRatio = info.open! / info.total;
    // >50% open = full score, 25-50% = linear, 10-25% = steeper penalty, <10% = low
    if (fillRatio >= 0.5) {
      totalScore += 1.0;
    } else if (fillRatio >= 0.25) {
      totalScore += 0.5 + (fillRatio - 0.25) * 2; // 0.5 - 1.0
    } else if (fillRatio >= 0.1) {
      totalScore += 0.2 + (fillRatio - 0.1) * 2; // 0.2 - 0.5
    } else {
      totalScore += fillRatio * 2; // 0.0 - 0.2
    }
  }

  if (count === 0) return MAX;
  const avgScore = totalScore / count;
  return Math.round(avgScore * MAX * 10) / 10;
}

/** Transfer Score (0-15): direct matches > elective > unknown > no-credit */
function scoreTransfer(sections: EnrichedSection[]): number {
  const MAX = 15;
  let totalScore = 0;
  let count = 0;

  for (const s of sections) {
    count++;
    switch (s._transferStatus) {
      case "direct":
        totalScore += 1.0;
        break;
      case "elective":
        totalScore += 0.5;
        break;
      case "unknown":
        // No transfer data — neutral (don't penalize states without data)
        totalScore += 0.5;
        break;
      case "no-credit":
        totalScore += 0.0;
        break;
    }
  }

  if (count === 0) return MAX;
  const avgScore = totalScore / count;
  return Math.round(avgScore * MAX * 10) / 10;
}

// ---------------------------------------------------------------------------
// Min-heap operations (by score, keep top MAX_HEAP_SIZE)
// ---------------------------------------------------------------------------

function insertIntoHeap(
  heap: GeneratedSchedule[],
  schedule: GeneratedSchedule
): void {
  // Deduplicate by ID
  const existingIdx = heap.findIndex((s) => s.id === schedule.id);
  if (existingIdx >= 0) {
    if (schedule.score > heap[existingIdx].score) {
      heap[existingIdx] = schedule;
    }
    return;
  }

  if (heap.length < MAX_HEAP_SIZE) {
    heap.push(schedule);
  } else {
    // Find the worst score in the heap
    let worstIdx = 0;
    let worstScore = heap[0].score;
    for (let i = 1; i < heap.length; i++) {
      if (heap[i].score < worstScore) {
        worstScore = heap[i].score;
        worstIdx = i;
      }
    }
    if (schedule.score > worstScore) {
      heap[worstIdx] = schedule;
    }
  }
}
