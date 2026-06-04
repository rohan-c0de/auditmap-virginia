/**
 * Pure helpers for the account data-export + account-deletion endpoints.
 * Kept separate from the route handlers so they can be unit-tested without a
 * Supabase client or a request.
 */

/**
 * Escape a literal string for safe use in a Postgres ILIKE pattern, so that
 * `%`, `_`, and `\` inside (e.g.) an email address are matched literally rather
 * than as wildcards. Used to match the email-keyed `subscribers` rows
 * case-insensitively for both export and account-deletion cleanup.
 */
export function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export interface AccountExportInput {
  user: { id: string; email: string | null };
  profile: unknown;
  savedPlans: unknown[];
  savedSchedules: unknown[];
  savedCourses: unknown[];
  savedTransfers: unknown[];
  seatNotifications: unknown[];
  emailSubscriptions: unknown[];
}

/**
 * Assemble a user's data into a single, stable, downloadable object. Pure: the
 * timestamp is passed in so the result is deterministic and unit-testable.
 */
export function buildAccountExport(input: AccountExportInput, exportedAt: string) {
  return {
    format: "ccp-account-export",
    version: 1,
    exportedAt,
    account: input.user,
    profile: input.profile ?? null,
    savedPlans: input.savedPlans ?? [],
    savedSchedules: input.savedSchedules ?? [],
    savedCourses: input.savedCourses ?? [],
    savedTransfers: input.savedTransfers ?? [],
    seatNotifications: input.seatNotifications ?? [],
    emailSubscriptions: input.emailSubscriptions ?? [],
  };
}
