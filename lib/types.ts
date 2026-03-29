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
  vccs_slug: string;
  campuses: Campus[];
  audit_policy: AuditPolicy;
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
  maxCourses: 1 | 2 | 3;
  zip?: string;
  maxDistance?: number; // miles; undefined means no limit
  mode?: CourseMode | "any";
  minBreakMinutes: 0 | 30 | 60;
  includeInProgress?: boolean; // default false — exclude sections that already started
  term?: string; // e.g. "2026SU" — defaults to getCurrentTerm()
}

export interface ScoreBreakdown {
  timeCompactness: number; // 0-25
  distanceScore: number; // 0-25
  dayConsolidation: number; // 0-25
  varietyScore: number; // 0-25
}

export interface ScheduleSection extends CourseSection {
  collegeName: string;
  distance: number | null;
}

export interface GeneratedSchedule {
  id: string;
  score: number; // 0-100
  sections: ScheduleSection[];
  scoreBreakdown: ScoreBreakdown;
}

export interface ScheduleResponse {
  schedules: GeneratedSchedule[];
  meta: {
    candidateSections: number;
    candidateCourses: number;
    combinationsEvaluated: number;
    timeTakenMs: number;
    message?: string;
  };
}
