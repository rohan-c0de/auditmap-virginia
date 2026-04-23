/**
 * Zod schemas for scraper output.
 *
 * These are the shapes that scrapers produce and that import scripts
 * consume. Validate before upsert to Supabase so a broken scraper can't
 * silently poison student-facing data. See issue #49.
 *
 * Shapes match the interfaces in `scripts/lib/supabase-import.ts` plus
 * `data/{state}/prereqs.json`.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// CourseSection — one entry in data/{state}/courses/{college}/{term}.json
// ---------------------------------------------------------------------------

export const CourseSectionSchema = z.object({
  // `state`, `college_code`, and `term` in the JSON are advisory — the
  // import script trusts the directory + filename instead. Accept them if
  // present but do not require them.
  state: z.string().optional(),
  college_code: z.string().optional(),
  term: z.string().optional(),

  // Required identity + content fields. A row missing any of these is unusable.
  course_prefix: z.string().min(1, "course_prefix required"),
  course_number: z.string().min(1, "course_number required"),
  course_title: z.string().min(1, "course_title required"),
  credits: z.number().nonnegative("credits must be >= 0"),
  crn: z.string().min(1, "crn required"),

  // Schedule fields — may legitimately be empty strings or "TBA".
  days: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  start_date: z.string().nullable().optional(),
  location: z.string(),
  campus: z.string(),

  // Constrained vocabulary. Anything else means the scraper invented a mode.
  // `zoom` = synchronous remote class (distinct from asynchronous `online`).
  mode: z.enum(["in-person", "online", "hybrid", "zoom"]),

  instructor: z.string().nullable().optional(),
  seats_open: z.number().nullable().optional(),
  seats_total: z.number().nullable().optional(),

  prerequisite_text: z.string().nullable().optional(),
  prerequisite_courses: z.array(z.string()),
});

export type CourseSection = z.infer<typeof CourseSectionSchema>;

// ---------------------------------------------------------------------------
// TransferMapping — one entry in data/{state}/transfer-equiv.json
// ---------------------------------------------------------------------------

export const TransferMappingSchema = z.object({
  cc_prefix: z.string().min(1),
  cc_number: z.string().min(1),
  cc_course: z.string().min(1),
  cc_title: z.string(),
  cc_credits: z.string(),
  university: z.string().min(1),
  university_name: z.string().min(1),
  univ_course: z.string(),
  univ_title: z.string(),
  univ_credits: z.string(),
  notes: z.string(),
  no_credit: z.boolean(),
  is_elective: z.boolean(),
});

export type TransferMapping = z.infer<typeof TransferMappingSchema>;

/**
 * Header rows (e.g. `cc_prefix: "VCCS"`, `cc_number: "Course Number"`) are
 * carried in some transfer files as a metadata row. Callers should filter
 * these out before validation — see `isTransferHeaderRow`.
 */
export function isTransferHeaderRow(m: Record<string, unknown>): boolean {
  return (
    m.cc_number === "Course Number" ||
    m.cc_prefix === "VCCS" ||
    m.cc_prefix === "NCCCS" ||
    m.cc_prefix === "SCTCS"
  );
}

// ---------------------------------------------------------------------------
// PrereqEntry — value side of data/{state}/prereqs.json (keyed by "ACC 212")
// ---------------------------------------------------------------------------

export const PrereqEntrySchema = z.object({
  text: z.string(),
  courses: z.array(z.string()),
});

export type PrereqEntry = z.infer<typeof PrereqEntrySchema>;

export const PrereqMapSchema = z.record(z.string(), PrereqEntrySchema);

// ---------------------------------------------------------------------------
// Validation helper with row-level error reporting
// ---------------------------------------------------------------------------

export interface ValidationResult<T> {
  valid: T[];
  /** One entry per invalid row, with the original index and the failure summary. */
  invalid: Array<{ index: number; identity: string; errors: string[] }>;
}

/**
 * Validate an array of rows against a schema. Keeps invalid rows out of the
 * `valid` list and records a compact error summary for each.
 *
 * `identify` derives a short human label (e.g. "brcc/2026SP CRN 70056") so
 * log output points at the specific row, not just the file as a whole.
 */
export function validateRows<T>(
  rows: unknown[],
  schema: z.ZodType<T>,
  identify: (row: unknown, index: number) => string
): ValidationResult<T> {
  const valid: T[] = [];
  const invalid: ValidationResult<T>["invalid"] = [];

  rows.forEach((row, index) => {
    const result = schema.safeParse(row);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({
        index,
        identity: identify(row, index),
        errors: result.error.issues.map(
          (i) => `${i.path.join(".") || "<root>"}: ${i.message}`
        ),
      });
    }
  });

  return { valid, invalid };
}

/**
 * Threshold above which an import should abort rather than proceed with
 * partial data. At 5%, a single bad-field regression across one college
 * still lets the import complete; a systemic scraper break does not.
 */
export const MAX_INVALID_RATIO = 0.05;
