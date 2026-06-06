/**
 * Quick-add subject chips for the Smart Schedule Builder.
 *
 * Curated popularCourses prefixes come first — they highlight each state's
 * key transfer courses. Then the state's most-offered subjects from the
 * precomputed subject vocabulary fill out the breadth, so a student sees
 * Biology / English / Math / History instead of a sparse, SEO-tuned set.
 *
 * When no vocab exists for the state (Supabase-first states have no
 * data/{state}/subject-vocab.json), this returns exactly the popularCourses
 * prefixes — identical to the previous behavior, so there is no regression.
 */

/** Minimal structural shape of a loaded subject-vocab (see lib/programs/subject-vocab). */
interface SubjectVocabLike {
  subjects: { prefix: string }[];
}

/**
 * Build the quick-add chip list for a state: curated popularCourses prefixes
 * first, then the most-offered subjects from `vocab` (which is already sorted
 * by section_count descending), de-duplicated and capped at `limit`.
 */
export function quickAddSubjectsForState(
  vocab: SubjectVocabLike | null,
  popularCourses: string[],
  limit = 8
): string[] {
  const chips: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    // popularCourses entries are course codes ("ENG 111", "ENGL C1000");
    // vocab entries are bare prefixes ("BIO"). Take the leading token.
    const prefix = raw.split(" ")[0]?.trim().toUpperCase();
    if (!prefix || seen.has(prefix)) return;
    seen.add(prefix);
    chips.push(prefix);
  };

  // 1. Curated highlights first.
  for (const c of popularCourses) add(c);

  // 2. Fill remaining slots with the state's most-offered subjects.
  if (vocab) {
    for (const s of vocab.subjects) {
      if (chips.length >= limit) break;
      add(s.prefix);
    }
  }

  return chips.slice(0, limit);
}
