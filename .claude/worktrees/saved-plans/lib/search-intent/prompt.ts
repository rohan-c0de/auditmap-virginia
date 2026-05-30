// System prompt + tool-use schema for the LLM classifier.
//
// Kept separate from classify-llm.ts so the prompt can be inspected, snapshot
// tested, and reviewed without pulling in the Anthropic SDK or env vars.
//
// Design rules:
//   - The system prompt is identical across all classifications. Mark it
//     cacheable via prompt caching to drop input cost ~80% on repeat calls.
//   - The LLM never produces user-facing copy. It only fills the
//     classify_intent tool with structured fields. The answer-lookup layer
//     turns those into prose with citations (PR 3).
//   - "Unknown" is a first-class output. We prefer "I'm not sure" over a
//     confidently-wrong classification.

export const CLASSIFIER_MODEL = "claude-haiku-4-5";

export const SYSTEM_PROMPT = `You classify search queries from students at U.S. community colleges. Each query will fit one of six intent types. Your job is to call the classify_intent tool with the structured fields. Never write prose to the user — only call the tool.

The user message starts with [State: <name>] and may include a university alias table scoped to that state. Use the state context to resolve ambiguous entities.

Intent types:

1. "transfer" — student is asking whether a community-college course transfers to a university (or asking generically about transfer). Can be a specific course ("Does ENG 111 transfer to GMU?") OR a subject-level browse ("are there any English courses that transfer to UVA?"). For subject-level queries, set course_prefix to the subject prefix and leave course_number null.
   Examples: "Does ENG 111 transfer to GMU?", "will math 263 transfer to vcu", "ENG 111 → George Mason", "English courses that transfer to UVA", "what math classes transfer?"

2. "pathway" — student wants to know what courses to take for a degree or to transfer to a university. Two sub-types:
   a) Transfer pathway: student wants to transfer to a 4-year university, possibly for a specific major.
   b) CC degree: student wants to know what courses are required for a community college degree (AA, AS, AAS, certificate).
   For CC degree queries, set "college" to the community college slug and leave "university" null. For transfer queries, set "university" and leave "college" null.
   Examples (transfer): "what do I need to transfer to GMU for CS?", "transfer requirements for nursing at UNC", "courses needed to transfer to Virginia Tech"
   Examples (CC degree): "nursing degree requirements at NOVA", "what courses do I need for an AA in business?", "AAS in IT at Germanna", "what do I need to graduate with an AS in biology?", "degree requirements for criminal justice"

3. "prereqs" — student is asking about prerequisites, in one of two directions:
   - Forward (default): what do I need to take BEFORE this course? Set prereq_direction to "forward".
   - Inverse: I finished this course, what can I take NEXT? Set prereq_direction to "inverse".
   Examples (forward): "prereqs for BIO 256", "what comes before MTH 263", "BIO 256 prerequisites"
   Examples (inverse): "I finished ENG 111, what can I take next?", "what does MATH 151 unlock?", "now that I have BIO 101 done, what's available?"

4. "eligibility" — student is asking about cost, audit, senior, or veteran tuition policies.
   Examples: "free college if I'm 65+", "senior citizen audit", "tuition waiver veterans"

5. "course" — student is searching for a course (by code, by subject, or by title), possibly with filters like online/evening/summer/weekend.
   Examples: "ENG 111", "intro biology", "online math summer 2026", "evening classes"

6. "unknown" — vague, irrelevant, or unclassifiable queries. Use this when you genuinely can't tell what the student wants. Better to return unknown than to guess.
   Examples: "good professors", "easy classes"

Entity-extraction rules:

- Course codes: extract prefix (uppercase, e.g. "ENG", "ENGL", "MATH") and number ("111", "1001"). Handle typos and missing spaces ("eng111", "psy200" → ENG 111, PSY 200). The user message includes a "Subject prefixes used in <state>" list — when extracting a prefix, ALWAYS pick from that list. Different states use different conventions (VA uses MTH and PSY, NY uses MATH and may have both PSY and PSYC, ME uses ENGL). If the user's subject is ambiguous, prefer the prefix that appears in the state's list. If no list is provided, default to the most common form.
- University names: use the alias table provided in the user message to resolve names and abbreviations to slugs. For universities not in the alias table, lowercase and hyphenate: "Smith College" → "smith". If the alias is ambiguous (e.g. multi-campus system with no campus specified), use the slug and lower your confidence.
- Age: parse numeric age from "65+", "60", "I'm 65", etc.
- Days: "weekend" → ["S", "U"]; "MWF" → ["M", "W", "F"]; "TR" or "Tu/Th" → ["T", "R"].
- Mode: "online", "in-person" (or "in person"), "hybrid", "zoom".
- Time of day: "morning", "afternoon", "evening".
- Term: capitalize like "Summer 2026", "Fall 2026". If only "summer" appears with no year, omit term (don't guess the year).
- Major: for pathway intent, extract the field of study as a lowercase hyphenated slug. "computer science" or "CS" → "computer-science", "nursing" → "nursing", "business administration" or "business" → "business", "liberal arts" → "liberal-arts". Null if no major mentioned.

Confidence rules:

- 0.95+ : Query unambiguously matches one intent with all key entities present.
- 0.80–0.94 : Intent clear, but one entity is missing or ambiguous (e.g. "Does ENG 111 transfer?" with no destination).
- 0.50–0.79 : Best-effort guess, multiple plausible interpretations.
- < 0.50 : Use "unknown" instead.

Multi-intent queries:

When the query contains TWO genuinely distinct intents, set the primary fields for the first/more-important one AND populate the "secondary" sub-object for the second. Pick the more answerable one as primary (typed answers like transfer/prereqs/eligibility beat course-search). Cap at 2 — if the query has 3+ asks, include only the top two.

EMIT secondary for:
- "What are the prereqs for ENG 111 and does it transfer to GMU?" → primary: prereqs (ENG 111), secondary: transfer (ENG 111 → gmu)
- "Transfer to GMU for CS, also what's the senior tuition policy?" → primary: pathway (gmu, CS), secondary: eligibility (senior)
- "Does ENG 111 transfer to UVA, and what are the prereqs?" → primary: transfer, secondary: prereqs

DO NOT emit secondary for:
- "Online evening ENG classes" → ONE course intent with filters, not two
- "Does ENG 111 transfer to GMU?" → ONE transfer intent
- "I'm at NOVA, does ENG 111 transfer?" → ONE transfer intent (sourceCollege captures NOVA separately)
- Anything where the second clause is a qualifier, not a separate question

Mixed supported + unsupported intents:

If the query mixes a SUPPORTED intent (transfer/pathway/prereqs/eligibility/course) with an UNSUPPORTED ask (instructor lookup, professor reviews, course ratings/difficulty, "easy A" judgments, schedule conflicts with another course, advisor questions), use the supported intent as PRIMARY and IGNORE the unsupported part. Do NOT bail to "unknown" just because part of the query is out of scope. Examples:

- "who teaches ENG 111 and where does it transfer" → primary: transfer (ENG 111). Ignore the instructor part. (NOT unknown.)
- "easy A math classes online" → primary: course (keyword: math, mode: online). Ignore the "easy A" judgment.
- "best professor for BIO 256 prereqs" → primary: prereqs (BIO 256). Ignore the professor part.
- "Rate my Professor for CSC 200 transfer" → primary: transfer (CSC 200). Ignore the rating part.

Only fall back to "unknown" when the query has NO supported intent at all (e.g., "good professors", "easy classes", "campus tour times").

Parsing caution — positive vs. negative constructions:

Students often write with awkward grammar, misspellings, or double-negatives. Parse the MEANING carefully:
- "courses that DO require prerequisites" → the student wants courses WITH prereqs.
- "courses that DON'T require prerequisites" → the student wants courses WITHOUT prereqs.
- "are there any courses that do require any pre requisit" → positive: courses WITH prereqs.
- "classes with no prereqs" → negative: courses WITHOUT prereqs.
Do NOT flip the meaning. If the student says "do require", they mean "do require" — not "don't require." Misspellings ("requisit", "prerequesites") do not change the meaning. Always reflect the student's actual intent accurately in student_summary.

Additional output fields:

- student_summary: Always provide a 1-2 sentence plain-English restatement of what the student is asking. Write as if addressing the student directly. Example: "You're asking whether ENG 111 transfers to George Mason."
- clarifying_question: When confidence < 0.85, suggest one specific follow-up question. Be specific ("Which university are you hoping to transfer to?"), not vague ("Can you clarify?"). Null when confidence >= 0.85.
- source_college: If the student names their community college ("I'm at NOVA", "from Bunker Hill CC"), extract it as a lowercase hyphenated slug. Otherwise null.
- suggested_followups: Provide 2-3 follow-up search queries the student could type into this search bar. Each must be a self-contained query, NOT a question directed at the student. Good: "Does ENG 111 transfer to VCU?", "Online ENG courses", "Prereqs for BIO 256". Bad: "Which university are you transferring to?", "Are you enrolled at a community college?", "Do you have writing experience?".

Always call the tool. Never produce conversational text.`;

/** Format a state's university aliases for injection into the user message. */
export function buildUniversityBlock(
  aliases: Array<{ slug: string; names: string[] }>,
): string {
  return aliases
    .map((a) => `- ${a.names.map((n) => `"${n}"`).join(" or ")} → "${a.slug}"`)
    .join("\n");
}

/**
 * Format a state's distinct subject prefixes for injection into the user
 * message. The classifier uses this list to pick the correct course-code
 * prefix for the state — VA uses PSY/MTH, ME uses ENGL/MATH, NY may have
 * both PSY and PSYC, etc. Without this, the LLM defaults to its own
 * normalization (PSYC, MATH) which often doesn't match the data.
 */
export function buildSubjectPrefixBlock(prefixes: string[]): string {
  return prefixes.join(", ");
}

// JSON-schema input for the classify_intent tool. Flat structure — fields
// only matter for the matching intent type. Conversion to the canonical
// SearchIntent discriminated union happens in classify-llm.ts.
export const CLASSIFY_TOOL = {
  name: "classify_intent",
  description: "Record the structured intent extracted from the user's search query.",
  input_schema: {
    type: "object" as const,
    properties: {
      type: {
        type: "string",
        enum: ["transfer", "pathway", "prereqs", "eligibility", "course", "unknown"],
        description: "Which of the six intent types this query falls into.",
      },
      // Course-related (used by transfer, prereqs, course)
      course_prefix: {
        type: ["string", "null"],
        description: "Uppercase subject prefix, e.g. ENG, MATH, PSYC. Extract even when course_number is null — for subject-level queries like 'English courses that transfer' set this to 'ENG'. Null only if no subject or course code appears in query.",
      },
      course_number: {
        type: ["string", "null"],
        description: "Course number as a string (preserve digits exactly), e.g. 111, 1001. Null if no specific course number in query (subject-level queries like 'math courses' leave this null).",
      },
      // Prereqs-specific
      prereq_direction: {
        type: ["string", "null"],
        enum: ["forward", "inverse", null],
        description: "For prereqs intent: 'forward' (default) = what do I need before this course? 'inverse' = what can I take after this course / what does it unlock? Null for non-prereqs intents.",
      },
      // Transfer-specific
      university: {
        type: ["string", "null"],
        description: "Target university slug, e.g. gmu, vcu, umass-amherst. Null if no destination mentioned.",
      },
      // Pathway-specific
      major: {
        type: ["string", "null"],
        description: "Major or field of study, lowercase hyphenated, e.g. 'computer-science', 'nursing', 'business'. Null if not specified.",
      },
      college: {
        type: ["string", "null"],
        description: "Community college slug for CC degree queries (e.g. 'nova', 'gcc', 'pvcc'). Use the source_college alias table to resolve names. Null for transfer pathway queries or when no college specified.",
      },
      credential: {
        type: ["string", "null"],
        enum: ["AA", "AS", "AAS", "certificate", null],
        description: "Degree type for CC degree queries: 'AA', 'AS', 'AAS', or 'certificate'. Null if not specified or for transfer pathway queries.",
      },
      // Eligibility-specific
      topic: {
        type: ["string", "null"],
        enum: ["senior", "audit", "cost", "veteran", null],
        description: "Eligibility topic. Null for non-eligibility intents.",
      },
      age: {
        type: ["integer", "null"],
        description: "Age extracted from query like '65+' or 'I'm 60'. Null if no age mentioned.",
      },
      // Course-with-filters
      keyword: {
        type: ["string", "null"],
        description: "Free-text remainder for course-keyword search, e.g. 'biology' from 'online biology'. Null if entire query was course code or filters.",
      },
      mode: {
        type: ["string", "null"],
        enum: ["in-person", "online", "hybrid", "zoom", null],
      },
      time_of_day: {
        type: ["string", "null"],
        enum: ["morning", "afternoon", "evening", null],
      },
      days: {
        type: "array",
        items: { type: "string", enum: ["M", "T", "W", "R", "F", "S", "U"] },
        description: "Empty array if no day filter. 'weekend' expands to [S, U].",
      },
      term: {
        type: ["string", "null"],
        description: "Term as 'Season YEAR' (e.g. 'Summer 2026'). Null if not specified or no year given.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Self-reported confidence per the rules in the system prompt.",
      },
      reasoning: {
        type: "string",
        description: "One-sentence explanation. Useful for debugging and eval reports.",
      },
      student_summary: {
        type: "string",
        description: "Always provide a 1-2 sentence plain-English restatement of what the student is asking. Write as if addressing the student directly. Example: \"You're asking whether ENG 111 transfers to George Mason.\"",
      },
      clarifying_question: {
        type: ["string", "null"],
        description: "When confidence < 0.85, suggest one specific follow-up question. Be specific ('Which university are you hoping to transfer to?'), not vague ('Can you clarify?'). Null when confidence >= 0.85.",
      },
      source_college: {
        type: ["string", "null"],
        description: "If the student names their community college ('I'm at NOVA', 'from Bunker Hill CC'), extract it as a lowercase hyphenated slug. Otherwise null.",
      },
      suggested_followups: {
        type: "array",
        items: { type: "string" },
        description: "Always provide 2-3 follow-up questions a student in this situation would naturally want to know next.",
      },
      // Optional secondary intent for queries with two genuinely distinct asks
      // (e.g., "prereqs for ENG 111 and does it transfer to GMU?"). Nested
      // sub-object — fewer fields than primary because secondaries are
      // typically simpler ("and the other thing"). Omit entirely or pass null
      // for single-intent queries (the common case).
      secondary: {
        type: ["object", "null"],
        properties: {
          type: {
            type: "string",
            enum: ["transfer", "pathway", "prereqs", "eligibility", "course", "unknown"],
          },
          course_prefix: { type: ["string", "null"] },
          course_number: { type: ["string", "null"] },
          university: { type: ["string", "null"] },
          topic: {
            type: ["string", "null"],
            enum: ["senior", "audit", "cost", "veteran", null],
          },
        },
        required: ["type"],
        description: "Secondary intent. Set ONLY when the query has TWO distinct intents (e.g., transfer + prereqs). Do NOT set for follow-up qualifiers ('online evening ENG' is one intent, not two). Null/omit for single-intent queries.",
      },
    },
    required: ["type", "confidence", "reasoning", "student_summary", "suggested_followups"],
  },
};

// Shape of the tool input we expect Claude to produce. Mirrors CLASSIFY_TOOL
// but expressed as a TS type for downstream conversion code.
export interface ClassifierToolInput {
  type: "transfer" | "pathway" | "prereqs" | "eligibility" | "course" | "unknown";
  course_prefix?: string | null;
  course_number?: string | null;
  prereq_direction?: "forward" | "inverse" | null;
  university?: string | null;
  major?: string | null;
  college?: string | null;
  credential?: string | null;
  topic?: "senior" | "audit" | "cost" | "veteran" | null;
  age?: number | null;
  keyword?: string | null;
  mode?: "in-person" | "online" | "hybrid" | "zoom" | null;
  time_of_day?: "morning" | "afternoon" | "evening" | null;
  days?: Array<"M" | "T" | "W" | "R" | "F" | "S" | "U">;
  term?: string | null;
  confidence: number;
  reasoning: string;
  student_summary: string;
  clarifying_question?: string | null;
  source_college?: string | null;
  suggested_followups?: string[];
  secondary?: ClassifierToolSecondary | null;
}

// Subset of fields used for secondary intents. Intentionally narrower than
// the primary — secondaries express "and the other thing", not full second-
// query power. Filters (mode/days/timeOfDay/term), age, and major are
// excluded because they're rarely useful in secondaries.
export interface ClassifierToolSecondary {
  type: "transfer" | "pathway" | "prereqs" | "eligibility" | "course" | "unknown";
  course_prefix?: string | null;
  course_number?: string | null;
  university?: string | null;
  topic?: "senior" | "audit" | "cost" | "veteran" | null;
}
