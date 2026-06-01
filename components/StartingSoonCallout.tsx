import Link from "next/link";
// Pre-built per-state aggregate of "sections starting in the next 14 days,"
// regenerated on every Vercel build by
// scripts/build-starting-soon-snapshot.ts. The previous version called
// `loadAllCourses(currentTerm, state)` server-side here — a paginated
// Supabase fetch of the full state catalog. Rendered inside every state
// landing page during static generation, that saturated the free-tier
// pool and tripped Vercel's 60s per-page budget (the symptom was
// "Failed to build /[state]/page: /va after 3 attempts.")
import startingSoonJson from "@/data/starting-soon.json";

interface StartingSoonSnapshot {
  _generatedAt: string;
  windowDays: number;
  perState: Record<string, { uniqueCourses: number; uniqueColleges: number }>;
}

const SNAPSHOT: StartingSoonSnapshot = (startingSoonJson as unknown as StartingSoonSnapshot) ?? {
  _generatedAt: "",
  windowDays: 14,
  perState: {},
};

export default async function StartingSoonCallout({ state }: { state: string }) {
  const entry = SNAPSHOT.perState[state];
  if (!entry || entry.uniqueCourses === 0) return null;

  const { uniqueCourses, uniqueColleges } = entry;

  return (
    <Link
      href={`/${state}/starting-soon`}
      className="group block rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/30 px-5 py-4 mt-8 transition hover:border-teal-300 hover:bg-teal-100/60 dark:hover:bg-teal-900/50"
    >
      <div className="flex items-center gap-3">
        <div className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/50 text-teal-600 dark:text-teal-400 group-hover:bg-teal-200 dark:group-hover:bg-teal-800 transition">
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-teal-900 dark:text-teal-200">
            <span className="font-bold">{uniqueCourses}</span>{" "}
            {uniqueCourses === 1 ? "course" : "courses"} starting in the next 2
            weeks across{" "}
            <span className="font-bold">{uniqueColleges}</span>{" "}
            {uniqueColleges === 1 ? "college" : "colleges"}
          </p>
          <p className="text-xs text-teal-700 dark:text-teal-400 group-hover:text-teal-800 dark:group-hover:text-teal-300 transition">
            Browse upcoming late-start and mini-session courses &rarr;
          </p>
        </div>
      </div>
    </Link>
  );
}
