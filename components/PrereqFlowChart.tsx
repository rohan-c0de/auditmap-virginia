"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChainNode } from "@/lib/prereqs";
import { buildPrereqGraph, chainOf, formatCourseCode, type EdgeType } from "./prereqGraph";
import DataProvenanceNote from "./DataProvenanceNote";

// Wires are shown at rest so the structure reads without interaction; below
// this node count they're near-solid, above it they soften so a big chain
// isn't a thicket. Hover always brightens just the hovered course's chain.
const SMALL_CHAIN = 8;

interface Wire {
  key: string;
  from: string;
  to: string;
  type: EdgeType;
  d: string;
}

/** Orthogonal elbow with rounded corners, prereq (right edge) → dependent (left edge). */
function elbow(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(y2 - y1) < 2) return `M ${x1} ${y1} H ${x2}`;
  const midx = x1 + Math.max(16, (x2 - x1) * 0.5);
  const r = 7;
  const down = y2 >= y1 ? 1 : -1;
  return (
    `M ${x1} ${y1} H ${midx - r}` +
    ` Q ${midx} ${y1} ${midx} ${y1 + down * r}` +
    ` V ${y2 - down * r}` +
    ` Q ${midx} ${y2} ${midx + r} ${y2}` +
    ` H ${x2}`
  );
}

function columnLabel(col: number, columnCount: number): string {
  if (col === 0) return "Take first";
  if (col === columnCount - 1) return "Ready for";
  return "Then";
}

export default function PrereqFlowChart({ tree }: { tree: ChainNode }) {
  const graph = useMemo(() => buildPrereqGraph(tree), [tree]);
  const uid = useId().replace(/:/g, "");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [wires, setWires] = useState<Wire[]>([]);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [focused, setFocused] = useState<string | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cb = container.getBoundingClientRect();
    const next: Wire[] = [];
    for (const e of graph.edges) {
      const a = nodeRefs.current.get(e.from);
      const b = nodeRefs.current.get(e.to);
      if (!a || !b) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const x1 = ra.right - cb.left;
      const y1 = ra.top - cb.top + ra.height / 2;
      const x2 = rb.left - cb.left - 6; // leave room for the arrowhead
      const y2 = rb.top - cb.top + rb.height / 2;
      next.push({ key: `${e.from}|${e.to}`, from: e.from, to: e.to, type: e.type, d: elbow(x1, y1, x2, y2) });
    }
    setWires(next);
    setDims({ w: cb.width, h: cb.height });
  }, [graph]);

  // Measure after layout (rAF so it runs post-paint, not synchronously in the
  // effect), on container resize, and once fonts settle (which shifts card
  // sizes). All measure() calls are async here, so no cascading-render churn.
  useEffect(() => {
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (!cancelled) measure();
    });
    const container = containerRef.current;
    const ro =
      container && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => measure())
        : null;
    ro?.observe(container!);
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) measure();
      });
    }
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [measure]);

  const columns = useMemo(() => {
    const cols: (typeof graph.nodes)[] = Array.from({ length: graph.columnCount }, () => []);
    for (const n of graph.nodes) cols[n.column]?.push(n);
    return cols;
  }, [graph]);

  const lit = useMemo(
    () => (focused ? chainOf(focused, graph.edges) : null),
    [focused, graph.edges],
  );

  // No course prereqs to draw (e.g. all were test-score / term tokens).
  if (graph.nodes.length <= 1 || graph.edges.length === 0) return null;

  const baseWireOpacity = graph.nodes.length <= SMALL_CHAIN ? 0.9 : 0.45;

  return (
    <div>
      <style>{`
        .prq-${uid}{--prq-req:#0d9488;--prq-or:#94a3b8;}
        :where(.dark) .prq-${uid}{--prq-req:#2dd4bf;--prq-or:#64748b;}
      `}</style>

      <div className={`prq-${uid} overflow-x-auto`}>
        <div
          ref={containerRef}
          className="relative inline-flex items-stretch gap-7 pt-3"
          style={{ minWidth: "min-content" }}
        >
          {/* Connector overlay — decorative; the ordered columns below carry the meaning. */}
          <svg
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={dims.w}
            height={dims.h}
            viewBox={`0 0 ${dims.w} ${dims.h}`}
            aria-hidden="true"
          >
            <defs>
              <marker id={`req-${uid}`} viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="5.5" markerHeight="5.5" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" style={{ fill: "var(--prq-req)" }} />
              </marker>
              <marker id={`or-${uid}`} viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="5.5" markerHeight="5.5" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" style={{ fill: "var(--prq-or)" }} />
              </marker>
            </defs>
            {wires.map((w) => {
              const isOr = w.type === "or";
              const opacity = lit
                ? lit.has(w.from) && lit.has(w.to)
                  ? 1
                  : 0.06
                : baseWireOpacity;
              return (
                <path
                  key={w.key}
                  d={w.d}
                  fill="none"
                  style={{ stroke: isOr ? "var(--prq-or)" : "var(--prq-req)" }}
                  strokeWidth={isOr ? 1.6 : 2.2}
                  strokeLinejoin="round"
                  strokeDasharray={isOr ? "5 5" : undefined}
                  markerEnd={`url(#${isOr ? "or" : "req"}-${uid})`}
                  opacity={opacity}
                />
              );
            })}
          </svg>

          {columns.map((col, ci) => (
            <ol key={ci} className="relative z-10 m-0 flex list-none flex-col gap-2.5 p-0">
              <li className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {columnLabel(ci, graph.columnCount)}
              </li>
              {col.map((node) => {
                const dim = lit ? !lit.has(node.code) : false;
                const tone = node.isRoot
                  ? "border-amber-300 bg-amber-50 dark:border-amber-600/60 dark:bg-amber-900/30"
                  : node.isLeaf
                    ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-700/60 dark:bg-emerald-900/30"
                    : "border-slate-200 bg-white dark:border-slate-600/60 dark:bg-slate-700/50";
                const codeTone = node.isRoot
                  ? "text-amber-800 dark:text-amber-200"
                  : node.isLeaf
                    ? "text-emerald-700 dark:text-emerald-300"
                    : "text-slate-700 dark:text-slate-200";
                return (
                  <li key={node.code}>
                    <button
                      type="button"
                      ref={(el) => {
                        const m = nodeRefs.current;
                        if (el) m.set(node.code, el);
                        else m.delete(node.code);
                      }}
                      onMouseEnter={() => setFocused(node.code)}
                      onMouseLeave={() => setFocused(null)}
                      onFocus={() => setFocused(node.code)}
                      onBlur={() => setFocused(null)}
                      className={`flex w-full items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left transition-opacity ${tone} ${dim ? "opacity-30" : "opacity-100"}`}
                    >
                      <span className={`text-[11px] font-bold ${codeTone}`}>{formatCourseCode(node.code)}</span>
                      {node.isRoot && (
                        <svg className="h-3 w-3 shrink-0 text-amber-500 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          ))}
        </div>
      </div>

      <DataProvenanceNote>
        Prerequisites are pulled automatically from the college catalog — confirm
        with an advisor before you register.
      </DataProvenanceNote>
    </div>
  );
}
