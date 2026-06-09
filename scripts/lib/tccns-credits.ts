/**
 * Texas Common Course Numbering System (TCCNS) credit-hour inference.
 *
 * Every TX public college numbers academic courses with a 4-digit code whose
 * SECOND digit is the number of semester credit hours:
 *   ENGL 1301 → 3, BIOL 1406 → 4, PHED 1101 → 1, MATH 2412 → 4.
 * (First digit = level: 1 freshman, 2 sophomore.)
 *
 * Use this ONLY as a fallback when a scraper's source omits credit hours
 * (some schedule views / PDFs / portals don't publish them). It returns 0 —
 * meaning "unknown, leave as-is" — for anything that doesn't cleanly follow
 * the convention, so it never invents a wrong value:
 *   - developmental courses (level 0, e.g. MATH 0314) are institutional-credit
 *     only and don't encode SCH in the digit → 0
 *   - a second digit outside 1–6 (0, 7, 8, 9 = variable/contact-hour courses) → 0
 *   - numbers that aren't exactly 4 digits (optionally + a section letter) → 0
 *
 * Never overwrite a real credit value with this; callers should only apply it
 * when the scraped credits are 0/missing.
 */
export function inferTccnsCredits(courseNumber: string | number): number {
  const m = String(courseNumber ?? "")
    .trim()
    .match(/^(\d)(\d)\d{2}(?:[A-Za-z]+)?$/);
  if (!m) return 0;
  const level = m[1];
  const sch = Number(m[2]);
  if (level === "0") return 0; // developmental — not credit-bearing per the digit
  if (sch >= 1 && sch <= 6) return sch;
  return 0;
}
