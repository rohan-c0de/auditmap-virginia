/**
 * semantic-match.ts — stem-aware lexical matching of free-text major terms
 * against program titles.
 *
 * Phase 2 of the major-resolution effort (see #228 follow-up). The previous
 * approach (`title.toLowerCase().includes(rawNeedle)`) failed on stem
 * variants — e.g. searching "geography" missed "Geographic Information
 * Systems" because no title literally contains "geography". We can't
 * enumerate every variant in regex rules; we need a structural matcher.
 *
 * The strategy here is intentionally simple: stem each word to a
 * lowercase prefix (first 5 chars for words ≥6 chars long, the whole word
 * otherwise). Two words match if they share the same stem prefix. This
 * catches the common -y/-ic/-ical/-ing/-tion/-al/-s morphology variations
 * without pulling in a full Porter stemmer:
 *
 *   geography  → "geogr"   ↔   geographic  → "geogr"   ✓
 *   biology    → "biolo"   ↔   biological  → "biolo"   ✓
 *   history    → "histo"   ↔   historical  → "histo"   ✓
 *   chemistry  → "chemi"   ↔   chemical    → "chemi"   ✓
 *   computer   → "compu"   ↔   computers   → "compu"   ✓
 *
 * For multi-word majors ("computer science"), ALL stems must appear in
 * the title — that prevents false positives like "Communication Science"
 * matching "computer science".
 *
 * What this is NOT:
 *   - A stemmer that handles every English suffix (good — too aggressive
 *     stemming creates more false positives than it fixes).
 *   - A synonym layer ("law" → Criminal Justice). That's Phase 3 — an
 *     LLM call seeded with subject-vocab.json.
 */

const FILLER_TOKENS = new Set([
  "and",
  "or",
  "of",
  "the",
  "for",
  "to",
  "in",
  "on",
  "at",
  "with",
  "from",
  "into",
  "an",
  "a",
  "as",
  "by",
]);

const MIN_TOKEN_LEN = 3;
const STEM_PREFIX_LEN = 5;

/**
 * Lowercase a single word and trim non-alpha. Returns "" if nothing left.
 */
function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Reduce a word to a stem prefix:
 *   - lowercase, alpha-only
 *   - first STEM_PREFIX_LEN chars when the word is long enough to plausibly
 *     have suffix variation; otherwise the whole word
 *
 * For our matching purposes the goal isn't a "real" linguistic stem, just
 * a string that's stable across common English morphology variants.
 */
export function stemPrefix(word: string): string {
  const w = normalizeWord(word);
  if (w.length === 0) return "";
  if (w.length <= STEM_PREFIX_LEN) return w;
  return w.slice(0, STEM_PREFIX_LEN);
}

/**
 * Tokenize free text into significant lowercase words: drops fillers,
 * drops anything shorter than MIN_TOKEN_LEN. Returns words in original
 * order, no deduplication.
 */
export function tokenize(text: string): string[] {
  return text
    .split(/[^A-Za-z]+/)
    .map(normalizeWord)
    .filter((w) => w.length >= MIN_TOKEN_LEN && !FILLER_TOKENS.has(w));
}

/**
 * Set of stem prefixes for a piece of text (deduped).
 */
export function stemSet(text: string): Set<string> {
  const stems = new Set<string>();
  for (const t of tokenize(text)) {
    const s = stemPrefix(t);
    if (s) stems.add(s);
  }
  return stems;
}

/**
 * Two stems "match" if one is a prefix of the other. Equal stems trivially
 * match. We require the shorter side to be ≥ MIN_PREFIX_OVERLAP chars
 * (4) before allowing an asymmetric prefix match — otherwise 3-char
 * tokens like "art"/"law"/"med" over-match into "artificial"/"lawyer"/
 * "medical" and corrupt results when the slug match misses for an
 * unrelated reason.
 */
const MIN_PREFIX_OVERLAP = 4;

function stemsOverlap(a: string, b: string): boolean {
  if (a === b) return a.length > 0;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < MIN_PREFIX_OVERLAP) return false;
  return longer.startsWith(shorter);
}

function haystackContainsStem(haystack: Set<string>, needle: string): boolean {
  for (const h of haystack) {
    if (stemsOverlap(h, needle)) return true;
  }
  return false;
}

/**
 * Does `title` match `majorTerm` via stem-prefix overlap?
 *
 *   - Single-word major: at least one haystack stem must overlap the
 *     needle stem.
 *   - Multi-word major: ALL needle stems must overlap *some* haystack
 *     stem (prevents "Communication Science" matching "computer science").
 *
 * Returns false on empty inputs.
 */
export function titleMatchesMajor(title: string, majorTerm: string): boolean {
  const needles = stemSet(majorTerm);
  if (needles.size === 0) return false;
  const haystack = stemSet(title);
  if (haystack.size === 0) return false;
  for (const n of needles) {
    if (!haystackContainsStem(haystack, n)) return false;
  }
  return true;
}
