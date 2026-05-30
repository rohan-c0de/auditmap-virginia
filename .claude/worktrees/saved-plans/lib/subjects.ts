/**
 * Subject prefix → human-readable name mapping.
 * Used for SEO page titles and meta descriptions.
 * Falls back to the raw prefix if not found.
 */

const SUBJECT_NAMES: Record<string, string> = {
  // Business & Accounting
  ACC: "Accounting",
  ACCT: "Accounting",
  BUS: "Business",
  BUA: "Business Administration",
  ECO: "Economics",
  ECON: "Economics",
  FIN: "Finance",
  MGT: "Management",
  MKT: "Marketing",
  MIS: "Management Information Systems",
  ENT: "Entrepreneurship",
  HRM: "Human Resource Management",
  REA: "Real Estate",

  // Arts & Humanities
  ART: "Art",
  ARC: "Architecture",
  DES: "Design",
  GRA: "Graphic Design",
  MUS: "Music",
  THE: "Theater",
  THR: "Theater",
  DAN: "Dance",
  PHO: "Photography",
  HUM: "Humanities",
  PHI: "Philosophy",
  REL: "Religion",
  FLM: "Film",

  // English & Communications
  ENG: "English",
  ENGL: "English",
  COM: "Communications",
  COMM: "Communications",
  JOU: "Journalism",
  SPE: "Speech",
  SPCH: "Speech",
  WRT: "Writing",

  // World Languages
  SPA: "Spanish",
  FRE: "French",
  GER: "German",
  ITA: "Italian",
  JPN: "Japanese",
  CHI: "Chinese",
  ARA: "Arabic",
  ASL: "American Sign Language",
  LAT: "Latin",
  POR: "Portuguese",
  KOR: "Korean",
  RUS: "Russian",

  // Math & Statistics
  MAT: "Mathematics",
  MATH: "Mathematics",
  MTH: "Mathematics",
  STA: "Statistics",
  STAT: "Statistics",

  // Sciences
  BIO: "Biology",
  BIOL: "Biology",
  CHE: "Chemistry",
  CHEM: "Chemistry",
  PHY: "Physics",
  PHYS: "Physics",
  GEO: "Geology",
  GEOL: "Geology",
  ENV: "Environmental Science",
  SCI: "Science",
  AST: "Astronomy",
  OCE: "Oceanography",
  BOT: "Botany",
  MIC: "Microbiology",

  // Social Sciences
  PSY: "Psychology",
  PSYC: "Psychology",
  SOC: "Sociology",
  HIS: "History",
  HIST: "History",
  POL: "Political Science",
  POLS: "Political Science",
  GOV: "Government",
  ANT: "Anthropology",
  ANTH: "Anthropology",
  GEG: "Geography",
  GEOG: "Geography",
  SSC: "Social Science",

  // Computer Science & IT
  CSC: "Computer Science",
  CIS: "Computer Information Systems",
  ITE: "Information Technology",
  ITN: "Networking",
  ITP: "Programming",
  ITD: "Database",
  WEB: "Web Development",
  CYB: "Cybersecurity",
  GAM: "Game Design",
  CPT: "Computer Technology",

  // Health Sciences
  NUR: "Nursing",
  NURS: "Nursing",
  HLT: "Health",
  ALH: "Allied Health",
  EMT: "Emergency Medical Services",
  EMS: "Emergency Medical Services",
  PTA: "Physical Therapy",
  OTA: "Occupational Therapy",
  RAD: "Radiography",
  DEN: "Dental",
  DNH: "Dental Hygiene",
  PHM: "Pharmacy",
  MLT: "Medical Lab Technology",
  HIM: "Health Information Management",
  PHL: "Phlebotomy",
  CNA: "Nursing Assistant",
  VET: "Veterinary Technology",
  DMS: "Diagnostic Medical Sonography",
  RCP: "Respiratory Care",

  // Engineering & Technology
  EGR: "Engineering",
  ENGR: "Engineering",
  MEC: "Mechanical Engineering",
  ELE: "Electronics",
  AET: "Architectural Engineering",
  DRF: "Drafting",
  CAD: "CAD",
  AUT: "Automotive Technology",
  WEL: "Welding",
  HVA: "HVAC",
  HVAC: "HVAC",
  ELT: "Electrical Technology",
  PLU: "Plumbing",
  CON: "Construction",

  // Education
  EDU: "Education",
  ECE: "Early Childhood Education",
  CHD: "Child Development",
  SPD: "Special Education",

  // Criminal Justice & Law
  CRJ: "Criminal Justice",
  ADJ: "Administration of Justice",
  LAW: "Law",
  LGL: "Legal Studies",
  PLG: "Paralegal",
  FIR: "Fire Science",

  // Physical Education
  PED: "Physical Education",
  HPE: "Health & Physical Education",
  KIN: "Kinesiology",
  REC: "Recreation",

  // Trades & Applied
  CUL: "Culinary Arts",
  HOS: "Hospitality",
  AGR: "Agriculture",
  FOR: "Forestry",
  ADV: "Adventure Recreation",

  // General & Interdisciplinary
  SDV: "Student Development",
  IDS: "Interdisciplinary Studies",
  LIB: "Library Science",
  HON: "Honors",
  FYE: "First Year Experience",
};

/**
 * Get the human-readable subject name for a course prefix.
 * Returns the prefix itself if no mapping exists.
 */
export function subjectName(prefix: string): string {
  return SUBJECT_NAMES[prefix.toUpperCase()] || prefix.toUpperCase();
}

/**
 * Check if a prefix has a known human-readable name.
 */
export function hasSubjectName(prefix: string): boolean {
  return prefix.toUpperCase() in SUBJECT_NAMES;
}
