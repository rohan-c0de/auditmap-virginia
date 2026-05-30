import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../transfer", () => ({
  getTransferInfo: vi.fn(),
  getUniversities: vi.fn(),
}));

vi.mock("../validate", () => ({
  courseExists: vi.fn(),
  resolveUniversity: vi.fn(),
}));

import { lookupTransfer } from "../transfer";
import type { TransferIntent } from "../../types";
import { getTransferInfo } from "../../../transfer";
import { courseExists, resolveUniversity } from "../validate";
import type { TransferMapping } from "../../../types";

const mockGetTransferInfo = getTransferInfo as ReturnType<typeof vi.fn>;
const mockCourseExists = courseExists as ReturnType<typeof vi.fn>;
const mockResolveUniversity = resolveUniversity as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGetTransferInfo.mockReset();
  mockCourseExists.mockReset();
  mockResolveUniversity.mockReset();
});

function mapping(partial: Partial<TransferMapping>): TransferMapping {
  return {
    cc_prefix: "ENG",
    cc_number: "111",
    cc_course: "ENG 111",
    cc_title: "Composition I",
    cc_credits: "3",
    university: "gmu",
    university_name: "George Mason University",
    univ_course: "ENGH 101",
    univ_title: "Composition",
    univ_credits: "3",
    notes: "",
    no_credit: false,
    is_elective: false,
    ...partial,
  };
}

const ENG_111_INTENT: TransferIntent = {
  type: "transfer",
  course: { prefix: "ENG", number: "111" },
  subjectPrefix: null,
  university: "gmu",
};

describe("lookupTransfer", () => {
  it("returns NoAnswer when course is missing", async () => {
    const result = await lookupTransfer(
      { type: "transfer", course: null, subjectPrefix: null, university: "gmu" },
      "va",
    );
    expect(result.type).toBe("none");
    if (result.type !== "none") return;
    expect(result.reason).toBe("missing-entity");
  });

  it("returns browse guidance when subjectPrefix set with university", async () => {
    mockResolveUniversity.mockResolvedValue({
      resolved: { slug: "uva", name: "University of Virginia" },
    });
    const result = await lookupTransfer(
      { type: "transfer", course: null, subjectPrefix: "ENG", university: "uva" },
      "va",
    );
    expect(result.type).toBe("none");
    if (result.type !== "none") return;
    expect(result.reason).toBe("missing-entity");
    expect(result.message).toContain("English");
    expect(result.message).toContain("University of Virginia");
  });

  it("returns browse guidance when subjectPrefix set without university", async () => {
    const result = await lookupTransfer(
      { type: "transfer", course: null, subjectPrefix: "MATH", university: null },
      "va",
    );
    expect(result.type).toBe("none");
    if (result.type !== "none") return;
    expect(result.message).toContain("Mathematics");
    expect(result.message).toContain("transfer equivalency");
  });

  it("returns unknown-course when course not in catalog", async () => {
    mockCourseExists.mockResolvedValue({ exists: false });
    const result = await lookupTransfer(ENG_111_INTENT, "va");
    if (result.type !== "transfer") throw new Error("wrong type");
    expect(result.status).toBe("unknown-course");
  });

  it("returns 'no' when course exists but has zero mappings", async () => {
    mockCourseExists.mockResolvedValue({ exists: true });
    mockGetTransferInfo.mockResolvedValue([]);
    const result = await lookupTransfer(ENG_111_INTENT, "va");
    if (result.type !== "transfer") throw new Error("wrong type");
    expect(result.status).toBe("no");
  });

  it("returns 'no-destination' with alternatives when no university specified", async () => {
    mockCourseExists.mockResolvedValue({ exists: true });
    mockGetTransferInfo.mockResolvedValue([
      mapping({ university: "gmu", university_name: "George Mason University" }),
      mapping({ university: "vcu", university_name: "VCU", univ_course: "ENGL 101" }),
      mapping({ university: "vt", university_name: "Virginia Tech", univ_course: "ENGL 1105" }),
    ]);
    const result = await lookupTransfer(
      { type: "transfer", course: { prefix: "ENG", number: "111" }, subjectPrefix: null, university: null },
      "va",
    );
    if (result.type !== "transfer") throw new Error("wrong type");
    expect(result.status).toBe("no-destination");
    expect(result.alternatives?.length).toBe(3);
    expect(result.alternatives?.[0].slug).toBe("gmu");
  });

  it("returns 'unknown-university' with suggestions when slug doesn't resolve", async () => {
    mockCourseExists.mockResolvedValue({ exists: true });
    mockGetTransferInfo.mockResolvedValue([mapping({})]);
    mockResolveUniversity.mockResolvedValue({
      resolved: null,
      suggestions: [{ slug: "gmu", name: "George Mason University" }],
    });
    const result = await lookupTransfer(
      { type: "transfer", course: { prefix: "ENG", number: "111" }, subjectPrefix: null, university: "nonsense" },
      "va",
    );
    if (result.type !== "transfer") throw new Error("wrong type");
    expect(result.status).toBe("unknown-university");
    expect(result.suggestions?.[0].slug).toBe("gmu");
  });

  it("returns 'yes' with equivalency when mapping is full credit", async () => {
    mockCourseExists.mockResolvedValue({ exists: true });
    mockGetTransferInfo.mockResolvedValue([
      mapping({ univ_course: "ENGH 101", is_elective: false, no_credit: false }),
    ]);
    mockResolveUniversity.mockResolvedValue({
      resolved: { slug: "gmu", name: "George Mason University" },
      suggestions: [],
    });
    const result = await lookupTransfer(ENG_111_INTENT, "va");
    if (result.type !== "transfer") throw new Error("wrong type");
    expect(result.status).toBe("yes");
    expect(result.equivalency?.univ_course).toBe("ENGH 101");
    expect(result.university?.slug).toBe("gmu");
  });

  it("returns 'partial' when mapping is is_elective", async () => {
    mockCourseExists.mockResolvedValue({ exists: true });
    mockGetTransferInfo.mockResolvedValue([
      mapping({ is_elective: true, univ_course: "ENGH 1XX" }),
    ]);
    mockResolveUniversity.mockResolvedValue({
      resolved: { slug: "gmu", name: "George Mason University" },
      suggestions: [],
    });
    const result = await lookupTransfer(ENG_111_INTENT, "va");
    if (result.type !== "transfer") throw new Error("wrong type");
    expect(result.status).toBe("partial");
  });

  it("returns 'partial' when mapping is no_credit", async () => {
    mockCourseExists.mockResolvedValue({ exists: true });
    mockGetTransferInfo.mockResolvedValue([mapping({ no_credit: true, univ_course: "" })]);
    mockResolveUniversity.mockResolvedValue({
      resolved: { slug: "gmu", name: "George Mason University" },
      suggestions: [],
    });
    const result = await lookupTransfer(ENG_111_INTENT, "va");
    if (result.type !== "transfer") throw new Error("wrong type");
    expect(result.status).toBe("partial");
  });

  it("returns 'no' with alternatives when destination university has no mapping for this course", async () => {
    mockCourseExists.mockResolvedValue({ exists: true });
    mockGetTransferInfo.mockResolvedValue([
      mapping({ university: "vcu", university_name: "VCU", univ_course: "ENGL 101" }),
    ]);
    mockResolveUniversity.mockResolvedValue({
      resolved: { slug: "gmu", name: "George Mason University" },
      suggestions: [],
    });
    const result = await lookupTransfer(ENG_111_INTENT, "va");
    if (result.type !== "transfer") throw new Error("wrong type");
    expect(result.status).toBe("no");
    expect(result.university?.slug).toBe("gmu");
    expect(result.alternatives?.[0].slug).toBe("vcu");
  });

  it("includes a SourceCitation on every transfer answer", async () => {
    mockCourseExists.mockResolvedValue({ exists: false });
    const result = await lookupTransfer(ENG_111_INTENT, "va");
    if (result.type !== "transfer") throw new Error("wrong type");
    expect(result.source.source).toBe("transfer-equiv");
    expect(result.source.state).toBe("va");
    expect(result.source.reference).toBe("data/va/transfer-equiv.json");
  });

  describe("followups", () => {
    it("suggests prereqs and other-universities followups for 'yes'", async () => {
      mockCourseExists.mockResolvedValue({ exists: true });
      mockGetTransferInfo.mockResolvedValue([mapping({})]);
      mockResolveUniversity.mockResolvedValue({
        resolved: { slug: "gmu", name: "George Mason University" },
        suggestions: [],
      });
      const result = await lookupTransfer(ENG_111_INTENT, "va");
      if (result.type !== "transfer") throw new Error("wrong type");
      expect(result.followups).toContain("What are the prereqs for ENG 111?");
      expect(result.followups).toContain("Does ENG 111 transfer to other universities?");
    });

    it("suggests where-does-it-transfer and prereqs for 'no'", async () => {
      mockCourseExists.mockResolvedValue({ exists: true });
      mockGetTransferInfo.mockResolvedValue([]);
      const result = await lookupTransfer(ENG_111_INTENT, "va");
      if (result.type !== "transfer") throw new Error("wrong type");
      expect(result.followups).toContain("Where does ENG 111 transfer?");
      expect(result.followups).toContain("What are the prereqs for ENG 111?");
    });

    it("generates per-university questions for 'no-destination'", async () => {
      mockCourseExists.mockResolvedValue({ exists: true });
      mockGetTransferInfo.mockResolvedValue([
        mapping({ university: "gmu", university_name: "George Mason University" }),
        mapping({ university: "vcu", university_name: "VCU" }),
      ]);
      const result = await lookupTransfer(
        { type: "transfer", course: { prefix: "ENG", number: "111" }, subjectPrefix: null, university: null },
        "va",
      );
      if (result.type !== "transfer") throw new Error("wrong type");
      expect(result.followups).toContain("Does ENG 111 transfer to George Mason University?");
      expect(result.followups).toContain("Does ENG 111 transfer to VCU?");
    });

    it("suggests a prefix search for 'unknown-course'", async () => {
      mockCourseExists.mockResolvedValue({ exists: false });
      const result = await lookupTransfer(ENG_111_INTENT, "va");
      if (result.type !== "transfer") throw new Error("wrong type");
      expect(result.followups).toContain("Search for ENG courses");
    });
  });
});
