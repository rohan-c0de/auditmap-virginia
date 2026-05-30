import { describe, expect, it, vi } from "vitest";

vi.mock("../validate", () => ({
  resolveUniversity: vi.fn(),
}));

vi.mock("../../../institutions", () => ({
  loadInstitutions: vi.fn(() => []),
}));

vi.mock("../../../programs/requirements", () => ({
  loadCollegePrograms: vi.fn(async () => []),
  loadProgramAcrossColleges: vi.fn(async () => []),
  findRelatedPrograms: vi.fn(async () => []),
  stateHasProgramData: vi.fn(() => false),
  loadProgramsByTitles: vi.fn(async () => []),
}));

vi.mock("../../../programs/matcher", () => ({
  matchProgramSlug: vi.fn(() => null),
}));

vi.mock("../../../programs/semantic-resolve", () => ({
  semanticResolveMajor: vi.fn(async () => null),
}));

vi.mock("../../../programs/subject-vocab", () => ({
  summariseSubjectsByPrefix: vi.fn(() => []),
}));

import { lookupPathway } from "../pathway";
import { resolveUniversity } from "../validate";
import {
  loadProgramAcrossColleges,
  findRelatedPrograms,
  stateHasProgramData,
  loadProgramsByTitles,
} from "../../../programs/requirements";
import { semanticResolveMajor } from "../../../programs/semantic-resolve";
import { summariseSubjectsByPrefix } from "../../../programs/subject-vocab";

const resolveMock = vi.mocked(resolveUniversity);
const loadProgramsMock = vi.mocked(loadProgramAcrossColleges);
const findRelatedMock = vi.mocked(findRelatedPrograms);
const stateHasDataMock = vi.mocked(stateHasProgramData);
const loadByTitlesMock = vi.mocked(loadProgramsByTitles);
const semanticResolveMock = vi.mocked(semanticResolveMajor);
const summariseSubjectsMock = vi.mocked(summariseSubjectsByPrefix);

describe("lookupPathway", () => {
  it("looks up degree by major when no university or college specified", async () => {
    loadProgramsMock.mockResolvedValue([]);
    const result = await lookupPathway(
      { type: "pathway", university: null, major: "nursing", college: null, credential: null },
      "va",
    );
    expect(result.type).toBe("pathway");
    if (result.type !== "pathway") return;
    expect(result.status).toBe("no-data");
  });

  it("returns missing-entity when nothing specified", async () => {
    const result = await lookupPathway(
      { type: "pathway", university: null, major: null, college: null, credential: null },
      "va",
    );
    expect(result.type).toBe("pathway");
    if (result.type !== "pathway") return;
    expect(result.status).toBe("missing-entity");
  });

  it("returns unknown-university when resolution fails", async () => {
    resolveMock.mockResolvedValue({ resolved: null, suggestions: [] });
    const result = await lookupPathway(
      { type: "pathway", university: "fake-u", major: null, college: null, credential: null },
      "va",
    );
    expect(result.type).toBe("pathway");
    if (result.type !== "pathway") return;
    expect(result.status).toBe("unknown-university");
  });

  it("returns no-data with resolved university when university is valid", async () => {
    resolveMock.mockResolvedValue({
      resolved: { slug: "gmu", name: "George Mason University" },
      suggestions: [],
    });
    const result = await lookupPathway(
      { type: "pathway", university: "gmu", major: "computer-science", college: null, credential: null },
      "va",
    );
    expect(result.type).toBe("pathway");
    if (result.type !== "pathway") return;
    expect(result.status).toBe("no-data");
    expect(result.university).toEqual({ slug: "gmu", name: "George Mason University" });
    expect(result.major).toBe("computer-science");
    expect(result.followups).toBeDefined();
    expect(result.followups!.length).toBeGreaterThan(0);
  });

  it("returns found-related when no exact slug match but state has related programs", async () => {
    loadProgramsMock.mockResolvedValue([]);
    stateHasDataMock.mockReturnValue(true);
    findRelatedMock.mockResolvedValue([
      {
        college: {
          id: "ccv",
          name: "Community College of Vermont",
          college_slug: "ccv",
          system: "VSC",
          campuses: [],
          audit_policy: {
            allowed: true,
            cost_model: "free_for_seniors",
            cost_note: "",
            eligibility: { minimum_age: 18, residency_required: false },
            restrictions: [],
            application_process: {
              steps: [],
              timing: "",
              form_url: "",
              contact_email: "",
              contact_phone: "",
            },
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        programs: [
          {
            title: "Behavioral Science (A.S.)",
            credential: "AS" as const,
            program_code: null,
            catalog_url: "https://example.com/behavioral-science",
            total_credits: 60,
            gpa_minimum: 2.0,
            description: null,
            requirement_groups: [],
            matched_program_slug: null,
          },
        ],
      },
    ]);
    const result = await lookupPathway(
      { type: "pathway", university: null, major: "biology", college: null, credential: null },
      "vt",
    );
    if (result.type !== "pathway") return;
    expect(result.status).toBe("found-related");
    expect(result.degreeRequirements?.length).toBe(1);
    expect(result.degreeRequirements?.[0].title).toContain("Behavioral Science");
  });

  it("falls back to no-data when state has no program data at all", async () => {
    loadProgramsMock.mockResolvedValue([]);
    stateHasDataMock.mockReturnValue(false);
    findRelatedMock.mockResolvedValue([]);
    const result = await lookupPathway(
      { type: "pathway", university: null, major: "biology", college: null, credential: null },
      "ks",
    );
    if (result.type !== "pathway") return;
    expect(result.status).toBe("no-data");
  });

  it("phase 3: invokes semantic resolver when stems return nothing, hydrates titles", async () => {
    loadProgramsMock.mockResolvedValue([]);
    stateHasDataMock.mockReturnValue(true);
    findRelatedMock.mockResolvedValue([]); // lexical layer misses

    semanticResolveMock.mockResolvedValue({
      programTitles: ["Health Science (A.S.)"],
      subjectPrefixes: ["BIO", "HLT"],
      rationale: "premed students typically take Biology and Health Science.",
      source: "llm",
    });

    loadByTitlesMock.mockResolvedValue([
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        college: { id: "ccv", name: "Community College of Vermont" } as any,
        programs: [
          {
            title: "Health Science (A.S.)",
            credential: "AS" as const,
            program_code: null,
            catalog_url: "https://example.com/health-sci",
            total_credits: 60,
            gpa_minimum: 2.0,
            description: null,
            requirement_groups: [],
            matched_program_slug: null,
          },
        ],
      },
    ]);

    const result = await lookupPathway(
      { type: "pathway", university: null, major: "premed", college: null, credential: null },
      "vt",
    );
    if (result.type !== "pathway") return;
    expect(result.status).toBe("found-related");
    expect(result.degreeRequirements?.length).toBe(1);
    expect(result.degreeRequirements?.[0].title).toContain("Health Science");
    // Sanity-check: semantic resolver was actually called
    expect(semanticResolveMock).toHaveBeenCalledWith("vt", "premed");
  });

  it("phase 3: lexical hit short-circuits — semantic resolver NOT called", async () => {
    loadProgramsMock.mockResolvedValue([]);
    stateHasDataMock.mockReturnValue(true);
    findRelatedMock.mockResolvedValue([
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        college: { id: "nova", name: "NOVA" } as any,
        programs: [
          {
            title: "Geographic Information Systems",
            credential: "certificate" as const,
            program_code: null,
            catalog_url: "",
            total_credits: 30,
            gpa_minimum: 2.0,
            description: null,
            requirement_groups: [],
            matched_program_slug: null,
          },
        ],
      },
    ]);
    semanticResolveMock.mockClear();

    const result = await lookupPathway(
      { type: "pathway", university: null, major: "geography", college: null, credential: null },
      "va",
    );
    if (result.type !== "pathway") return;
    expect(result.status).toBe("found-related");
    expect(semanticResolveMock).not.toHaveBeenCalled();
  });

  it("phase 3: semantic resolver throwing falls through to no-data, request not broken", async () => {
    loadProgramsMock.mockResolvedValue([]);
    stateHasDataMock.mockReturnValue(true);
    findRelatedMock.mockResolvedValue([]);
    semanticResolveMock.mockRejectedValue(new Error("classifier offline"));
    loadByTitlesMock.mockResolvedValue([]);

    const result = await lookupPathway(
      { type: "pathway", university: null, major: "premed", college: null, credential: null },
      "vt",
    );
    if (result.type !== "pathway") return;
    expect(result.status).toBe("no-data");
  });

  // ---- #265: lexical-noise re-rank via LLM ---------------------------------

  it("phase 3b: when lexical returns ≥4 hits, LLM refines and replaces", async () => {
    loadProgramsMock.mockResolvedValue([]);
    stateHasDataMock.mockReturnValue(true);

    // Lexical returns 6 noisy "Medical Coding" hits — promiscuous match
    // because "coding" stem hit a broad family.
    const noisyLexical = Array.from({ length: 6 }, (_, i) => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      college: { id: `c${i}`, name: `College ${i}` } as any,
      programs: [
        {
          title: `Medical Coding ${i}`,
          credential: "certificate" as const,
          program_code: null,
          catalog_url: "",
          total_credits: 30,
          gpa_minimum: 2.0,
          description: null,
          requirement_groups: [],
          matched_program_slug: null,
        },
      ],
    }));
    findRelatedMock.mockResolvedValue(noisyLexical);

    // LLM returns the actually-relevant programs (different titles than lexical)
    semanticResolveMock.mockResolvedValue({
      programTitles: ["Computer Science Transfer", "Information Technology"],
      subjectPrefixes: ["CSC", "ITP"],
      rationale: "coding = software / programming, not medical billing.",
      source: "llm",
    });
    loadByTitlesMock.mockResolvedValue([
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        college: { id: "nova", name: "NOVA" } as any,
        programs: [
          {
            title: "Computer Science Transfer",
            credential: "AS" as const,
            program_code: null,
            catalog_url: "",
            total_credits: 60,
            gpa_minimum: 2.0,
            description: null,
            requirement_groups: [],
            matched_program_slug: null,
          },
        ],
      },
    ]);

    const result = await lookupPathway(
      { type: "pathway", university: null, major: "coding", college: null, credential: null },
      "va",
    );
    if (result.type !== "pathway") return;
    expect(result.status).toBe("found-related");
    expect(semanticResolveMock).toHaveBeenCalledWith("va", "coding");
    // Refined result should be the LLM's pick, not the noisy lexical pool.
    expect(result.degreeRequirements?.length).toBe(1);
    expect(result.degreeRequirements?.[0].title).toContain(
      "Computer Science Transfer",
    );
  });

  it("phase 3b: ≥4 lexical hits + LLM returns nothing → keep lexical", async () => {
    loadProgramsMock.mockResolvedValue([]);
    stateHasDataMock.mockReturnValue(true);

    const lexical = Array.from({ length: 5 }, (_, i) => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      college: { id: `c${i}`, name: `College ${i}` } as any,
      programs: [
        {
          title: `History Major ${i}`,
          credential: "AA" as const,
          program_code: null,
          catalog_url: "",
          total_credits: 60,
          gpa_minimum: 2.0,
          description: null,
          requirement_groups: [],
          matched_program_slug: null,
        },
      ],
    }));
    findRelatedMock.mockResolvedValue(lexical);

    // LLM has nothing more relevant to add — empty programTitles.
    semanticResolveMock.mockResolvedValue({
      programTitles: [],
      subjectPrefixes: [],
      rationale: "lexical was already correct.",
      source: "llm",
    });
    loadByTitlesMock.mockResolvedValue([]);

    const result = await lookupPathway(
      { type: "pathway", university: null, major: "history", college: null, credential: null },
      "va",
    );
    if (result.type !== "pathway") return;
    expect(result.status).toBe("found-related");
    // We KEEP the lexical pool unchanged.
    expect(result.degreeRequirements?.length).toBe(5);
  });

  it("phase 3b: ≥4 lexical hits + LLM throws → keep lexical, request not broken", async () => {
    loadProgramsMock.mockResolvedValue([]);
    stateHasDataMock.mockReturnValue(true);

    const lexical = Array.from({ length: 4 }, (_, i) => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      college: { id: `c${i}`, name: `College ${i}` } as any,
      programs: [
        {
          title: `Whatever ${i}`,
          credential: "AS" as const,
          program_code: null,
          catalog_url: "",
          total_credits: 60,
          gpa_minimum: 2.0,
          description: null,
          requirement_groups: [],
          matched_program_slug: null,
        },
      ],
    }));
    findRelatedMock.mockResolvedValue(lexical);
    semanticResolveMock.mockRejectedValue(new Error("classifier down"));

    const result = await lookupPathway(
      { type: "pathway", university: null, major: "anything", college: null, credential: null },
      "va",
    );
    if (result.type !== "pathway") return;
    expect(result.status).toBe("found-related");
    expect(result.degreeRequirements?.length).toBe(4);
  });

  it("phase 3b: lexical 1–3 hits stays below threshold — LLM NOT called", async () => {
    loadProgramsMock.mockResolvedValue([]);
    stateHasDataMock.mockReturnValue(true);
    semanticResolveMock.mockClear();

    const lexical = Array.from({ length: 3 }, (_, i) => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      college: { id: `c${i}`, name: `College ${i}` } as any,
      programs: [
        {
          title: `Geographic Info Systems ${i}`,
          credential: "certificate" as const,
          program_code: null,
          catalog_url: "",
          total_credits: 30,
          gpa_minimum: 2.0,
          description: null,
          requirement_groups: [],
          matched_program_slug: null,
        },
      ],
    }));
    findRelatedMock.mockResolvedValue(lexical);

    const result = await lookupPathway(
      { type: "pathway", university: null, major: "geography", college: null, credential: null },
      "va",
    );
    if (result.type !== "pathway") return;
    expect(result.status).toBe("found-related");
    expect(result.degreeRequirements?.length).toBe(3);
    expect(semanticResolveMock).not.toHaveBeenCalled();
  });

  it("includes major-specific followup when major is present", async () => {
    resolveMock.mockResolvedValue({
      resolved: { slug: "vcu", name: "Virginia Commonwealth University" },
      suggestions: [],
    });
    const result = await lookupPathway(
      { type: "pathway", university: "vcu", major: "nursing", college: null, credential: null },
      "va",
    );
    if (result.type !== "pathway") return;
    expect(result.followups!.some((f) => f.toLowerCase().includes("nursing"))).toBe(true);
  });

  // ---- course-pivot: surface subjectPrefixes from semantic resolver ---------

  it("course pivot: when LLM returns subjects but no programs, status=found-courses-only", async () => {
    loadProgramsMock.mockResolvedValue([]);
    stateHasDataMock.mockReturnValue(true);
    findRelatedMock.mockResolvedValue([]);

    semanticResolveMock.mockResolvedValue({
      programTitles: [], // no degree match
      subjectPrefixes: ["GEO", "GIS"], // but courses exist
      rationale: "no Geography degree, but GEO and GIS courses are taught.",
      source: "llm",
    });
    summariseSubjectsMock.mockReturnValue([
      {
        prefix: "GEO",
        name: "Geography",
        course_count: 7,
        section_count: 130,
        college_count: 23,
        search_url: "/va/courses?q=GEO",
      },
      {
        prefix: "GIS",
        name: "Geographic Information Systems",
        course_count: 5,
        section_count: 12,
        college_count: 6,
        search_url: "/va/courses?q=GIS",
      },
    ]);

    const result = await lookupPathway(
      { type: "pathway", university: null, major: "geography", college: null, credential: null },
      "va",
    );
    if (result.type !== "pathway") return;
    expect(result.status).toBe("found-courses-only");
    expect(result.relatedSubjects?.length).toBe(2);
    expect(result.relatedSubjects?.[0].prefix).toBe("GEO");
    expect(result.relatedSubjects?.[0].search_url).toBe("/va/courses?q=GEO");
    expect(result.degreeRequirements).toBeUndefined();
  });

  it("course pivot: found-related ALSO carries relatedSubjects when LLM returns both", async () => {
    loadProgramsMock.mockResolvedValue([]);
    stateHasDataMock.mockReturnValue(true);
    findRelatedMock.mockResolvedValue([]);

    semanticResolveMock.mockResolvedValue({
      programTitles: ["Health Science (A.S.)"],
      subjectPrefixes: ["BIO", "HLT"],
      rationale: "premed = bio + health.",
      source: "llm",
    });
    loadByTitlesMock.mockResolvedValue([
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        college: { id: "ccv", name: "Community College of Vermont" } as any,
        programs: [
          {
            title: "Health Science (A.S.)",
            credential: "AS" as const,
            program_code: null,
            catalog_url: "",
            total_credits: 60,
            gpa_minimum: 2.0,
            description: null,
            requirement_groups: [],
            matched_program_slug: null,
          },
        ],
      },
    ]);
    summariseSubjectsMock.mockReturnValue([
      {
        prefix: "BIO",
        name: "Biology",
        course_count: 8,
        section_count: 50,
        college_count: 1,
        search_url: "/vt/courses?q=BIO",
      },
    ]);

    const result = await lookupPathway(
      { type: "pathway", university: null, major: "premed", college: null, credential: null },
      "vt",
    );
    if (result.type !== "pathway") return;
    expect(result.status).toBe("found-related");
    expect(result.degreeRequirements?.length).toBe(1);
    expect(result.relatedSubjects?.length).toBe(1);
    expect(result.relatedSubjects?.[0].prefix).toBe("BIO");
  });

  it("course pivot: no programs AND no subjects → still no-data", async () => {
    loadProgramsMock.mockResolvedValue([]);
    stateHasDataMock.mockReturnValue(true);
    findRelatedMock.mockResolvedValue([]);
    semanticResolveMock.mockResolvedValue({
      programTitles: [],
      subjectPrefixes: [],
      rationale: "nothing matches.",
      source: "llm",
    });
    summariseSubjectsMock.mockReturnValue([]);

    const result = await lookupPathway(
      { type: "pathway", university: null, major: "underwater-basketweaving", college: null, credential: null },
      "vt",
    );
    if (result.type !== "pathway") return;
    expect(result.status).toBe("no-data");
  });
});
