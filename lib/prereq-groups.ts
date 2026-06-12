// Prerequisite text → structure parsing. Pure string logic, NO fs/server
// imports — safe to import from client components (SemesterPlanner) and from
// server code (lib/prereqs.buildChain) alike. This is the single source of
// truth for AND/OR grouping; do not re-implement it locally in a component
// (a stale client-side copy of this parser is what shipped the OR-as-AND
// planner bug: mixed-case course names fell out of their OR group and every
// alternative rendered as a separate required course).
//
// Two catalog conventions exist in our data, distinguishable by a simple
// signal:
//
// 1. SLOT STYLE (most states — VA/NC/GA/NY…): "A and B or C and D" means
//    A and (B or C) and D — "and" separates requirement slots, each slot
//    lists interchangeable courses. Every course is mentioned exactly once.
//
// 2. ENUMERATED-COMBINATION STYLE (e.g. Tri-C/OH): "A or B or C and D or
//    C' and D" enumerates complete ways to satisfy the requirement —
//    OR-of-ANDs. The tell: the same course appears in MULTIPLE combinations,
//    so some course is mentioned more than once in the text. Parsing this
//    with the slot convention overstates requirements (the planner told
//    students 8 courses were required when any 1 of 8 alternatives works).

/** True when `text` mentions `course` at `idx` with word-ish boundaries on
 *  both sides (so "MATH 101" doesn't match inside "MATH 1010"). */
function boundedAt(upperText: string, upperCourse: string, idx: number): boolean {
  const before = idx === 0 ? "" : upperText[idx - 1];
  const afterIdx = idx + upperCourse.length;
  const after = afterIdx >= upperText.length ? "" : upperText[afterIdx];
  const alnum = /[A-Z0-9]/;
  return !alnum.test(before) && !alnum.test(after);
}

/** Count boundary-checked, case-insensitive mentions of `course` in `text`. */
export function countMentions(text: string, course: string): number {
  const upperText = text.toUpperCase();
  const upperCourse = course.toUpperCase();
  if (!upperCourse) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = upperText.indexOf(upperCourse, from);
    if (idx === -1) break;
    if (boundedAt(upperText, upperCourse, idx)) count++;
    from = idx + 1;
  }
  return count;
}

/** Boundary-checked, case-insensitive "does this chunk mention this course". */
function mentions(chunk: string, course: string): boolean {
  return countMentions(chunk, course) > 0;
}

/** Split `text` on a top-level connector word ("and" / "or"), ignoring
 *  occurrences inside parentheses. */
function splitTopLevel(text: string, connector: "and" | "or"): string[] {
  const chunks: string[] = [];
  let depth = 0;
  let current = "";
  const tokens = text.split(/(\s+)/);
  for (const token of tokens) {
    for (const ch of token) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
    }
    if (token.toLowerCase() === connector && depth === 0 && current.trim()) {
      chunks.push(current.trim());
      current = "";
    } else {
      current += token;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/**
 * Detect enumerated-combination texts: the same course is referenced in more
 * than one place AND the text actually offers alternatives ("or"). Slot-style
 * texts mention each course exactly once.
 */
export function hasEnumeratedCombos(text: string, courses: string[]): boolean {
  if (courses.length < 2) return false;
  if (splitTopLevel(text, "or").length < 2) return false;
  return courses.some((c) => countMentions(text, c) >= 2);
}

/**
 * SLOT convention parse → AND-of-OR groups.
 * "ACC 101 and (BUS 107 or CIS 107)" → [["ACC 101"], ["BUS 107","CIS 107"]]
 * Outer array = AND (all groups required); inner array = OR (pick one).
 *
 * Strategy: split the text on top-level "and" (outside parentheses), then map
 * each known course to the chunk it appears in. Courses in the same chunk
 * form an OR group. Courses the text never mentions become their own
 * required group rather than being silently dropped.
 */
export function parseSlotGroups(text: string, courses: string[]): string[][] {
  if (courses.length === 0) return [];
  if (courses.length === 1) return [courses];

  const chunks = splitTopLevel(text, "and");

  const groups: string[][] = [];
  const assigned = new Set<string>();
  for (const chunk of chunks) {
    const group: string[] = [];
    for (const course of courses) {
      if (assigned.has(course)) continue;
      // Case-insensitive on both sides: course codes can be stored mixed-case
      // ("Business (BUS) 121"), and a case-sensitive match silently drops them
      // out of their OR group — making "X or Y" render as "X and Y", a wrong
      // (and costly) prerequisite signal.
      if (mentions(chunk, course)) {
        group.push(course);
        assigned.add(course);
      }
    }
    if (group.length > 0) groups.push(group);
  }
  for (const course of courses) {
    if (!assigned.has(course)) groups.push([course]);
  }
  return groups;
}

/**
 * ENUMERATED-COMBINATION parse → OR-of-ANDs.
 * "A or B or C and D or C' and D" →
 *   options: [["A"], ["B"], ["C","D"], ["C'","D"]]  (any ONE option suffices)
 *   required: courses the text never mentions (kept as unconditional, so
 *   nothing is silently dropped).
 */
export function parseComboOptions(
  text: string,
  courses: string[],
): { options: string[][]; required: string[] } {
  const chunks = splitTopLevel(text, "or");
  const seenAnywhere = new Set<string>();
  const options: string[][] = [];
  for (const chunk of chunks) {
    const upperChunk = chunk.toUpperCase();
    const set: string[] = [];
    for (const course of courses) {
      if (mentions(chunk, course)) {
        set.push(course);
        seenAnywhere.add(course);
      }
    }
    // Present each option in the order the catalog text lists its courses.
    set.sort(
      (a, b) =>
        upperChunk.indexOf(a.toUpperCase()) - upperChunk.indexOf(b.toUpperCase()),
    );
    if (set.length > 0) options.push(set);
  }
  const required = courses.filter((c) => !seenAnywhere.has(c));
  return { options, required };
}

/**
 * AND-of-OR view over either convention — the shape ChainNode.groups and the
 * prereq flowchart consume. For combination texts the faithful structure
 * (OR-of-ANDs) can't be expressed in this shape, so all combination members
 * collapse into one OR group: the graph then correctly paints every edge as
 * "one of several" instead of "required".
 */
export function parsePrereqGroups(text: string, courses: string[]): string[][] {
  if (hasEnumeratedCombos(text, courses)) {
    const { options, required } = parseComboOptions(text, courses);
    const inOptions: string[] = [];
    const seen = new Set<string>();
    for (const opt of options) {
      for (const c of opt) {
        if (!seen.has(c)) {
          seen.add(c);
          inOptions.push(c);
        }
      }
    }
    const groups: string[][] = inOptions.length > 0 ? [inOptions] : [];
    for (const r of required) groups.push([r]);
    return groups;
  }
  return parseSlotGroups(text, courses);
}

/**
 * One requirement the student must satisfy: the cheapest way to meet it
 * (`chosen`, possibly several courses for combination texts) plus the other
 * ways (`alternatives`, each itself a set of courses to take together).
 */
export interface ResolvedRequirement {
  chosen: string[];
  alternatives: string[][];
}

/**
 * Resolve a prereq entry into concrete requirements for the semester planner:
 * pick the cheapest way to satisfy each slot/combination (via `cost`, lower
 * is cheaper — e.g. 1 + the course's own direct-prereq count), and keep the
 * alternatives so the UI can say "or N other options" instead of pretending
 * the choice doesn't exist.
 */
export function resolveRequirements(
  text: string,
  courses: string[],
  cost: (course: string) => number,
): ResolvedRequirement[] {
  if (courses.length === 0) return [];

  const setCost = (set: string[]) => set.reduce((sum, c) => sum + cost(c), 0);

  if (hasEnumeratedCombos(text, courses)) {
    const { options, required } = parseComboOptions(text, courses);
    const out: ResolvedRequirement[] = [];
    if (options.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < options.length; i++) {
        if (setCost(options[i]) < setCost(options[bestIdx])) bestIdx = i;
      }
      out.push({
        chosen: options[bestIdx],
        alternatives: options.filter((_, i) => i !== bestIdx),
      });
    }
    for (const r of required) out.push({ chosen: [r], alternatives: [] });
    return out;
  }

  return parseSlotGroups(text, courses).map((group) => {
    if (group.length === 1) return { chosen: group, alternatives: [] };
    let best = group[0];
    for (const c of group) {
      if (cost(c) < cost(best)) best = c;
    }
    return {
      chosen: [best],
      alternatives: group.filter((c) => c !== best).map((c) => [c]),
    };
  });
}
