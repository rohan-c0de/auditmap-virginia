/**
 * Smart Schedule Builder — core algorithm.
 *
 * Given user constraints (subjects, days, times, distance, modality),
 * generates ranked conflict-free course schedule combinations across
 * all 23 VCCS colleges.
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
} from "./types";
import { loadAllCourses } from "./courses";
import { getZipCoordinates, calculateDistance } from "./geo";
import { parseTimeToMinutes, daysToBitmask } from "./time-utils";
import { isInProgress } from "./course-status";
import { getCurrentTerm } from "./terms";
const MAX_RESULTS = 20;
const MAX_HEAP_SIZE = 50;
const MAX_COMBINATIONS_EVALUATED = 100_000;
const TOP_COURSES_PER_PREFIX = 5;

// ---------------------------------------------------------------------------
// Enriched section with pre-parsed numeric fields for fast comparison
// ---------------------------------------------------------------------------

interface EnrichedSection extends CourseSection {
  _startMin: number; // minutes since midnight, -1 if TBA
  _endMin: number;
  _dayMask: number; // bitmask of days
  _courseKey: string; // e.g. "ART-101"
  _distance: number | null;
  _collegeName: string;
  _isAsync: boolean;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function generateSchedules(
  request: ScheduleRequest,
  institutions: Institution[]
): ScheduleResponse {
  const t0 = performance.now();

  // Build institution lookup
  const instMap = new Map<string, Institution>();
  for (const inst of institutions) {
    instMap.set(inst.vccs_slug, inst);
  }

  // Pre-compute distance map: college slug → nearest campus distance
  let userCoords: { lat: number; lng: number } | null = null;
  const distanceMap = new Map<string, number>();

  if (request.zip) {
    const zipInfo = getZipCoordinates(request.zip);
    if (zipInfo) {
      userCoords = { lat: zipInfo.lat, lng: zipInfo.lng };
      for (const inst of institutions) {
        if (inst.campuses.length === 0) continue;
        const minDist = Math.min(
          ...inst.campuses.map((c) =>
            calculateDistance(userCoords!.lat, userCoords!.lng, c.lat, c.lng)
          )
        );
        distanceMap.set(inst.vccs_slug, Math.round(minDist * 10) / 10);
      }
    }
  }

  // Parse subject queries
  const { exactCourses, subjectPrefixes } = parseSubjectQueries(
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
  const term = request.term || getCurrentTerm();
  const allSections = loadAllCourses(term);
  const candidates = filterSections(
    allSections,
    exactCourses,
    subjectPrefixes,
    availableDayMask,
    timeWindow,
    request.mode || "any",
    request.maxDistance ?? Infinity,
    distanceMap,
    instMap,
    request.includeInProgress ?? false
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
  if (candidateCourses < request.maxCourses) {
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
    },
  };
}

// ---------------------------------------------------------------------------
// Subject query parsing
// ---------------------------------------------------------------------------

function parseSubjectQueries(subjects: string[]): {
  exactCourses: string[]; // e.g. ["PSY-200", "ART-101"]
  subjectPrefixes: string[]; // e.g. ["BIO"]
} {
  const exactCourses: string[] = [];
  const subjectPrefixes: string[] = [];

  for (const raw of subjects) {
    const trimmed = raw.trim().toUpperCase();
    // "PSY 200" or "PSY200"
    const exact = trimmed.match(/^([A-Z]{2,4})\s*(\d{3})$/);
    if (exact) {
      exactCourses.push(`${exact[1]}-${exact[2]}`);
    } else {
      // "ART" or "art" or "psychology" (keyword)
      const prefix = trimmed.match(/^([A-Z]{2,4})$/);
      if (prefix) {
        subjectPrefixes.push(prefix[1]);
      } else {
        // Treat as keyword — match against prefix or title
        subjectPrefixes.push(trimmed);
      }
    }
  }

  return { exactCourses, subjectPrefixes };
}

// ---------------------------------------------------------------------------
// Time window parsing
// ---------------------------------------------------------------------------

function parseTimeWindow(
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
  availableDayMask: number,
  timeWindow: { startMin: number; endMin: number },
  modeFilter: string,
  maxDistance: number,
  distanceMap: Map<string, number>,
  instMap: Map<string, Institution>,
  includeInProgress: boolean
): EnrichedSection[] {
  const exactSet = new Set(exactCourses);
  const prefixSet = new Set(subjectPrefixes);
  // For keyword search: lowercase prefixes that don't look like course codes
  const keywords = subjectPrefixes.filter((p) => p.length > 4 || !/^[A-Z]+$/.test(p));
  const keywordsLower = keywords.map((k) => k.toLowerCase());

  const results: EnrichedSection[] = [];

  for (const s of allSections) {
    const courseKey = `${s.course_prefix}-${s.course_number}`;

    // Subject/course matching
    let matched = false;
    if (exactSet.size > 0 && exactSet.has(courseKey)) {
      matched = true;
    }
    if (!matched && prefixSet.has(s.course_prefix)) {
      matched = true;
    }
    if (!matched && keywordsLower.length > 0) {
      const titleLower = s.course_title.toLowerCase();
      for (const kw of keywordsLower) {
        if (titleLower.includes(kw)) {
          matched = true;
          break;
        }
      }
    }
    if (!matched) continue;

    // Date filter: skip sections that already started (unless opted in)
    if (!includeInProgress && isInProgress(s.start_date)) continue;

    // Mode filter
    if (modeFilter !== "any" && s.mode !== modeFilter) continue;

    // Pre-parse times and days
    const startMin = parseTimeToMinutes(s.start_time);
    const endMin = parseTimeToMinutes(s.end_time);
    const dayMask = daysToBitmask(s.days);
    const isAsync = startMin < 0 || endMin < 0 || dayMask === 0;

    // Day filter: section's days must be a subset of available days
    // (async sections pass through)
    if (!isAsync && (dayMask & ~availableDayMask) !== 0) continue;

    // Time window filter (async sections pass through)
    if (!isAsync) {
      if (startMin < timeWindow.startMin || endMin > timeWindow.endMin) continue;
    }

    // Distance filter
    const dist = distanceMap.get(s.college_code) ?? null;
    if (!isAsync && dist !== null && dist > maxDistance) continue;
    // If mode is in-person and no distance data but maxDistance is set, let it through
    // (we only filter when we have data)

    const inst = instMap.get(s.college_code);

    results.push({
      ...s,
      _startMin: startMin,
      _endMin: endMin,
      _dayMask: dayMask,
      _courseKey: courseKey,
      _distance: isAsync ? null : dist, // Online sections get null distance
      _collegeName: inst?.name || s.college_code,
      _isAsync: isAsync,
    });
  }

  return results;
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
function combinations<T>(arr: T[], k: number): T[][] {
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

function hasTimeConflict(
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

function hasBreakViolation(
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

  // n === 3
  for (const s1 of courseSections[0]) {
    for (const s2 of courseSections[1]) {
      evaluated++;
      if (evaluated > maxEval) return { schedules, evaluated };

      if (hasTimeConflict(s1, s2)) continue;
      if (hasBreakViolation(s1, s2, minBreakMinutes)) continue;

      for (const s3 of courseSections[2]) {
        evaluated++;
        if (evaluated > maxEval) return { schedules, evaluated };

        if (hasTimeConflict(s3, s1) || hasTimeConflict(s3, s2)) continue;
        if (
          hasBreakViolation(s3, s1, minBreakMinutes) ||
          hasBreakViolation(s3, s2, minBreakMinutes)
        )
          continue;

        const schedule = buildSchedule(
          [s1, s2, s3],
          maxDistance,
          distanceMap
        );
        schedules.push(schedule);
      }
    }
  }

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
    const { _startMin, _endMin, _dayMask, _courseKey, _distance, _collegeName, _isAsync, ...base } = s;
    return {
      ...base,
      collegeName: _collegeName,
      distance: _distance,
    };
  });

  const scoreBreakdown = scoreSchedule(sections, maxDistance);
  const score =
    scoreBreakdown.timeCompactness +
    scoreBreakdown.distanceScore +
    scoreBreakdown.dayConsolidation +
    scoreBreakdown.varietyScore;

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
  };
}

/** Time Compactness (0-25): ratio of class time to total span per day */
function scoreTimeCompactness(sections: EnrichedSection[]): number {
  const inPerson = sections.filter((s) => !s._isAsync);
  if (inPerson.length === 0) return 25; // All async = perfectly compact

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
  return Math.round(avgRatio * 25 * 10) / 10;
}

/** Distance Score (0-25): lower average distance = higher score */
function scoreDistance(
  sections: EnrichedSection[],
  maxDistance: number
): number {
  if (maxDistance === Infinity || maxDistance === 0) return 25;

  const distances: number[] = [];
  for (const s of sections) {
    if (s._isAsync || s._distance === null) {
      distances.push(0); // Online = 0 distance (best)
    } else {
      distances.push(s._distance);
    }
  }

  if (distances.length === 0) return 25;

  const avg = distances.reduce((a, b) => a + b, 0) / distances.length;
  const ratio = 1 - Math.min(avg / maxDistance, 1);
  return Math.round(ratio * 25 * 10) / 10;
}

/** Day Consolidation (0-25): fewer unique days = higher score */
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

  if (dayCount === 0) return 25; // All async

  // Score: 1 day = 25, 2 = 20, 3 = 15, 4 = 10, 5 = 5, 6 = 2
  const scores = [25, 25, 20, 15, 10, 5, 2];
  return scores[Math.min(dayCount, 6)];
}

/** Variety Score (0-25): more distinct subject prefixes = higher score */
function scoreVariety(sections: EnrichedSection[]): number {
  const prefixes = new Set(sections.map((s) => s.course_prefix));
  const total = sections.length;
  if (total <= 1) return 25;

  const uniquePrefixes = prefixes.size;
  // All different = 25, all same = 8
  const ratio = uniquePrefixes / total;
  return Math.round((8 + ratio * 17) * 10) / 10;
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
