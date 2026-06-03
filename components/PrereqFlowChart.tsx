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

/**
 * Orthogonal connector: exit the prerequisite's right edge, run vertically at
 * `jogX`, then enter the dependent's left edge horizontally — so the
 * (orient=auto) arrowhead always sits on a left→right segment and points
 * forward, however tall the jump. `jogX` is assigned per edge so that two
 * connectors leaving the same column don't stack in one vertical channel.
 */
function connector(x1: number, y1: number, x2: number, y2: number, jogX: number): string {
  if (Math.abs(y2 - y1) < 2) return `M ${x1} ${y1} H ${x2}`;
  const gap = x2 - x1;
  if (gap < 6) return `M ${x1} ${y1} L ${x2} ${y2}`; // too tight for a clean elbow
  const r = Math.max(2, Math.min(7, (gap - 2) / 2, Math.abs(y2 - y1) / 2));
  const jog = Math.min(Math.max(jogX, x1 + r), x2 - r); // keep both corners in the gap
  const down = y2 >= y1 ? 1 : -1;
  return (
    `M ${x1} ${y1} H ${jog - r}` +
    ` Q ${jog} ${y1} ${jog} ${y1 + down * r}` +
    ` V ${y2 - down * r}` +
    ` Q ${jog} ${y2} ${jog + r} ${y2}` +
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

    // Pass 1: endpoints.
    type Seg = { key: string; from: string; to: string; type: EdgeType; x1: number; y1: number; x2: number; y2: number };
    const segs: Seg[] = [];
    for (const e of graph.edges) {
      const a = nodeRefs.current.get(e.from);
      const b = nodeRefs.current.get(e.to);
      if (!a || !b) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      segs.push({
        key: `${e.from}|${e.to}`, from: e.from, to: e.to, type: e.type,
        x1: ra.right - cb.left,
        y1: ra.top - cb.top + ra.height / 2,
        x2: rb.left - cb.left - 6, // leave room for the arrowhead
        y2: rb.top - cb.top + rb.height / 2,
      });
    }

    // Pass 2: give each vertical-jog connector its own channel within the gap
    // to the right of its source column, so two jogs from the same column don't
    // overlap into one line. Straight (same-row) connectors need no channel.
    const byColumn = new Map<number, Seg[]>();
    for (const s of segs) {
      if (Math.abs(s.y1 - s.y2) <= 2) continue;
      const key = Math.round(s.x1);
      const list = byColumn.get(key);
      if (list) list.push(s);
      else byColumn.set(key, [s]);
    }
    const jogX = new Map<string, number>();
    for (const [, list] of byColumn) {
      list.sort((p, q) => p.y1 + p.y2 - (q.y1 + q.y2));
      list.forEach((s, i) => jogX.set(s.key, s.x1 + 12 + i * 9));
    }

    const next: Wire[] = segs.map((s) => ({
      key: s.key, from: s.from, to: s.to, type: s.type,
      d: connector(s.x1, s.y1, s.x2, s.y2, jogX.get(s.key) ?? s.x1 + 12),
    }));
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
          className="relative inline-flex items-stretch gap-12 pt-3"
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
                  data-from={w.from}
                  data-to={w.to}
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
