/**
 * Unit tests for ASSIST.org articulation v2 parser
 *
 * Tests all 50 fixtures from scripts/ca/fixtures/articulation/
 * Validates roundtrip correctness and specific type handling.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  parseAssistArticulation,
  ArticulationAgreement,
  ArticulationRequirement,
} from "../parse-assist-articulation";

// ============================================================================
// Test setup: load all 50 fixtures
// ============================================================================

interface FixtureMetadata {
  ccSlug: string;
  uniSlug: string;
  majorLabel: string;
  agreementKey: string;
  filename: string;
}

type FixtureData = { result: { articulations: string } };
const fixtures: Array<{ metadata: FixtureMetadata; data: FixtureData }> = [];

beforeAll(() => {
  const fixtureDir = path.join(__dirname, "../fixtures/articulation");
  const indexPath = path.join(fixtureDir, "_index.json");

  if (!fs.existsSync(indexPath)) {
    throw new Error(`Fixture index not found at ${indexPath}`);
  }

  const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));

  // Load all 50 fixture files (skip _index.json)
  for (const fixture of index.fixtures) {
    const filePath = path.join(fixtureDir, fixture.filename);
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    fixtures.push({
      metadata: {
        ccSlug: fixture.ccSlug,
        uniSlug: fixture.uniSlug,
        majorLabel: fixture.majorLabel,
        agreementKey: fixture.agreementKey,
        filename: fixture.filename,
      },
      data,
    });
  }
});

// ============================================================================
// Core roundtrip test: all 50 fixtures parse without error
// ============================================================================

describe("parseAssistArticulation", () => {
  it("should parse all 50 fixtures without throwing", () => {
    for (const { metadata, data } of fixtures) {
      try {
        parseAssistArticulation(data, metadata.ccSlug, metadata.uniSlug, metadata.agreementKey);
      } catch (e) {
        throw new Error(`Failed on fixture ${metadata.filename}: ${(e as Error).message}`);
      }
    }
  });

  // =========================================================================
  // Structural invariants: valid output shape across all fixtures
  // =========================================================================

  it("should produce ArticulationAgreement with >=1 requirement groups", () => {
    for (const { metadata, data } of fixtures) {
      const parsed = parseAssistArticulation(
        data,
        metadata.ccSlug,
        metadata.uniSlug,
        metadata.agreementKey
      );

      expect(parsed.requirement_groups.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("should produce requirement groups (may contain zero requirements in edge cases)", () => {
    for (const { metadata, data } of fixtures) {
      const parsed = parseAssistArticulation(
        data,
        metadata.ccSlug,
        metadata.uniSlug,
        metadata.agreementKey
      );

      // All requirement groups should be arrays (edge case: zero requirements is OK)
      for (const group of parsed.requirement_groups) {
        expect(Array.isArray(group.requirements)).toBe(true);
      }
    }
  });

  it("should populate ArticulationRequirement correctly based on type", () => {
    for (const { metadata, data } of fixtures) {
      const parsed = parseAssistArticulation(
        data,
        metadata.ccSlug,
        metadata.uniSlug,
        metadata.agreementKey
      );

      for (const group of parsed.requirement_groups) {
        for (const req of group.requirements) {
          // Course and Series types should have receiving_courses
          if (req.receiving_type === "course" || req.receiving_type === "series") {
            expect(req.receiving_courses.length).toBeGreaterThanOrEqual(1);
          }

          // Named and GE types have empty receiving_courses by design
          if (req.receiving_type === "named" || req.receiving_type === "ge_area") {
            expect(req.receiving_courses.length).toBe(0);
          }

          // Either have sending options OR have a no_articulation_reason
          const hasSending = req.sending.length > 0;
          const hasNoArticulation = req.no_articulation_reason !== null;
          expect(hasSending || hasNoArticulation).toBe(true);
        }
      }
    }
  });

  // =========================================================================
  // Type-specific tests
  // =========================================================================

  it("should correctly parse Series type with receiving_type='series' and course array", () => {
    // Find a fixture with at least one Series articulation
    let found = false;

    for (const { metadata, data } of fixtures) {
      const articulations = JSON.parse(data.result.articulations);
      if (articulations.some((a: { articulation: { type?: string; sendingArticulation?: { items?: Array<{ courseConjunction?: string }> } } }) => a.articulation.type === "Series")) {
        found = true;

        const parsed = parseAssistArticulation(
          data,
          metadata.ccSlug,
          metadata.uniSlug,
          metadata.agreementKey
        );

        // Check that at least one requirement is a series
        let hasSeriesRequirement = false;
        for (const group of parsed.requirement_groups) {
          for (const req of group.requirements) {
            if (req.receiving_type === "series") {
              hasSeriesRequirement = true;
              // Series should have multiple courses (name is "X, Y")
              expect(req.receiving_courses.length).toBeGreaterThanOrEqual(1);
              expect(req.receiving_label).toMatch(/,/); // Multiple courses in name
            }
          }
        }

        expect(hasSeriesRequirement).toBe(true);
        break;
      }
    }

    expect(found).toBe(true);
  });

  it("should correctly parse Requirement type with receiving_type='named'", () => {
    // Find a fixture with at least one Requirement articulation
    let found = false;

    for (const { metadata, data } of fixtures) {
      const articulations = JSON.parse(data.result.articulations);
      if (articulations.some((a: { articulation: { type?: string; sendingArticulation?: { items?: Array<{ courseConjunction?: string }> } } }) => a.articulation.type === "Requirement")) {
        found = true;

        const parsed = parseAssistArticulation(
          data,
          metadata.ccSlug,
          metadata.uniSlug,
          metadata.agreementKey
        );

        // Check that at least one requirement is a named requirement
        let hasNamedRequirement = false;
        for (const group of parsed.requirement_groups) {
          for (const req of group.requirements) {
            if (req.receiving_type === "named") {
              hasNamedRequirement = true;
              // Named requirements have empty receiving_courses
              expect(req.receiving_courses.length).toBe(0);
              // But must have a receiving_label
              expect(req.receiving_label.length).toBeGreaterThan(0);
            }
          }
        }

        expect(hasNamedRequirement).toBe(true);
        break;
      }
    }

    expect(found).toBe(true);
  });

  it("should correctly parse OR logic in sending side (courseConjunction='Or')", () => {
    // Find a fixture with OR logic
    let found = false;

    for (const { metadata, data } of fixtures) {
      const articulations = JSON.parse(data.result.articulations);
      const hasOr = articulations.some((a: { articulation: { type?: string; sendingArticulation?: { items?: Array<{ courseConjunction?: string }> } } }) => {
        return a.articulation.sendingArticulation?.items?.some((item) => item.courseConjunction === "Or") ?? false;
      });

      if (hasOr) {
        found = true;

        const parsed = parseAssistArticulation(
          data,
          metadata.ccSlug,
          metadata.uniSlug,
          metadata.agreementKey
        );

        // Check that at least one sending option has "or"
        let hasOrLogic = false;
        for (const group of parsed.requirement_groups) {
          for (const req of group.requirements) {
            for (const option of req.sending) {
              if (option.conjunction === "or") {
                hasOrLogic = true;
              }
            }
          }
        }

        expect(hasOrLogic).toBe(true);
        break;
      }
    }

    expect(found).toBe(true);
  });

  // =========================================================================
  // Output property validation
  // =========================================================================

  it("should populate all top-level ArticulationAgreement fields", () => {
    for (const { metadata, data } of fixtures) {
      const parsed = parseAssistArticulation(
        data,
        metadata.ccSlug,
        metadata.uniSlug,
        metadata.agreementKey
      );

      expect(parsed.cc_slug).toBe(metadata.ccSlug);
      expect(parsed.university_slug).toBe(metadata.uniSlug);
      expect(parsed.major_label).toBe(metadata.majorLabel);
      expect(parsed.agreement_key).toBe(metadata.agreementKey);
      expect(parsed.academic_year).toMatch(/^\d{4}-\d{4}$/); // YYYY-YYYY format
      expect(parsed.publish_date).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601
      expect(["Semester", "Quarter"]).toContain(parsed.receiving_termtype);
    }
  });

  it("should populate SimpleCourse fields correctly", () => {
    for (const { metadata, data } of fixtures) {
      const parsed = parseAssistArticulation(
        data,
        metadata.ccSlug,
        metadata.uniSlug,
        metadata.agreementKey
      );

      for (const group of parsed.requirement_groups) {
        for (const req of group.requirements) {
          for (const course of req.receiving_courses) {
            expect(course.prefix).toBeTruthy();
            expect(course.number).toBeTruthy();
            expect(course.title).toBeTruthy();
            expect(course.min_units).toBeGreaterThanOrEqual(0);
            expect(course.max_units).toBeGreaterThanOrEqual(course.min_units);
          }

          for (const option of req.sending) {
            for (const course of option.courses) {
              expect(course.prefix).toBeTruthy();
              expect(course.number).toBeTruthy();
              expect(course.title).toBeTruthy();
              expect(course.min_units).toBeGreaterThanOrEqual(0);
              expect(course.max_units).toBeGreaterThanOrEqual(course.min_units);
            }
          }
        }
      }
    }
  });

  it("should map instruction types correctly", () => {
    for (const { metadata, data } of fixtures) {
      const parsed = parseAssistArticulation(
        data,
        metadata.ccSlug,
        metadata.uniSlug,
        metadata.agreementKey
      );

      for (const group of parsed.requirement_groups) {
        if (group.instruction !== null) {
          const validInstructions = [
            "complete-all",
            "select-one",
            "n-from-area",
            "n-from-conjunction",
            "n-from-following",
          ];
          expect(validInstructions).toContain(group.instruction);

          // If n-from-*, should have n value
          if (group.instruction.startsWith("n-from-")) {
            expect(group.n).toBeDefined();
            expect(group.n).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });

  // =========================================================================
  // Edge case: no-articulation handling
  // =========================================================================

  it("should handle no-articulation cases correctly", () => {
    for (const { metadata, data } of fixtures) {
      const parsed = parseAssistArticulation(
        data,
        metadata.ccSlug,
        metadata.uniSlug,
        metadata.agreementKey
      );

      for (const group of parsed.requirement_groups) {
        for (const req of group.requirements) {
          if (req.no_articulation_reason !== null) {
            // No articulation: sending should be empty
            expect(req.sending.length).toBe(0);
            // Reason should be one of the two allowed values
            expect(["no-course-articulated", "post-transfer-only"]).toContain(
              req.no_articulation_reason
            );
          }
        }
      }
    }
  });
});
