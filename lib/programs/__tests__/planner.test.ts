import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TransferMapping } from "@/lib/types";

// All loaders that buildMajorPlan depends on are mocked. The point of these
// tests is the integration contract — that the planner calls the new
// targeted loader with the deduped (prefix, number) list pulled from the
// program's requirement_groups, and that the returned mappings flow into a
// correctly-shaped MajorPlan.
const {
  loadInstitutionsMock,
  loadCollegeProgramsMock,
  loadTransferMappingsForCoursesMock,
  loadPrereqsMock,
  getCurrentTermMock,
} = vi.hoisted(() => ({
  loadInstitutionsMock: vi.fn(),
  loadCollegeProgramsMock: vi.fn(),
  loadTransferMappingsForCoursesMock: vi.fn(),
  loadPrereqsMock: vi.fn(() => new Map()),
  getCurrentTermMock: vi.fn(async () => "2026SP"),
}));

// next/cache's unstable_cache throws "Invariant: incrementalCache missing"
// when called outside the Next.js request runtime. For unit tests we want it
// to be a transparent passthrough so we exercise the actual planner logic
// rather than the cache layer. Production behavior is verified separately
// via the post-deploy `x-vercel-cache: HIT` curl in the PR's test plan.
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/institutions", () => ({
  loadInstitutions: loadInstitutionsMock,
}));
vi.mock("@/lib/programs/requirements", () => ({
  loadCollegePrograms: loadCollegeProgramsMock,
}));
vi.mock("@/lib/transfer", () => ({
  loadTransferMappingsForCourses: loadTransferMappingsForCoursesMock,
}));
vi.mock("@/lib/prereqs", () => ({ loadPrereqs: loadPrereqsMock }));
vi.mock("@/lib/terms", () => ({ getCurrentTerm: getCurrentTermMock }));

import { buildMajorPlan, programSlug } from "../planner";

// ── fixtures ───────────────────────────────────────────────────────────────

const FAKE_INSTITUTION = {
  id: "cuyamaca",
  name: "Cuyamaca College",
  college_slug: "cuyamaca-college",
};

// 6 distinct real courses (above PLAN_MIN_COURSES = 5) plus an XXX
// placeholder and a deliberate CS 110 duplicate across groups — exercises
// both the placeholder-filter and the dedup behavior the planner relies on.
const FAKE_PROGRAM = {
  title: "Computer Science for Transfer (AS-T)",
  credential: "AS",
  catalog_url: "https://example/cs",
  total_credits: 60,
  gpa_minimum: 2.0,
  requirement_groups: [
    {
      name: "Core",
      credits_required: null,
      choose_n: null,
      courses: [
        { prefix: "CS", number: "110", title: "Intro to CS", credits: "4", or_alternatives: [] },
        { prefix: "CS", number: "120", title: "Data Structures", credits: "4", or_alternatives: [] },
        { prefix: "CS", number: "210", title: "Systems", credits: "4", or_alternatives: [] },
      ],
    },
    {
      name: "Math",
      credits_required: null,
      choose_n: null,
      courses: [
        { prefix: "MATH", number: "280", title: "Calc I", credits: "5", or_alternatives: [] },
        { prefix: "MATH", number: "281", title: "Calc II", credits: "5", or_alternatives: [] },
        // CS 110 duplicated across a different group → loader must dedup.
        { prefix: "CS", number: "110", title: "Intro to CS", credits: "4", or_alternatives: [] },
        // Placeholder that should NOT be sent to the loader.
        { prefix: "XXX", number: "Elective", title: "Placeholder", credits: null, or_alternatives: [] },
      ],
    },
    {
      name: "Science",
      credits_required: null,
      choose_n: null,
      courses: [
        { prefix: "PHYS", number: "200", title: "Physics I", credits: "4", or_alternatives: [] },
      ],
    },
  ],
};

function makeMapping(
  prefix: string,
  number: string,
  uni: string,
  opts: Partial<TransferMapping> = {},
): TransferMapping {
  return {
    cc_prefix: prefix,
    cc_number: number,
    cc_course: `${prefix} ${number}`,
    cc_title: `${prefix} ${number}`,
    cc_credits: "3",
    university: uni,
    university_name: uni.toUpperCase(),
    univ_course: `U${prefix} ${number}`,
    univ_title: "Univ Title",
    univ_credits: "3",
    notes: "",
    no_credit: false,
    is_elective: false,
    ...opts,
  };
}

beforeEach(() => {
  loadInstitutionsMock.mockReset();
  loadCollegeProgramsMock.mockReset();
  loadTransferMappingsForCoursesMock.mockReset();
  loadPrereqsMock.mockReset();
  getCurrentTermMock.mockReset();

  loadInstitutionsMock.mockReturnValue([FAKE_INSTITUTION]);
  loadCollegeProgramsMock.mockResolvedValue([FAKE_PROGRAM]);
  loadPrereqsMock.mockReturnValue(new Map());
  getCurrentTermMock.mockResolvedValue("2026SP");
  loadTransferMappingsForCoursesMock.mockResolvedValue([]);
});

describe("buildMajorPlan — targeted transfer loader integration", () => {
  it("calls loadTransferMappingsForCourses with the program's REAL courses (XXX placeholders dropped before the query)", async () => {
    await buildMajorPlan("ca", "cuyamaca", programSlug(FAKE_PROGRAM));

    expect(loadTransferMappingsForCoursesMock).toHaveBeenCalledTimes(1);
    const [state, courses] = loadTransferMappingsForCoursesMock.mock.calls[0];

    expect(state).toBe("ca");
    // XXX placeholder is dropped by isRealCourse before reaching the loader.
    // CS 110 still appears twice — the planner passes the raw per-group list;
    // dedup is the loader's responsibility (covered in transfer.test.ts).
    const tuples = (courses as Array<{ prefix: string; number: string }>)
      .map((c) => `${c.prefix} ${c.number}`)
      .sort();
    expect(tuples).toEqual([
      "CS 110",
      "CS 110", // duplicated across Core + Math groups
      "CS 120",
      "CS 210",
      "MATH 280",
      "MATH 281",
      "PHYS 200",
    ]);
    // Placeholder must NOT be in the list.
    expect(tuples).not.toContain("XXX Elective");
  });

  it("builds the per-university coverage map from the returned mappings", async () => {
    loadTransferMappingsForCoursesMock.mockResolvedValue([
      makeMapping("CS", "110", "ucsd"),
      makeMapping("CS", "120", "ucsd"),
      makeMapping("MATH", "280", "ucsd"),
      makeMapping("CS", "110", "sdsu"),
    ]);

    const plan = await buildMajorPlan("ca", "cuyamaca", programSlug(FAKE_PROGRAM));
    expect(plan).not.toBeNull();

    // Pre-existing planner behavior: a course duplicated across requirement
    // groups counts toward `accepts` per group-occurrence. CS 110 appears
    // in both Core and Math, so UCSD's CS 110 mapping increments twice.
    // UCSD: CS 110 (×2 groups) + CS 120 + MATH 280 = 4.
    // SDSU: CS 110 (×2 groups) = 2.
    const ucsd = plan!.universities.find((u) => u.slug === "ucsd");
    const sdsu = plan!.universities.find((u) => u.slug === "sdsu");
    expect(ucsd?.accepts).toBe(4);
    expect(sdsu?.accepts).toBe(2);
    // Sorted by coverage desc.
    expect(plan!.universities[0].slug).toBe("ucsd");
  });

  it("collapses multiple mappings for the same (course, university) to the best verdict (direct > elective > no-credit)", async () => {
    loadTransferMappingsForCoursesMock.mockResolvedValue([
      makeMapping("CS", "110", "ucsd", { is_elective: true }), // elective
      makeMapping("CS", "110", "ucsd", { is_elective: false }), // direct — should win
      makeMapping("CS", "110", "ucsd", { no_credit: true }), // no-credit — should lose
    ]);

    const plan = await buildMajorPlan("ca", "cuyamaca", programSlug(FAKE_PROGRAM));
    const cs110 = plan!.groups.flatMap((g) => g.courses).find((c) => c.code === "CS 110")!;

    expect(cs110.transfers.ucsd.status).toBe("direct");
    // Counted ONCE toward acceptingCount, not 3×.
    expect(cs110.acceptingCount).toBe(1);
  });

  it("returns null when the program slug doesn't match (does not call the transfer loader)", async () => {
    const plan = await buildMajorPlan("ca", "cuyamaca", "does-not-exist");
    expect(plan).toBeNull();
    expect(loadTransferMappingsForCoursesMock).not.toHaveBeenCalled();
  });

  it("returns null when the institution doesn't exist (does not call the transfer loader)", async () => {
    const plan = await buildMajorPlan("ca", "no-such-college", programSlug(FAKE_PROGRAM));
    expect(plan).toBeNull();
    expect(loadTransferMappingsForCoursesMock).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Audit pass: planner integration with the loader's post-fix skip-unsafe
// behavior. The loader now silently skips course tokens that don't match
// /^[A-Z0-9-]+$/i — these tests verify the planner doesn't crash on those
// courses and still renders them in the requirement list (just without
// transfer info).
// ───────────────────────────────────────────────────────────────────────────

describe("buildMajorPlan — audit: post-fix behavior with unsafe course codes", () => {
  it("a program course with a comma in its code is still listed in the plan; just has no transfer verdicts", async () => {
    loadCollegeProgramsMock.mockResolvedValue([
      {
        ...FAKE_PROGRAM,
        title: "Plan With Unsafe Course",
        requirement_groups: [
          {
            name: "Core",
            credits_required: null,
            choose_n: null,
            courses: [
              { prefix: "CS", number: "110", title: "Intro", credits: "4", or_alternatives: [] },
              { prefix: "CS", number: "120", title: "DS", credits: "4", or_alternatives: [] },
              { prefix: "CS", number: "210", title: "Sys", credits: "4", or_alternatives: [] },
              { prefix: "MATH", number: "280", title: "Calc1", credits: "5", or_alternatives: [] },
              { prefix: "MATH", number: "281", title: "Calc2", credits: "5", or_alternatives: [] },
              // Hostile / malformed code — loader should skip, but the course
              // must still appear in the plan UI so the student sees the
              // requirement (just with no transfer info next to it).
              { prefix: "BAD,SQL", number: "110", title: "Bad", credits: "3", or_alternatives: [] },
            ],
          },
        ],
      },
    ]);
    loadTransferMappingsForCoursesMock.mockResolvedValue([
      makeMapping("CS", "110", "ucsd"),
    ]);

    const plan = await buildMajorPlan(
      "ca",
      "cuyamaca",
      programSlug({ title: "Plan With Unsafe Course", credential: "AS" }),
    );
    expect(plan).not.toBeNull();
    const allCourses = plan!.groups.flatMap((g) => g.courses);
    const bad = allCourses.find((c) => c.code === "BAD,SQL 110");
    expect(bad).toBeDefined();
    expect(bad!.acceptingCount).toBe(0);
    expect(Object.keys(bad!.transfers)).toHaveLength(0);
  });

  it("a program course with whitespace in its code (trailing space) still gets its transfers resolved", async () => {
    loadCollegeProgramsMock.mockResolvedValue([
      {
        ...FAKE_PROGRAM,
        title: "Plan With Whitespace",
        requirement_groups: [
          {
            name: "Core",
            credits_required: null,
            choose_n: null,
            courses: [
              // " CS " with leading + trailing space — scraped programs do
              // occasionally have this. The loader trims before querying;
              // the planner's joinKey also strips whitespace, so the lookup
              // must still find the mapping that came back under "CS"/"110".
              { prefix: " CS ", number: " 110 ", title: "Intro", credits: "4", or_alternatives: [] },
              { prefix: "CS", number: "120", title: "DS", credits: "4", or_alternatives: [] },
              { prefix: "CS", number: "210", title: "Sys", credits: "4", or_alternatives: [] },
              { prefix: "MATH", number: "280", title: "C1", credits: "5", or_alternatives: [] },
              { prefix: "MATH", number: "281", title: "C2", credits: "5", or_alternatives: [] },
            ],
          },
        ],
      },
    ]);
    // Supabase row comes back with trimmed values (as it would in prod).
    loadTransferMappingsForCoursesMock.mockResolvedValue([
      makeMapping("CS", "110", "ucsd"),
    ]);

    const plan = await buildMajorPlan(
      "ca",
      "cuyamaca",
      programSlug({ title: "Plan With Whitespace", credential: "AS" }),
    );
    expect(plan).not.toBeNull();
    const cs110 = plan!.groups
      .flatMap((g) => g.courses)
      .find((c) => c.code === " CS  110 " || c.code === "CS 110" || c.code === " CS   110 ");
    expect(cs110).toBeDefined();
    // The transfer to UCSD MUST resolve despite the input whitespace,
    // because joinKey strips it on both the program side and the result side.
    expect(cs110!.acceptingCount).toBe(1);
    expect(cs110!.transfers.ucsd?.status).toBe("direct");
  });

  it("mapping rows for a (prefix, number) NOT in the program are ignored without crashing", async () => {
    loadTransferMappingsForCoursesMock.mockResolvedValue([
      makeMapping("CS", "110", "ucsd"),
      // Bogus extra row — should NEVER appear in any output because no
      // group has BIO 999.
      makeMapping("BIO", "999", "ucsd"),
    ]);

    const plan = await buildMajorPlan("ca", "cuyamaca", programSlug(FAKE_PROGRAM));
    expect(plan).not.toBeNull();
    const allCodes = plan!.groups.flatMap((g) => g.courses).map((c) => c.code);
    expect(allCodes).not.toContain("BIO 999");
    // UCSD coverage shouldn't be inflated by the orphan row.
    const ucsd = plan!.universities.find((u) => u.slug === "ucsd");
    // 1 group occurrence of CS 110 + 1 of Math group CS 110 = 2.
    expect(ucsd?.accepts).toBe(2);
  });
});
