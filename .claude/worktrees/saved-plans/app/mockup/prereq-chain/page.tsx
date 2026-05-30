"use client";

import PrereqChain from "@/components/PrereqChain";

/**
 * Standalone mockup page for the prerequisite chain visualization.
 * Uses real TN prereq data via the API — no Supabase needed.
 *
 * Visit: /mockup/prereq-chain
 */
export default function PrereqChainMockup() {
  const examples = [
    {
      course: "CHEM 1110",
      text: "ACT math score of at least 22 or MATH 1130 or MATH 1710 or MATH 1730",
      label: "Branching tree — Chemistry with 3 math paths",
    },
    {
      course: "ACCT 2322",
      text: "ACCT 2321",
      label: "Linear chain — 4 levels deep (ACCT 2322 → 2321 → 1020 → 1010)",
    },
    {
      course: "ACCT 1020",
      text: "ACCT 1010",
      label: "Simple — one direct prerequisite",
    },
    {
      course: "BIOL 2010",
      text: "ACT Reading score of 19 or satisfactory placement scores or completion of Learning Support Reading",
      label: "Test-score only — no course chain (no 'view chain' link)",
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Prerequisite Chain Visualization
        </h1>
        <p className="text-sm text-gray-500 dark:text-slate-400 mb-8">
          Click &quot;view chain&quot; on any badge to expand the full prerequisite
          dependency tree. Data sourced from Pellissippi State&apos;s TBR catalog.
        </p>

        <div className="space-y-8">
          {examples.map((ex) => (
            <div
              key={ex.course}
              className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-5"
            >
              {/* Mock course row header */}
              <div className="flex items-baseline gap-3 mb-3">
                <span className="font-semibold text-gray-900 dark:text-white">
                  {ex.course}
                </span>
                <span className="text-xs text-gray-500 dark:text-slate-400">
                  {ex.label}
                </span>
              </div>

              {/* The actual PrereqChain component */}
              <PrereqChain
                state="tn"
                course={ex.course}
                prereqText={ex.text}
              />
            </div>
          ))}
        </div>

        <p className="mt-10 text-xs text-gray-400 dark:text-slate-500 text-center">
          This page is a development mockup. The component is integrated into
          every course row on college detail pages and search results.
        </p>
      </div>
    </div>
  );
}
