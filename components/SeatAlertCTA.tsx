import Link from "next/link";

/**
 * Inline "get notified when a seat opens" CTA, shown on a course-detail page
 * when the course has full sections (see lib/seat-alert courseHasFullSection).
 *
 * Server-safe — a plain Link, no client hooks. It routes the course into the
 * planner via ?targets=, where the existing "Sign in to save" flow (anon→account
 * drain #1176, works logged-out) saves it; the plan-based seat-watch cron then
 * emails the user when a section of that course flips full→open
 * (profiles.seat_notifications_enabled defaults on). No per-section subscription
 * and no new backend — this is a bridge to the existing plan-based watcher.
 */
export default function SeatAlertCTA({
  state,
  courseCode,
}: {
  state: string;
  courseCode: string;
}) {
  const href = `/${state}/plan?targets=${encodeURIComponent(courseCode)}`;
  return (
    <div className="mb-8 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 px-4 py-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
      <div>
        <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">
          Some sections are full
        </p>
        <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">
          {`Save ${courseCode} to a plan and we'll email you when a seat opens — free, no spam.`}
        </p>
      </div>
      <Link
        href={href}
        className="mt-3 sm:mt-0 inline-flex shrink-0 items-center justify-center rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 transition whitespace-nowrap"
      >
        Get seat-open alerts
      </Link>
    </div>
  );
}
