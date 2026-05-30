"use client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChainNode {
  course: string;
  text: string;
  children: ChainNode[];
}

// ---------------------------------------------------------------------------
// Tree utilities
// ---------------------------------------------------------------------------

function maxDepth(node: ChainNode): number {
  if (node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(maxDepth));
}

/** Flatten the tree into ordered levels (BFS). Each level is a set of
 *  courses you can take once all deeper levels are done. */
function buildLevels(node: ChainNode): { course: string; text: string }[][] {
  const levels: Map<string, { course: string; text: string }>[] = [];
  const seen = new Set<string>();

  function walk(n: ChainNode, depth: number) {
    // Avoid infinite loops from circular prereqs
    const key = `${n.course}@${depth}`;
    if (seen.has(n.course)) return;
    seen.add(n.course);

    // Ensure the level array exists
    while (levels.length <= depth) levels.push(new Map());

    levels[depth].set(n.course, { course: n.course, text: n.text });

    for (const child of n.children) {
      walk(child, depth + 1);
    }
  }

  // Walk children (skip root — that's the target course)
  for (const child of node.children) {
    walk(child, 0);
  }

  // Reverse so deepest prereqs (start courses) come first
  levels.reverse();

  return levels.map((m) => Array.from(m.values()));
}

// ---------------------------------------------------------------------------
// CSS keyframes
// ---------------------------------------------------------------------------

function FlowStyles() {
  return (
    <style>{`
      @keyframes flow {
        0%   { transform: translateX(-12px); opacity: 0; }
        50%  { opacity: 1; }
        100% { transform: translateX(24px); opacity: 0; }
      }
    `}</style>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function PrereqFlowChart({ tree }: { tree: ChainNode }) {
  if (tree.children.length === 0) return null;

  const depth = maxDepth(tree);
  const levels = buildLevels(tree);

  // If there's only one prereq with no further prereqs, show simple view
  if (depth === 1 && tree.children.length <= 3) {
    return (
      <div className="space-y-2">
        <FlowStyles />
        <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          Take {tree.children.length === 1 ? "this" : "these"} first:
        </p>
        <div className="flex flex-wrap gap-2">
          {tree.children.map((child) => (
            <div
              key={child.course}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-700/60 bg-emerald-50/80 dark:bg-emerald-900/30 px-3 py-1.5"
            >
              <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                {child.course}
              </span>
              {child.text && (
                <span className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70">
                  {child.text}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 pt-1">
          <svg className="w-3 h-3 text-slate-300 dark:text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
          </svg>
          <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
            Then take {tree.course}
          </span>
        </div>
      </div>
    );
  }

  // Multi-level: show step-by-step
  return (
    <div className="space-y-1">
      <FlowStyles />

      {/* Steps */}
      <ol className="relative space-y-0">
        {levels.map((level, i) => {
          const isFirst = i === 0;
          const stepNum = i + 1;
          const label = isFirst
            ? "Start here"
            : `Step ${stepNum}`;

          return (
            <li key={i} className="relative flex gap-3 pb-3">
              {/* Vertical line */}
              {i < levels.length - 1 && (
                <div className="absolute left-[11px] top-[24px] bottom-0 w-px bg-gradient-to-b from-slate-200 to-slate-100 dark:from-slate-600 dark:to-slate-700" />
              )}

              {/* Step indicator */}
              <div className="shrink-0 flex flex-col items-center">
                <div
                  className={`
                    flex items-center justify-center w-[23px] h-[23px] rounded-full text-[9px] font-black
                    ${isFirst
                      ? "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 ring-2 ring-emerald-200 dark:ring-emerald-700/60"
                      : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 ring-1 ring-slate-200 dark:ring-slate-600"
                    }
                  `}
                >
                  {stepNum}
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-0.5">
                <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                  {label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {level.map((item) => (
                    <div
                      key={item.course}
                      className={`
                        inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5
                        ${isFirst
                          ? "border-emerald-200 dark:border-emerald-700/60 bg-emerald-50/80 dark:bg-emerald-900/30"
                          : "border-slate-200 dark:border-slate-600/60 bg-white/80 dark:bg-slate-700/50"
                        }
                      `}
                    >
                      <span
                        className={`text-[11px] font-bold ${
                          isFirst
                            ? "text-emerald-700 dark:text-emerald-300"
                            : "text-slate-700 dark:text-slate-200"
                        }`}
                      >
                        {item.course}
                      </span>
                      {item.text && (
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate max-w-[150px]">
                          {item.text}
                        </span>
                      )}
                    </div>
                  ))}
                  {level.length > 1 && (
                    <span className="self-center text-[9px] font-medium text-slate-300 dark:text-slate-600 italic">
                      (take all)
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}

        {/* Final: Target course */}
        <li className="relative flex gap-3">
          <div className="shrink-0 flex flex-col items-center">
            <div className="flex items-center justify-center w-[23px] h-[23px] rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 ring-2 ring-amber-200 dark:ring-amber-700/60">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
          </div>
          <div className="flex-1 pt-0.5">
            <p className="text-[10px] font-semibold text-amber-500 dark:text-amber-400 uppercase tracking-wider mb-1.5">
              Ready
            </p>
            <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-600/60 bg-amber-50/80 dark:bg-amber-900/30 px-2.5 py-1.5">
              <span className="text-[11px] font-bold text-amber-700 dark:text-amber-200">
                {tree.course}
              </span>
              {tree.text && (
                <span className="text-[10px] text-amber-500 dark:text-amber-400/70 truncate max-w-[180px]">
                  {tree.text}
                </span>
              )}
            </div>
          </div>
        </li>
      </ol>
    </div>
  );
}
