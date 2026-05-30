"use client";

import { useState, useCallback } from "react";
import PrereqFlowChart from "./PrereqFlowChart";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChainNode {
  course: string;
  text: string;
  children: ChainNode[];
}

interface PrereqChainProps {
  /** State slug for the API call (e.g., "tn", "de") */
  state: string;
  /** Course code (e.g., "CHEM 1110") */
  course: string;
  /** Human-readable prereq text already displayed on the badge */
  prereqText: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * PrereqChain renders an expandable prerequisite dependency tree.
 *
 * When collapsed, it shows the standard amber "Requires: ..." badge.
 * When the user clicks "View chain", it fetches the full prereq tree
 * from /api/[state]/prereqs/chain and renders an indented tree view.
 */
export default function PrereqChain({
  state,
  course,
  prereqText,
}: PrereqChainProps) {
  const [expanded, setExpanded] = useState(false);
  const [tree, setTree] = useState<ChainNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChain = useCallback(async () => {
    if (tree) {
      setExpanded(!expanded);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/${state}/prereqs/chain?course=${encodeURIComponent(course)}`,
      );
      if (!res.ok) throw new Error("Failed to load");
      const data: ChainNode = await res.json();
      setTree(data);
      setExpanded(true);
    } catch {
      setError("Could not load prereq chain");
    } finally {
      setLoading(false);
    }
  }, [state, course, tree, expanded]);

  // Check if the course has any parseable prereq courses (not just test scores)
  const hasCoursePrereqs = tree
    ? tree.children.length > 0
    : /[A-Z]{2,5}\s+\d{3,4}/.test(prereqText);

  return (
    <div>
      {/* Badge row */}
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:border-amber-800">
          <svg
            className="h-2.5 w-2.5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          Requires: {prereqText}
        </span>

        {/* "View chain" button — only show if the prereq references actual courses */}
        {hasCoursePrereqs && (
          <button
            onClick={fetchChain}
            className="text-[10px] text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200 underline underline-offset-2 decoration-dotted"
          >
            {loading ? (
              <span className="inline-flex items-center gap-1">
                <svg className="h-2.5 w-2.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                </svg>
                loading...
              </span>
            ) : expanded ? (
              "hide chain"
            ) : (
              "view chain"
            )}
          </button>
        )}
      </div>

      {/* Expanded flowchart */}
      {expanded && tree && (
        <div className="mt-2 rounded-lg bg-slate-50/80 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 p-3">
          {tree.children.length === 0 ? (
            <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">
              {/[A-Z]{2,5}\s+\d{3,4}/.test(prereqText)
                ? "No deeper chain data available — see prerequisites listed above."
                : "No course prerequisites in the chain (test scores or placement only)"}
            </p>
          ) : (
            <PrereqFlowChart tree={tree} />
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <p className="mt-1 text-[10px] text-red-500">{error}</p>
      )}
    </div>
  );
}
