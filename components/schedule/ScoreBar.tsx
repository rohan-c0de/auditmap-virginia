"use client";

import type { ScoreBreakdown } from "@/lib/types";

interface Props {
  breakdown: ScoreBreakdown;
  total: number;
  showTransfer?: boolean;
}

const SEGMENTS = [
  { key: "timeCompactness" as const, label: "Compactness", color: "bg-teal-400", max: 20 },
  { key: "distanceScore" as const, label: "Distance", color: "bg-blue-400", max: 20 },
  { key: "dayConsolidation" as const, label: "Days", color: "bg-amber-400", max: 20 },
  { key: "varietyScore" as const, label: "Variety", color: "bg-purple-400", max: 10 },
  { key: "seatAvailability" as const, label: "Seats", color: "bg-emerald-400", max: 15 },
  { key: "transferScore" as const, label: "Transfer", color: "bg-rose-400", max: 15 },
] as const;

export default function ScoreBar({ breakdown, total, showTransfer = true }: Props) {
  const visibleSegments = SEGMENTS.filter((seg) => {
    if (seg.key === "transferScore" && !showTransfer) return false;
    return true;
  });

  return (
    <div className="space-y-1">
      {/* Stacked bar */}
      <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 dark:bg-slate-700">
        {visibleSegments.map((seg) => {
          const value = breakdown[seg.key];
          const pct = (value / 100) * 100;
          return (
            <div
              key={seg.key}
              className={seg.color}
              style={{ width: `${pct}%` }}
              title={`${seg.label}: ${value}/${seg.max}`}
            />
          );
        })}
      </div>

      {/* Labels */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500 dark:text-slate-400">
        {visibleSegments.map((seg) => (
          <span key={seg.key} className="flex items-center gap-1">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${seg.color}`} />
            {seg.label} {breakdown[seg.key]}
          </span>
        ))}
      </div>
    </div>
  );
}
