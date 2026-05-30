"use client";

import Link from "next/link";
import SemesterPlanner from "@/components/SemesterPlanner";

interface PlannerClientProps {
  state: string;
  systemName?: string;
}

export default function PlannerClient({ state, systemName }: PlannerClientProps) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <Link
            href={`/${state}`}
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
          >
            &larr; Back to {systemName || "home"}
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Semester Planner
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-xl">
            Add the courses you want to take and the planner will automatically
            map out all prerequisites into a semester-by-semester sequence.
            Take courses in the listed order to satisfy all requirements.
          </p>
        </div>

        <SemesterPlanner state={state} />
      </main>
    </div>
  );
}
