export interface Campus {
  name: string;
  lat: number;
  lng: number;
  address: string;
}

export interface SeniorDiscount {
  available: boolean;
  age_threshold: number;
  cost: string;
  notes: string;
  source_url: string;
}

export interface Eligibility {
  minimum_age: number;
  residency_required: boolean;
  senior_discount: SeniorDiscount;
}

export interface ApplicationProcess {
  steps: string[];
  timing: string;
  form_url: string;
  contact_email: string;
  contact_phone: string;
}

export interface AuditPolicy {
  allowed: boolean | null;
  cost_model: string | null;
  cost_note: string;
  eligibility: Eligibility;
  application_process: ApplicationProcess;
  restrictions: string[];
  last_verified: string;
  source_url: string;
}

export interface Institution {
  id: string;
  name: string;
  system: string;
  college_slug: string;
  campuses: Campus[];
  audit_policy: AuditPolicy;
  /**
   * IPEDS unitid for cross-reference with the federal College Scorecard
   * dataset. Optional because not every institution has a Scorecard record
   * (e.g. UDC's embedded community college, recently closed institutions).
   * Populated by `scripts/scorecard-map.ts`. See issue #392.
   */
  unitid?: number;
}

export type CourseMode = "in-person" | "online" | "hybrid" | "zoom";

export interface CourseSection {
  college_code: string;
  term: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  credits: number;
  crn: string;
  days: string;
  start_time: string;
  end_time: string;
  start_date: string;
  location: string;
  campus: string;
  mode: CourseMode;
  instructor: string | null;
  seats_open: number | null;
  seats_total: number | null;
  prerequisite_text: string | null;
  prerequisite_courses: string[];
}

export interface SearchResult {
  institution: Institution;
  distance: number; // miles
  courseCount: number;
}

// ---------------------------------------------------------------------------
// Smart Schedule Builder types
// ---------------------------------------------------------------------------

export interface ScheduleRequest {
  subjects: string[]; // e.g. ["ART", "PSY"] or ["PSY 200", "ART 101"]
  daysAvailable: string[]; // e.g. ["M", "Tu", "W", "Th"]
  timeWindowStart: string; // "9:00 AM" or bucket like "morning"
  timeWindowEnd: string; // "1:00 PM" or bucket like "afternoon"
  maxCourses: 1 | 2 | 3 | 4 | 5;
  zip?: string;
  maxDistance?: number; // miles; undefined means no limit
  mode?: CourseMode | "any";
  minBreakMinutes: 0 | 30 | 60;
  includeInProgress?: boolean; // default false — exclude sections that already started
  term?: string; // e.g. "2026SU" — defaults to getCurrentTerm()
  targetUniversity?: string; // e.g. "uga" — enables transfer-aware scoring
  hideFullSections?: boolean; // default true — hide sections with 0 open seats
}

export type TransferStatus = "direct" | "elective" | "no-credit" | "unknown";

export interface ScoreBreakdown {
  timeCompactness: number; // 0-20
  distanceScore: number; // 0-20
  dayConsolidation: number; // 0-20
  varietyScore: number; // 0-10
  seatAvailability: number; // 0-15
  transferScore: number; // 0-15
}

export interface ScheduleSection extends CourseSection {
  collegeName: string;
  distance: number | null;
  transferStatus?: TransferStatus;
  transferCourse?: string; // e.g. "ENGL 1101" at the target university
}

export interface GeneratedSchedule {
  id: string;
  score: number; // 0-100
  sections: ScheduleSection[];
  scoreBreakdown: ScoreBreakdown;
}

// ---------------------------------------------------------------------------
// Transfer Equivalency types
// ---------------------------------------------------------------------------

export interface TransferMapping {
  cc_prefix: string;
  cc_number: string;
  cc_course: string;
  cc_title: string;
  cc_credits: string;
  university: string;
  university_name: string;
  univ_course: string;
  univ_title: string;
  univ_credits: string;
  notes: string;
  no_credit: boolean;
  is_elective: boolean;
}

/**
 * Slim version of TransferMapping passed to the client on the transfer-hub
 * page. Omits redundant fields that are constant for the page
 * (university, university_name) or derivable (cc_course = prefix+number) —
 * this keeps the RSC serialization payload well under Vercel's 19 MB ISR
 * cap for universities with tens of thousands of mappings (UMGC, UMBC).
 */
export interface TransferMappingClient {
  cc_prefix: string;
  cc_number: string;
  cc_title: string;
  cc_credits: string;
  univ_course: string;
  univ_title: string;
  notes: string;
  is_elective: boolean;
}

export interface ScheduleResponse {
  schedules: GeneratedSchedule[];
  meta: {
    candidateSections: number;
    candidateCourses: number;
    combinationsEvaluated: number;
    timeTakenMs: number;
    message?: string;
    filteredFullSections?: number; // how many sections were hidden due to 0 seats
  };
}

// ---------------------------------------------------------------------------
// Program / Degree Requirement types
// ---------------------------------------------------------------------------

export type ProgramCredential = "AA" | "AS" | "AAS" | "certificate" | "diploma" | "other";

export interface RequiredCourse {
  prefix: string;
  number: string;
  title: string;
  credits: number | null;
  or_alternatives: Array<{ prefix: string; number: string; title: string }>;
}

export interface RequirementGroup {
  name: string;
  credits_required: number | null;
  choose_n: number | null;
  courses: RequiredCourse[];
}

export interface ProgramRequirement {
  title: string;
  credential: ProgramCredential;
  program_code: string | null;
  catalog_url: string;
  total_credits: number | null;
  gpa_minimum: number | null;
  description: string | null;
  requirement_groups: RequirementGroup[];
  matched_program_slug: string | null;
}

export interface CollegePrograms {
  college_slug: string;
  catalog_year: string;
  catalog_url: string;
  scraped_at: string;
  programs: ProgramRequirement[];
}

// ASSIST.org articulation types (Phase 3)
export interface SendingOption {
  cc_course_prefix: string;
  cc_course_number: string;
  cc_course_title: string;
  cc_course_units: string;
  conjunction: "AND" | "OR";
}

export interface ArticulationRequirement {
  receiving_course_prefix?: string;
  receiving_course_number?: string;
  receiving_course_title?: string;
  receiving_course_units?: string;
  requirement_label: string;
  sending_options: SendingOption[] | null; // null if no_articulation_reason is set
  no_articulation_reason?: string;
}

export interface ArticulationRequirementGroup {
  name: string;
  type: "GE" | "MAJOR" | "ELECTIVE" | "OTHER";
  requirements: ArticulationRequirement[];
}

export interface ArticulationAgreement {
  cc_name: string;
  cc_slug: string;
  receiving_institution_name: string;
  receiving_institution_slug: string;
  major_name: string;
  major_slug: string;
  requirement_groups: ArticulationRequirementGroup[];
}
