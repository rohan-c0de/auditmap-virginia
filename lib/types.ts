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
