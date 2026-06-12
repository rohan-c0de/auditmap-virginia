/**
 * Pipeline dedup for transfer-equivalency scrapers.
 *
 * Why this exists: several receiver portals return the SAME statewide
 * articulation table once per sending college. NC mappings carry no
 * sending-college field (the NCCCS common course library shares course codes
 * across all 58 colleges), so a per-college scrape loop appends one copy of
 * every row PER COLLEGE — Elon's ASP.NET form produced 50 identical
 * "PSY 150 → PSY*1000" rows and /nc/course/psy-150 rendered all 50.
 *
 * Every scrape-transfer-* merge step must pass its final array through this
 * helper before writing transfer-equiv.json, so new receiver scrapers inherit
 * the fix instead of re-introducing the bug.
 *
 * The key deliberately EXCLUDES title and credit strings: two rows that differ
 * only in title casing or a ".0" credit suffix state the same articulation
 * fact, and keeping both would just re-render as a visual duplicate.
 * Legitimate one-to-many mappings (one CC course → several DISTINCT university
 * courses) survive because univ_course is part of the key. First occurrence
 * wins, so input order is preserved.
 */
export function dedupeTransferMappings<
  T extends {
    cc_course: string;
    university: string;
    univ_course: string;
    notes?: string | null;
    no_credit?: boolean | null;
    is_elective?: boolean | null;
  },
>(mappings: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const m of mappings) {
    const key = [
      m.cc_course,
      m.university,
      m.univ_course,
      m.notes ?? "",
      m.no_credit ? 1 : 0,
      m.is_elective ? 1 : 0,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}
