/**
 * prereq-sanitize.ts — HTML/entity cleanup for prerequisite entries.
 *
 * Course scrapers sometimes deliver prerequisite_text with raw markup
 * (NC sections carry ",<br>" separators; NY catalog text arrives as full
 * "<p>…</p>" change-log prose) and prerequisite_courses arrays polluted
 * with effective-term tokens ("FALL 2023"). The aggregator
 * (scripts/lib/aggregate-prereqs.ts) used to copy both verbatim, so any
 * data-only cleanup (PR #973) was reverted by the next prereqs cron tick.
 * Sanitizing here — at the point entries are built — is the durable fix.
 */

/** Tags that read as separators between requirement clauses. */
const SEPARATOR_TAG = /<\s*(?:br|\/p|\/li|\/div|\/tr)\s*\/?\s*>/gi;

/** Month / season + 4-digit year — an effective-term stamp, not a course. */
const TERM_TOKEN =
  /^(?:FALL|SPRING|SUMMER|WINTER|JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUNE?|JULY?|AUG(?:UST)?|SEPT?(?:EMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s+(?:19|20)\d{2}$/;

function decodeEntities(s: string): string {
  return (
    s
      .replace(/&nbsp;?/gi, " ")
      .replace(/&#160;?/g, " ")
      .replace(/&#(\d+);?/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      // Second pass: double-encoded "&amp;nbsp;" only becomes "&nbsp;"
      // after the &amp; decode above (seen in WA acalog catalogs).
      .replace(/&nbsp;?/gi, " ")
      .replace(/&#160;?/g, " ")
      .replace(/ /g, " ")
  );
}

/**
 * Strip markup from prerequisite text. Block/line-break tags become "; "
 * so multi-clause requirements stay readable ("Take BTB-102 …; Take
 * BTB-101 …"); every other tag is dropped outright.
 */
export function sanitizePrereqText(raw: string): string {
  if (!raw) return "";
  let text = raw
    // Punctuation immediately before a separator tag would double up once
    // the tag becomes "; " ("…course.,<br>Take…" → "…course.; Take…") —
    // drop it so the separator stands alone.
    .replace(/\s*[.,;]+\s*(?=<\s*(?:br|\/p|\/li|\/div|\/tr)\b)/gi, "")
    .replace(SEPARATOR_TAG, "; ")
    .replace(/<[^>]+>/g, " ");
  text = decodeEntities(text)
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*(?:;\s*)+/g, "; ") // collapse ";  ;" runs
    .replace(/^[\s;,.]+|[\s;,]+$/g, "")
    .trim();
  return text;
}

/** True when sanitizing would change anything markup-related. */
export function hasMarkup(raw: string): boolean {
  return /<[a-z/!]|&[a-z]+;|&#\d+;?/i.test(raw);
}

/**
 * Pull "PREFIX NUMBER" course codes out of (already sanitized) prereq
 * text. Handles hyphenated forms ("BTB-102" → "BTB 102") and common-
 * course-numbering "&" suffixes. Term stamps ("FALL 2023") are excluded.
 */
export function extractCourseCodes(text: string): string[] {
  const out = new Set<string>();
  const re = /\b([A-Z]{2,6}&?)[-\s]+(\d{1,4}[A-Z]{0,2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const code = `${m[1]} ${m[2]}`;
    if (TERM_TOKEN.test(code)) continue;
    out.add(code);
  }
  return Array.from(out).sort();
}

/** Drop non-course tokens (effective-term stamps) from a courses array. */
export function sanitizeCourseList(courses: string[]): string[] {
  return courses.filter((c) => !TERM_TOKEN.test(c.trim().toUpperCase()));
}

/**
 * Sanitize one prereq entry. When the original text carried markup, the
 * upstream scraper's course extraction usually missed codes hidden behind
 * tags (NC's 8 ",<br>" entries all had empty courses[]) — in that case the
 * cleaned text is re-mined and unioned in. Clean-text entries keep their
 * scraper-provided courses untouched (minus term-stamp junk) so this never
 * perturbs the 99% of entries that were already fine.
 */
export function sanitizePrereqEntry(
  text: string,
  courses: string[],
): { text: string; courses: string[] } {
  const dirty = hasMarkup(text);
  const cleanText = dirty ? sanitizePrereqText(text) : text;
  let cleanCourses = sanitizeCourseList(courses);
  if (dirty) {
    cleanCourses = Array.from(
      new Set([...cleanCourses, ...extractCourseCodes(cleanText)]),
    ).sort();
  }
  return { text: cleanText, courses: cleanCourses };
}
