import type { CourseIntent, CourseRef, EligibilityIntent, SearchIntent } from "../types";

// `ExpectedIntent` is a partial shape the matcher checks against the
// classifier's actual output. Only fields that are explicitly set are
// asserted — undefined fields mean "we don't care."
//
// `any-of` is for queries where multiple classifications are reasonable
// (e.g. multi-intent, ambiguous shorthand). Matching counts as a pass if
// the actual intent type is in `oneOf`.
export type ExpectedIntent =
  | { type: "transfer"; course?: CourseRef; university?: string | null }
  | { type: "pathway"; university?: string | null; major?: string | null }
  | { type: "prereqs"; course?: CourseRef }
  | {
      type: "eligibility";
      topic?: EligibilityIntent["topic"];
      age?: number | null;
    }
  | { type: "course"; mustExtract?: Partial<CourseIntent["filters"]> }
  | { type: "unknown" }
  | { type: "any-of"; oneOf: Array<SearchIntent["type"]> };

export interface EvalCase {
  id: string;
  query: string;
  /** State slug for the classifier. Defaults to "va" in the eval runner. */
  state?: string;
  category:
    | "course-code"
    | "course-keyword"
    | "prereqs"
    | "transfer"
    | "pathway"
    | "eligibility"
    | "course-with-filters"
    | "vague"
    | "multi-intent"
    | "gibberish";
  // Crosscutting markers (typos, slang, multi-intent). Useful for slicing
  // the eval report along non-category axes.
  tags?: Array<
    | "typo"
    | "slang"
    | "lowercase"
    | "multi-intent"
    | "missing-entity"
    // "alias": tests university name resolution (e.g. "GMU" → "gmu",
    // "George Mason" → "gmu", "UMass Amherst" → "umass-amherst").
    | "alias"
    // "non-va": tests course prefixes / universities outside Virginia.
    // Project is national; the fixture must not implicitly assume VCCS.
    | "non-va"
  >;
  expected: ExpectedIntent;
  notes?: string;
}

const ENG_111: CourseRef = { prefix: "ENG", number: "111" };
const BIO_256: CourseRef = { prefix: "BIO", number: "256" };
const MTH_263: CourseRef = { prefix: "MTH", number: "263" };
const PSY_200: CourseRef = { prefix: "PSY", number: "200" };

export const EVAL_CASES: EvalCase[] = [
  // ─── course-code ─────────────────────────────────────────────────────
  {
    id: "cc-01-eng-111-spaced",
    query: "ENG 111",
    category: "course-code",
    expected: { type: "course", mustExtract: { course: ENG_111 } },
  },
  {
    id: "cc-02-eng-111-lowercase",
    query: "eng 111",
    category: "course-code",
    tags: ["lowercase"],
    expected: { type: "course", mustExtract: { course: ENG_111 } },
  },
  {
    id: "cc-03-eng-111-no-space",
    query: "ENG111",
    category: "course-code",
    expected: { type: "course", mustExtract: { course: ENG_111 } },
  },
  {
    id: "cc-04-bio-256",
    query: "BIO 256",
    category: "course-code",
    expected: { type: "course", mustExtract: { course: BIO_256 } },
  },
  {
    id: "cc-05-math-lowercase",
    query: "math 154",
    category: "course-code",
    tags: ["lowercase"],
    expected: {
      type: "course",
      mustExtract: { course: { prefix: "MATH", number: "154" } },
    },
  },
  {
    id: "cc-06-psy200-jammed",
    query: "psy200",
    category: "course-code",
    tags: ["lowercase"],
    expected: { type: "course", mustExtract: { course: PSY_200 } },
  },
  {
    id: "cc-07-cs-101",
    query: "CS 101",
    category: "course-code",
    expected: {
      type: "course",
      mustExtract: { course: { prefix: "CS", number: "101" } },
    },
  },
  {
    id: "cc-08-engl-101-cuny",
    query: "ENGL 101",
    category: "course-code",
    tags: ["non-va"],
    expected: {
      type: "course",
      mustExtract: { course: { prefix: "ENGL", number: "101" } },
    },
    notes: "CUNY/SUNY/GA-style 4-letter prefix. Regex must accept 2-4 letters.",
  },
  {
    id: "cc-09-biol-110",
    query: "BIOL 110",
    category: "course-code",
    tags: ["non-va"],
    expected: {
      type: "course",
      mustExtract: { course: { prefix: "BIOL", number: "110" } },
    },
  },
  {
    id: "cc-10-psyc-101",
    query: "PSYC 101",
    category: "course-code",
    tags: ["non-va"],
    expected: {
      type: "course",
      mustExtract: { course: { prefix: "PSYC", number: "101" } },
    },
  },
  {
    id: "cc-11-acct-201",
    query: "ACCT 201",
    category: "course-code",
    tags: ["non-va"],
    expected: {
      type: "course",
      mustExtract: { course: { prefix: "ACCT", number: "201" } },
    },
    notes: "Common in NY/NC; tests 4-letter prefix without 'common knowledge' bias.",
  },

  // ─── course-keyword ──────────────────────────────────────────────────
  {
    id: "ck-01-intro-biology",
    query: "intro biology",
    category: "course-keyword",
    expected: { type: "course" },
    notes: "Should fall through to keyword search; no course code extractable.",
  },
  {
    id: "ck-02-introduction-to-psychology",
    query: "Introduction to Psychology",
    category: "course-keyword",
    expected: { type: "course" },
  },
  {
    id: "ck-03-prefix-only",
    query: "ENG",
    category: "course-keyword",
    expected: { type: "any-of", oneOf: ["course", "unknown"] },
    notes:
      "A bare 3-letter prefix is genuinely ambiguous (subject filter? typo? abbreviation?). Either 'course' (treat as subject filter) or 'unknown' (ask for clarification) is reasonable.",
  },
  {
    id: "ck-04-macroeconomics",
    query: "macroeconomics",
    category: "course-keyword",
    tags: ["lowercase"],
    expected: { type: "course" },
    notes: "Single-word topical keyword; should fall through to title search.",
  },
  {
    id: "ck-05-organic-chem",
    query: "organic chemistry",
    category: "course-keyword",
    tags: ["lowercase"],
    expected: { type: "course" },
  },

  // ─── prereqs ─────────────────────────────────────────────────────────
  {
    id: "pr-01-prereqs-for-bio",
    query: "prereqs for BIO 256",
    category: "prereqs",
    expected: { type: "prereqs", course: BIO_256 },
  },
  {
    id: "pr-02-what-are-prereqs",
    query: "what are the prereqs for BIO 256",
    category: "prereqs",
    expected: { type: "prereqs", course: BIO_256 },
  },
  {
    id: "pr-03-prerequisites-spelled",
    query: "prerequisites for math 263",
    category: "prereqs",
    tags: ["lowercase"],
    expected: {
      type: "prereqs",
      course: { prefix: "MATH", number: "263" },
    },
    notes:
      "Classifier preserves what the user typed ('math' → MATH). Per-state alias mapping (MATH → MTH for VA, MAT for some NC colleges) is the answer-lookup layer's job, not the classifier's.",
  },
  {
    id: "pr-04-trailing-prereqs",
    query: "BIO 256 prereqs",
    category: "prereqs",
    expected: { type: "prereqs", course: BIO_256 },
  },
  {
    id: "pr-05-natural-language",
    query: "what do I need to take before MTH 263",
    category: "prereqs",
    expected: { type: "prereqs", course: MTH_263 },
  },
  {
    id: "pr-06-informal",
    query: "do i need to take anything before psy 200",
    category: "prereqs",
    tags: ["lowercase"],
    expected: { type: "prereqs", course: PSY_200 },
  },
  {
    id: "pr-07-shorthand",
    query: "prereq BIO 101",
    category: "prereqs",
    expected: {
      type: "prereqs",
      course: { prefix: "BIO", number: "101" },
    },
  },
  {
    id: "pr-08-comes-before",
    query: "what comes before ENG 111",
    category: "prereqs",
    expected: { type: "prereqs", course: ENG_111 },
    notes: "Stretch case — informal phrasing without 'prereq' keyword.",
  },
  {
    id: "pr-09-prereqs-math-cuny",
    query: "prereqs for MATH 121",
    category: "prereqs",
    tags: ["non-va"],
    expected: {
      type: "prereqs",
      course: { prefix: "MATH", number: "121" },
    },
  },
  {
    id: "pr-10-prereqs-psyc",
    query: "what do I need before PSYC 101",
    category: "prereqs",
    tags: ["non-va"],
    expected: {
      type: "prereqs",
      course: { prefix: "PSYC", number: "101" },
    },
  },

  // ─── transfer ────────────────────────────────────────────────────────
  {
    id: "tr-01-classic",
    query: "Does ENG 111 transfer to GMU?",
    category: "transfer",
    expected: { type: "transfer", course: ENG_111, university: "gmu" },
  },
  {
    id: "tr-02-lowercase",
    query: "does eng 111 transfer to gmu",
    category: "transfer",
    tags: ["lowercase"],
    expected: { type: "transfer", course: ENG_111, university: "gmu" },
  },
  {
    id: "tr-03-full-university-name",
    query: "will ENG 111 transfer to George Mason",
    category: "transfer",
    expected: { type: "transfer", course: ENG_111, university: "gmu" },
    notes: "University alias resolution: 'George Mason' → 'gmu'.",
  },
  {
    id: "tr-04-arrow-shorthand",
    query: "ENG 111 → GMU",
    category: "transfer",
    tags: ["slang"],
    expected: { type: "transfer", course: ENG_111, university: "gmu" },
  },
  {
    id: "tr-05-typos",
    query: "does eng111 trasnfer 2 gmu",
    category: "transfer",
    tags: ["typo", "slang", "lowercase"],
    expected: { type: "transfer", course: ENG_111, university: "gmu" },
    notes: "Hard case for regex; LLM should handle.",
  },
  {
    id: "tr-06-vcu",
    query: "Does math 263 transfer to vcu",
    category: "transfer",
    tags: ["lowercase"],
    expected: {
      type: "transfer",
      course: { prefix: "MATH", number: "263" },
      university: "vcu",
    },
    notes:
      "Same as pr-03: classifier preserves 'MATH' from user input; per-state aliasing is downstream.",
  },
  {
    id: "tr-07-imperative",
    query: "transfer ENG 111 to UMass",
    category: "transfer",
    expected: { type: "transfer", course: ENG_111 },
    notes: "UMass spans a system; alias resolution may yield multiple. Don't assert university slug.",
  },
  {
    id: "tr-08-bare-juxtaposition",
    query: "ENG 111 GMU",
    category: "transfer",
    tags: ["slang"],
    expected: { type: "any-of", oneOf: ["transfer", "course"] },
    notes: "Could be transfer-shorthand or just course+filter; either is reasonable.",
  },
  {
    id: "tr-09-no-destination",
    query: "Does ENG 111 transfer?",
    category: "transfer",
    tags: ["missing-entity"],
    expected: { type: "transfer", course: ENG_111, university: null },
    notes: "Missing destination → answer layer should prompt for one.",
  },
  {
    id: "tr-10-no-course",
    query: "will my biology credits transfer to gmu",
    category: "transfer",
    tags: ["missing-entity", "lowercase"],
    expected: { type: "transfer", university: "gmu" },
    notes:
      "No course code; answer layer should prompt or do keyword-based course matching.",
  },
  {
    id: "tr-11-umass-amherst",
    query: "Does ENGL 101 transfer to UMass Amherst",
    category: "transfer",
    tags: ["non-va", "alias"],
    expected: {
      type: "transfer",
      course: { prefix: "ENGL", number: "101" },
    },
    notes:
      "MA. UMass is a multi-campus system; 'UMass Amherst' should resolve to a specific slug. Slug not asserted (normalization is the answer-layer's job).",
  },
  {
    id: "tr-12-nc-state",
    query: "Will MATH 100 transfer to NC State",
    category: "transfer",
    tags: ["non-va", "alias"],
    expected: {
      type: "transfer",
      course: { prefix: "MATH", number: "100" },
    },
    notes: "NC. 'NC State' (a.k.a. NCSU) — common informal name.",
  },
  {
    id: "tr-13-georgia-tech-arrow",
    query: "ENGL 102 → Georgia Tech",
    category: "transfer",
    tags: ["non-va", "slang", "alias"],
    expected: {
      type: "transfer",
      course: { prefix: "ENGL", number: "102" },
    },
    notes: "GA. 'Georgia Tech' should map to slug 'gatech'.",
  },
  {
    id: "tr-14-unc-ambiguous",
    query: "Does BIOL 101 transfer to UNC",
    category: "transfer",
    tags: ["non-va", "alias", "missing-entity"],
    expected: {
      type: "transfer",
      course: { prefix: "BIOL", number: "101" },
    },
    notes:
      "NC. 'UNC' alone is ambiguous (Chapel Hill, Charlotte, Greensboro, Wilmington…). Answer layer should either default to Chapel Hill or prompt.",
  },
  {
    id: "tr-15-bu-vs-bc",
    query: "will my english credits transfer to BU",
    category: "transfer",
    tags: ["non-va", "alias", "missing-entity", "lowercase"],
    expected: { type: "transfer" },
    notes:
      "MA. BU = Boston University, NOT Boston College (BC). Important disambiguation case.",
  },
  {
    id: "tr-16-pitt",
    query: "Does HIST 101 transfer to Pitt",
    category: "transfer",
    tags: ["non-va", "alias"],
    expected: {
      type: "transfer",
      course: { prefix: "HIST", number: "101" },
    },
    notes: "PA. 'Pitt' = University of Pittsburgh (NOT Pittsburgh State or Penn State).",
  },
  {
    id: "tr-17-uconn",
    query: "Does ENGL 102 transfer to UConn",
    category: "transfer",
    tags: ["non-va", "alias"],
    expected: {
      type: "transfer",
      course: { prefix: "ENGL", number: "102" },
    },
    notes: "CT. 'UConn' = University of Connecticut.",
  },
  {
    id: "tr-18-rutgers",
    query: "Does PSYC 101 transfer to Rutgers",
    category: "transfer",
    tags: ["non-va", "alias", "missing-entity"],
    expected: {
      type: "transfer",
      course: { prefix: "PSYC", number: "101" },
    },
    notes:
      "NJ. Rutgers spans New Brunswick, Newark, Camden — multi-campus disambiguation.",
  },

  // ─── pathway ─────────────────────────────────────────────────────────
  {
    id: "pw-01-cs-at-gmu",
    query: "what do I need to transfer to GMU for Computer Science?",
    category: "pathway",
    expected: { type: "pathway" },
    notes: "Classic pathway question — university + major.",
  },
  {
    id: "pw-02-nursing-unc",
    query: "transfer requirements for nursing at UNC",
    category: "pathway",
    tags: ["non-va"],
    expected: { type: "pathway" },
  },
  {
    id: "pw-03-no-major",
    query: "courses needed to transfer to Virginia Tech",
    category: "pathway",
    expected: { type: "pathway" },
    notes: "No major specified — just a destination.",
  },
  {
    id: "pw-04-how-do-i-get-in",
    query: "how do I get into UMass Boston for business?",
    category: "pathway",
    tags: ["non-va"],
    expected: { type: "pathway" },
  },
  {
    id: "pw-05-vague-transfer-plan",
    query: "what classes should I take to transfer",
    category: "pathway",
    tags: ["missing-entity"],
    expected: { type: "any-of", oneOf: ["pathway", "unknown"] },
    notes: "No destination or major. Either pathway (with missing entity) or unknown is reasonable.",
  },

  // ─── eligibility ─────────────────────────────────────────────────────
  {
    id: "el-01-65-plus",
    query: "free college if I'm 65+",
    category: "eligibility",
    expected: { type: "eligibility", topic: "senior", age: 65 },
  },
  {
    id: "el-02-natural-language",
    query: "I'm 65 can I take classes for free",
    category: "eligibility",
    expected: { type: "eligibility", topic: "senior", age: 65 },
  },
  {
    id: "el-03-senior-audit",
    query: "senior citizen audit",
    category: "eligibility",
    expected: { type: "any-of", oneOf: ["eligibility"] },
    notes: "Topic could be 'senior' or 'audit'; both acceptable.",
  },
  {
    id: "el-04-free-for-seniors",
    query: "free classes for seniors",
    category: "eligibility",
    expected: { type: "eligibility", topic: "senior" },
  },
  {
    id: "el-05-veteran",
    query: "tuition waiver veterans",
    category: "eligibility",
    expected: { type: "eligibility", topic: "veteran" },
  },
  {
    id: "el-06-over-60",
    query: "am I eligible for free classes if I'm over 60",
    category: "eligibility",
    expected: { type: "eligibility", topic: "senior", age: 60 },
  },

  // ─── course-with-filters ─────────────────────────────────────────────
  {
    id: "cf-01-online-math-summer",
    query: "online math, summer 2026",
    category: "course-with-filters",
    expected: {
      type: "course",
      mustExtract: { mode: "online", term: "Summer 2026" },
    },
  },
  {
    id: "cf-02-evening-biology",
    query: "evening biology",
    category: "course-with-filters",
    expected: { type: "course", mustExtract: { timeOfDay: "evening" } },
  },
  {
    id: "cf-03-weekend-accounting",
    query: "weekend accounting",
    category: "course-with-filters",
    expected: { type: "course", mustExtract: { days: ["S", "U"] } },
  },
  {
    id: "cf-04-online-eng-111",
    query: "online ENG 111",
    category: "course-with-filters",
    expected: {
      type: "course",
      mustExtract: { mode: "online", course: ENG_111 },
    },
  },
  {
    id: "cf-05-morning-classes",
    query: "morning classes",
    category: "course-with-filters",
    expected: { type: "course", mustExtract: { timeOfDay: "morning" } },
  },
  {
    id: "cf-06-summer-biology-online",
    query: "summer biology online",
    category: "course-with-filters",
    expected: { type: "course", mustExtract: { mode: "online" } },
    notes: "Term phrase 'summer' alone is ambiguous (no year). Don't assert term.",
  },
  {
    id: "cf-07-intro-psych-online",
    query: "intro to psych online",
    category: "course-with-filters",
    expected: { type: "course", mustExtract: { mode: "online" } },
  },
  {
    id: "cf-08-in-person-math",
    query: "in person math",
    category: "course-with-filters",
    expected: { type: "course", mustExtract: { mode: "in-person" } },
  },

  // ─── vague ───────────────────────────────────────────────────────────
  {
    id: "vg-01-cheap-classes",
    query: "cheap classes",
    category: "vague",
    expected: { type: "any-of", oneOf: ["unknown", "eligibility"] },
    notes: "'Cheap' could route to senior/audit waiver answer or be unknown.",
  },
  {
    id: "vg-02-what-should-i-take",
    query: "what should I take",
    category: "vague",
    expected: { type: "unknown" },
  },
  {
    id: "vg-03-good-professors",
    query: "good professors",
    category: "vague",
    expected: { type: "unknown" },
    notes: "We don't have ratings data; this is genuinely unanswerable.",
  },
  {
    id: "vg-04-easy-classes",
    query: "easy classes",
    category: "vague",
    expected: { type: "unknown" },
  },

  // ─── multi-intent ────────────────────────────────────────────────────
  {
    id: "mi-01-transfer-and-prereqs",
    query: "Does ENG 111 transfer to GMU and what are the prereqs?",
    category: "multi-intent",
    tags: ["multi-intent"],
    expected: { type: "any-of", oneOf: ["transfer", "prereqs"] },
    notes: "Either single intent is acceptable in v1; multi-card UI deferred.",
  },
  {
    id: "mi-02-online-and-transfers",
    query: "online ENG 111 that transfers to GMU",
    category: "multi-intent",
    tags: ["multi-intent"],
    expected: { type: "any-of", oneOf: ["transfer", "course"] },
  },
  {
    id: "mi-03-prereqs-and-transfer",
    query: "prereqs for BIO 256 and does it transfer to VCU",
    category: "multi-intent",
    tags: ["multi-intent"],
    expected: { type: "any-of", oneOf: ["transfer", "prereqs"] },
  },

  // ─── gibberish ───────────────────────────────────────────────────────
  {
    id: "gb-01-double-course",
    query: "ENG 111 ENG 112",
    category: "gibberish",
    expected: { type: "any-of", oneOf: ["course", "unknown"] },
    notes: "Two course codes. Either pick the first or punt to unknown.",
  },
  {
    id: "gb-02-keyboard-mash",
    query: "asdfghjk",
    category: "gibberish",
    expected: { type: "any-of", oneOf: ["course", "unknown"] },
    notes:
      "Currently keyword-search would treat this as a title query and return nothing. 'course' with no match is acceptable; 'unknown' is also fine.",
  },
  {
    id: "gb-03-emoji-only",
    query: "🎓",
    category: "gibberish",
    expected: { type: "unknown" },
  },
];
