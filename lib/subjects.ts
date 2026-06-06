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
  ENC: "English", // FL (e.g. ENC 1101)
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
  MAC: "Mathematics", // FL (e.g. MAC 1105)
  STA: "Statistics",
  STAT: "Statistics",

  // Sciences
  BIO: "Biology",
  BIOL: "Biology",
  BSC: "Biology", // FL (e.g. BSC 1010)
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
  AMH: "History", // FL (American History, e.g. AMH 2010)
  POL: "Political Science",
  POLS: "Political Science",
  GOV: "Government",
  GOVT: "Government", // TX (e.g. GOVT 2305)
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

/**
 * Reverse of SUBJECT_NAMES: human-readable name (lowercased) → the course
 * prefixes that carry it. Derived once from SUBJECT_NAMES so the two never
 * drift. One name can map to several prefixes (e.g. "history" → HIS, HIST, AMH).
 */
const NAME_TO_PREFIXES: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  for (const [prefix, name] of Object.entries(SUBJECT_NAMES)) {
    const key = name.toLowerCase();
    (map[key] ??= []).push(prefix);
  }
  return map;
})();

/**
 * Colloquial / abbreviated subject names → their canonical SUBJECT_NAMES entry.
 * Only entries that survive prefix parsing matter here: a query of 4 or fewer
 * letters (e.g. "bio", "econ") is treated as a course prefix upstream and never
 * reaches this resolver, so this list focuses on the multi-word and >4-letter
 * forms a student is likely to type.
 */
const SUBJECT_ALIASES: Record<string, string> = {
  "poli sci": "political science",
  polisci: "political science",
  "comp sci": "computer science",
  compsci: "computer science",
  psych: "psychology",
  stats: "statistics",
  maths: "mathematics",
};

/**
 * Resolve a free-text subject NAME to the course prefixes that represent it.
 * e.g. "history" → ["HIS","HIST","AMH"], "poli sci" → ["POL","POLS"].
 * Returns [] when the query isn't a recognized subject name.
 */
export function subjectPrefixesForName(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const canonical = SUBJECT_ALIASES[q] ?? q;
  return NAME_TO_PREFIXES[canonical] ?? [];
}
