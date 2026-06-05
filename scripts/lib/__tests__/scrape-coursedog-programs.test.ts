import { describe, it, expect } from "vitest";
import {
  isActiveProgramStatus,
  parseFreeformRequisites,
} from "@/scripts/lib/scrape-coursedog-programs";

/**
 * Coursedog tenants store program status with varying casing. The "Active"
 * (capital A) filter sent to the search API returns 0 for tenants that store
 * lowercase "active" (Banner-SQL / some Colleague syncs), so the scraper falls
 * back to an unfiltered fetch and keeps only active programs via this helper.
 * It must accept any casing of "active" (and a missing status) while dropping
 * Inactive / Archived so the fallback never ships retired programs.
 */
describe("isActiveProgramStatus", () => {
  it.each(["active", "Active", "ACTIVE", "  active  "])(
    "keeps active (any casing/whitespace): %s",
    (s) => {
      expect(isActiveProgramStatus(s)).toBe(true);
    },
  );

  it.each([undefined, ""])("keeps missing/blank status: %s", (s) => {
    expect(isActiveProgramStatus(s)).toBe(true);
  });

  it.each(["Inactive", "inactive", "Archived", "archived", "Pending", "Draft"])(
    "drops non-active status: %s",
    (s) => {
      expect(isActiveProgramStatus(s)).toBe(false);
    },
  );
});

/**
 * `parseFreeformRequisites` parses the inline-HTML requirements that
 * `*_colleague_ethos` tenants (cape-fear etc.) emit. The two fixtures below are
 * real cape-fear `requisitesFreeform.value` snippets — one using the nbsp-hyphen
 * code format, one using hyphen-no-space — captured live 2026-06-05.
 */
describe("parseFreeformRequisites", () => {
  it("parses the nbsp-hyphen code format and captures courses + credits", () => {
    const html =
      "<h3>Universal General Education Transfer Component (Credits: 32-33)</h3>" +
      "<p><strong>English </strong> (Take 6 credits)</p>" +
      "<ul>" +
      "<li><p>ENG 111&nbsp;-&nbsp;Writing and Inquiry <strong>Credits:</strong> <strong>3</strong></p></li>" +
      "<li><p>ENG 112&nbsp;-&nbsp;Writing/Research in the Disc <strong>Credits:</strong> <strong>3</strong></p></li>" +
      "</ul>";
    const groups = parseFreeformRequisites(html);
    const courses = groups.flatMap((g) => g.courses);
    expect(courses).toContainEqual(
      expect.objectContaining({ prefix: "ENG", number: "111", credits: 3 }),
    );
    expect(courses).toContainEqual(
      expect.objectContaining({ prefix: "ENG", number: "112" }),
    );
    expect(groups.some((g) => /english/i.test(g.name))).toBe(true);
  });

  it("parses the hyphen-no-space code format", () => {
    const html =
      "<h3><strong>General Education Requirements (46 credits)</strong></h3>" +
      "<p><strong>English</strong> (Take 6 credits)</p>" +
      "<ul>" +
      "<li><p>ENG-111 Writing and Inquiry <strong>Credits: 3</strong></p></li>" +
      "<li><p>COM-231 Public Speaking <strong>Credits: 3</strong></p></li>" +
      "</ul>";
    const courses = parseFreeformRequisites(html).flatMap((g) => g.courses);
    expect(courses.map((c) => `${c.prefix} ${c.number}`)).toEqual(
      expect.arrayContaining(["ENG 111", "COM 231"]),
    );
  });

  it("returns [] for empty or course-less HTML (don't ship empty groups)", () => {
    expect(parseFreeformRequisites("")).toEqual([]);
    expect(
      parseFreeformRequisites(
        "<h3>Program Overview</h3><p>See an advisor for requirements.</p>",
      ),
    ).toEqual([]);
  });

  it("de-dupes a course repeated within a group", () => {
    const html =
      "<p><strong>Core</strong></p><ul>" +
      "<li><p>BIO 110 General Biology <strong>Credits: 4</strong></p></li>" +
      "<li><p>BIO 110 General Biology <strong>Credits: 4</strong></p></li>" +
      "</ul>";
    const courses = parseFreeformRequisites(html).flatMap((g) => g.courses);
    expect(courses.filter((c) => c.prefix === "BIO" && c.number === "110")).toHaveLength(1);
  });
});
