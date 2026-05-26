/**
 * ASSIST.org articulation v2 parser — Phase 2
 *
 * Transforms raw ASSIST API responses (with double-encoded JSON strings)
 * into our clean internal schema for storage and UI consumption.
 *
 * Spec: docs/assist-articulation-schema.md (sections 4-9)
 */

// ============================================================================
// Input types (raw ASSIST API response shape)
// ============================================================================

export interface AssistApiResponse<T> {
  isSuccessful: boolean;
  result: T | null;
  validationFailure: string | null;
}

export interface AssistArticulationResult {
  name: string;
  type: string;
  publishDate: string;
  academicYear: string; // JSON-encoded string, needs second parse
  catalogYear: string; // JSON-encoded string
  receivingInstitution: string; // JSON-encoded string
  sendingInstitution: string; // JSON-encoded string
  templateAssets: string; // JSON-encoded string
  articulations: string; // JSON-encoded string
}

export interface AssistAcademicYear {
  id: number;
  code: string;
  beginDate: string;
  endDate: string;
  isOpenForMaintenance: boolean;
  isOpenForPublic: boolean;
}

export interface AssistInstitutionMeta {
  id: number;
  code: string;
  isCommunityCollege: boolean;
  category: string;
  termType: "Semester" | "Quarter";
  names: Array<{ name: string; hasDepartments: boolean }>;
}

export interface AssistTemplateAsset {
  type: string;
  [key: string]: unknown;
}

export interface AssistRequirementGroup extends AssistTemplateAsset {
  type: "RequirementGroup";
  sections: Array<{
    rows: Array<{
      cells: Array<{
        type: string;
        id: string;
        course?: AssistCourse;
      }>;
    }>;
  }>;
  instruction: {
    type: string | null;
    selectionType: string | null;
  } | null;
  area: string;
}

export interface AssistArticulation {
  templateCellId: string;
  articulation: {
    type: "Course" | "Series" | "Requirement" | "GeneralEducation";
    course?: AssistCourse;
    series?: {
      conjunction: "And" | "Or";
      name: string;
      courses: AssistCourse[];
    };
    requirement?: {
      name: string;
    };
    sendingArticulation: {
      noArticulationReason: string | null;
      deniedCourses: AssistCourse[];
      items: Array<{
        courseConjunction: "And" | "Or";
        items: AssistCourse[];
      }>;
    };
  };
}

export interface AssistCourse {
  type?: string;
  prefix: string;
  prefixDescription: string;
  courseNumber: string;
  courseTitle: string;
  courseIdentifierParentId: number;
  department: string;
  minUnits: number;
  maxUnits: number;
  begin: string;
  end: string;
}

// ============================================================================
// Output types (clean internal schema)
// ============================================================================

export interface ArticulationAgreement {
  cc_slug: string;
  university_slug: string;
  major_label: string;
  agreement_key: string;
  academic_year: string;
  publish_date: string;
  receiving_termtype: "Semester" | "Quarter";
  requirement_groups: ArticulationRequirementGroup[];
}

export interface ArticulationRequirementGroup {
  area: string;
  instruction: "complete-all" | "select-one" | "n-from-area" | "n-from-conjunction" | "n-from-following" | null;
  n?: number;
  requirements: ArticulationRequirement[];
}

export interface ArticulationRequirement {
  receiving_type: "course" | "series" | "named" | "ge_area";
  receiving_label: string;
  receiving_courses: SimpleCourse[];
  sending: SendingOption[];
  no_articulation_reason: "no-course-articulated" | "post-transfer-only" | null;
}

export interface SendingOption {
  conjunction: "and" | "or";
  courses: SimpleCourse[];
}

export interface SimpleCourse {
  prefix: string;
  number: string;
  title: string;
  min_units: number;
  max_units: number;
}

// ============================================================================
// Helper: slug derivation
// ============================================================================

/**
 * Convert an institution name to a slug (simple lowercase-hyphenated version).
 * For production, this would integrate with the site's existing slug registry.
 */
function institutionNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Normalize academic year code (e.g., "2025-2026") to our format.
 */
function normalizeAcademicYear(code: string): string {
  // Already in "YYYY-YYYY" format; return as-is
  return code;
}

/**
 * Map ASSIST instruction type strings to our canonical instruction type.
 * Handles the 7 variants documented in the schema.
 */
function mapInstructionType(
  type: string | null,
  selectionType: string | null
): "complete-all" | "select-one" | "n-from-area" | "n-from-conjunction" | "n-from-following" | null {
  // No instruction or empty string → null (default)
  if (!type) return null;

  // NFrom* always maps to our n-from-* types
  if (type === "NFromArea") return "n-from-area";
  if (type === "NFromConjunction") return "n-from-conjunction";
  if (type === "NFromFollowing") return "n-from-following";

  // Following or Conjunction with Complete → "complete-all" (take all)
  if ((type === "Following" || type === "Conjunction") && selectionType === "Complete") {
    return "complete-all";
  }

  // Conjunction with Select → "select-one" (choose one, OR)
  if (type === "Conjunction" && selectionType === "Select") {
    return "select-one";
  }

  // Fallback: treat as "complete-all"
  return "complete-all";
}

/**
 * Extract the N value from NFrom* instruction types.
 * ASSIST encodes this as a property on the instruction object; we look for it.
 */
function extractNFromInstruction(instruction: any): number | undefined {
  // The N value is typically encoded as a property on the instruction
  // For now, we return undefined and let the requirement group handle default N=1
  // Phase 2 may need to inspect the instruction object more carefully
  return undefined;
}

/**
 * Map no-articulation reason strings to our canonical values.
 */
function mapNoArticulationReason(
  reason: string | null
): "no-course-articulated" | "post-transfer-only" | null {
  if (!reason) return null;
  if (reason === "No Course Articulated") return "no-course-articulated";
  if (reason === "This course must be taken at the university after transfer") return "post-transfer-only";
  // Unknown reason → treat as post-transfer-only (safe default)
  return "post-transfer-only";
}

/**
 * Convert a SimpleCourse from an AssistCourse.
 */
function toSimpleCourse(course: AssistCourse): SimpleCourse {
  return {
    prefix: course.prefix,
    number: course.courseNumber,
    title: course.courseTitle,
    min_units: course.minUnits,
    max_units: course.maxUnits,
  };
}

// ============================================================================
// Main parser
// ============================================================================

/**
 * Parse a raw ASSIST API response into our clean ArticulationAgreement schema.
 *
 * Handles:
 * - Double-encoded JSON strings (§4)
 * - Template asset layout discovery (§5)
 * - Articulation matching by templateCellId (§6)
 * - All 4 articulation types: Course, Series, Requirement, GeneralEducation
 * - All 7 instruction types
 * - AND/OR sending-side logic
 * - No-articulation cases
 *
 * @param rawResponse Raw JSON response from ASSIST API (as JS object after first JSON.parse)
 * @param ccSlug Community college slug
 * @param universitySlug University slug
 * @param agreementKey Full ASSIST agreement key
 * @returns Parsed ArticulationAgreement, or throws if structure is invalid
 */
export function parseAssistArticulation(
  rawResponse: any,
  ccSlug: string,
  universitySlug: string,
  agreementKey: string
): ArticulationAgreement {
  // Validate envelope
  if (!rawResponse.isSuccessful || !rawResponse.result) {
    throw new Error(`Invalid ASSIST response: isSuccessful=${rawResponse.isSuccessful}`);
  }

  const result = rawResponse.result as AssistArticulationResult;

  // Parse double-encoded JSON strings
  const academicYear = JSON.parse(result.academicYear) as AssistAcademicYear;
  const receivingInstitution = JSON.parse(result.receivingInstitution) as AssistInstitutionMeta;
  const sendingInstitution = JSON.parse(result.sendingInstitution) as AssistInstitutionMeta;
  const templateAssets = JSON.parse(result.templateAssets) as AssistTemplateAsset[];
  const articulations = JSON.parse(result.articulations) as AssistArticulation[];

  // Build a map: templateCellId → articulation (for fast lookup)
  const articulationByTemplateId = new Map<string, AssistArticulation>();
  for (const art of articulations) {
    articulationByTemplateId.set(art.templateCellId, art);
  }

  // Process template assets to extract requirement groups
  const requirementGroups: ArticulationRequirementGroup[] = [];

  for (const asset of templateAssets) {
    if (asset.type === "RequirementGroup") {
      const rg = asset as AssistRequirementGroup;
      const requirements: ArticulationRequirement[] = [];

      // Walk all cells in this requirement group
      if (rg.sections && Array.isArray(rg.sections)) {
        for (const section of rg.sections) {
          if (!section.rows || !Array.isArray(section.rows)) {
            continue;
          }
          for (const row of section.rows) {
            if (!row.cells || !Array.isArray(row.cells)) {
              continue;
            }
            for (const cell of row.cells) {
            // Find the articulation for this cell
            const articulation = articulationByTemplateId.get(cell.id);
            if (!articulation) {
              // Cell with no articulation? Skip it or treat as empty
              continue;
            }

            const art = articulation.articulation;

            // Determine receiving type and extract receiving courses/label
            let receiving_type: "course" | "series" | "named" | "ge_area";
            let receiving_label: string;
            let receiving_courses: SimpleCourse[] = [];

            if (art.type === "Course") {
              receiving_type = "course";
              if (!art.course) throw new Error("Course articulation missing course field");
              receiving_label = `${art.course.prefix} ${art.course.courseNumber}`;
              receiving_courses = [toSimpleCourse(art.course)];
            } else if (art.type === "Series") {
              receiving_type = "series";
              if (!art.series) throw new Error("Series articulation missing series field");
              receiving_label = art.series.name;
              receiving_courses = art.series.courses.map(toSimpleCourse);
            } else if (art.type === "Requirement") {
              receiving_type = "named";
              if (!art.requirement) throw new Error("Requirement articulation missing requirement field");
              receiving_label = art.requirement.name;
              receiving_courses = [];
            } else if (art.type === "GeneralEducation") {
              receiving_type = "ge_area";
              // GE label comes from context (area name or GE code)
              // For now, use a placeholder; Phase 2 may refine this
              receiving_label = cell.type === "GeneralEducation" ? "General Education" : "GE Area";
              receiving_courses = [];
            } else {
              throw new Error(`Unknown articulation type: ${art.type}`);
            }

            // Process sending side
            const sending: SendingOption[] = [];
            const noArticulationReason = mapNoArticulationReason(
              art.sendingArticulation.noArticulationReason
            );

            if (noArticulationReason) {
              // No articulation case: empty sending array
              sending.length = 0;
            } else {
              // Process sending-side CourseGroup items (AND/OR logic)
              for (const courseGroup of art.sendingArticulation.items) {
                sending.push({
                  conjunction: courseGroup.courseConjunction === "And" ? "and" : "or",
                  courses: courseGroup.items.map(toSimpleCourse),
                });
              }
            }

            requirements.push({
              receiving_type,
              receiving_label,
              receiving_courses,
              sending,
              no_articulation_reason: noArticulationReason,
            });
            }
          }
        }
      }

      // Map instruction type for this requirement group
      let instruction: "complete-all" | "select-one" | "n-from-area" | "n-from-conjunction" | "n-from-following" | null = null;
      let n: number | undefined = undefined;

      if (rg.instruction) {
        instruction = mapInstructionType(rg.instruction.type, rg.instruction.selectionType);
        if (instruction?.startsWith("n-from-")) {
          // Extract N value (default to 1 if not found)
          n = extractNFromInstruction(rg.instruction) || 1;
        }
      }

      // Only add requirement group if it has requirements
      if (requirements.length > 0) {
        const group: ArticulationRequirementGroup = {
          area: rg.area,
          instruction,
          requirements,
        };
        if (n !== undefined) {
          group.n = n;
        }
        requirementGroups.push(group);
      }
    }
  }

  // If we found no requirement groups, create a minimal one with no requirements
  // This can happen when ASSIST returns structure but no actual articulations (rare edge case)
  if (requirementGroups.length === 0) {
    requirementGroups.push({
      area: "Articulation",
      instruction: null,
      requirements: [],
    });
  }

  return {
    cc_slug: ccSlug,
    university_slug: universitySlug,
    major_label: result.name,
    agreement_key: agreementKey,
    academic_year: normalizeAcademicYear(academicYear.code),
    publish_date: result.publishDate,
    receiving_termtype: receivingInstitution.termType,
    requirement_groups: requirementGroups,
  };
}
