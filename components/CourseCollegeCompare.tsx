"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  applyCompare,
  type CollegeCompareRow,
  type CompareSort,
} from "@/lib/compare-colleges";
import DataProvenanceNote from "@/components/DataProvenanceNote";

const MODE_PILL: Record<string, string> = {
  "in-person": "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
  online: "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
  hybrid: "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400",
  zoom: "bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400",
};
const MODE_LABEL: Record<string, string> = {
  "in-person": "In-person", online: "Online", hybrid: "Hybrid", zoom: "Zoom",
};

const SORTS: { value: CompareSort; label: string }[] = [
  { value: "availability", label: "Most availability" },
  { value: "soonest", label: "Soonest start" },
  { value: "sections", label: "Most sections" },
  { value: "name", label: "A–Z" },
];

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        on
          ? "bg-teal-600 text-white"
          : "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

export default function CourseCollegeCompare({
  rows,
  state,
  notOffered,
}: {
  rows: CollegeCompareRow[];
  state: string;
  /** Names of in-state colleges that don't offer this course this term. */
  notOffered: string[];
}) {
  const [sort, setSort] = useState<CompareSort>("availability");
  const [openOnly, setOpenOnly] = useState(false);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [eveningOnly, setEveningOnly] = useState(false);

  const visible = useMemo(
    () => applyCompare(rows, { sort, openOnly, onlineOnly, eveningOnly }),
    [rows, sort, openOnly, onlineOnly, eveningOnly],
  );

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          <Chip on={openOnly} onClick={() => setOpenOnly((v) => !v)}>Open seats</Chip>
          <Chip on={onlineOnly} onClick={() => setOnlineOnly((v) => !v)}>Online</Chip>
          <Chip on={eveningOnly} onClick={() => setEveningOnly((v) => !v)}>Evening</Chip>
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as CompareSort)}
            className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-medium text-gray-700 dark:text-slate-200 focus:border-teal-500 focus:outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 dark:bg-slate-800 text-[11px] uppercase tracking-wider text-gray-500 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2.5 font-medium">College</th>
              <th className="px-4 py-2.5 font-medium">Soonest section</th>
              <th className="px-4 py-2.5 font-medium">Seats</th>
              <th className="px-4 py-2.5 font-medium">Format</th>
              <th className="px-4 py-2.5 font-medium text-center">Sections</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500 dark:text-slate-400">
                  No colleges match these filters.
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr key={r.slug} className="hover:bg-gray-50 dark:hover:bg-slate-800/60">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/${state}/college/${r.slug}`}
                      className="font-medium text-gray-900 dark:text-slate-100 hover:text-teal-600 dark:hover:text-teal-400"
                    >
                      {r.name}
                    </Link>
                    {r.auditAllowed && (
                      <span className="ml-2 rounded-full bg-green-50 dark:bg-green-900/30 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
                        Audit OK
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-slate-300">{r.soonest}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`text-xs font-medium ${
                        r.hasOpen ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {r.seatLabel}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(r.modes)
                        .sort((a, b) => b[1] - a[1])
                        .map(([mode, n]) => (
                          <span
                            key={mode}
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${MODE_PILL[mode] ?? MODE_PILL["in-person"]}`}
                          >
                            {MODE_LABEL[mode] ?? mode} {n}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-center text-gray-500 dark:text-slate-400 tabular-nums">
                    {r.sectionCount}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <DataProvenanceNote>
        Seats and schedules are pulled automatically from each college&apos;s
        catalog and change in real time — confirm on the college&apos;s site
        before you register.
      </DataProvenanceNote>

      {notOffered.length > 0 && (
        <p className="mt-2 text-xs text-gray-400 dark:text-slate-500">
          Not offered this term at {notOffered.length} other{" "}
          {notOffered.length === 1 ? "college" : "colleges"}:{" "}
          {notOffered.slice(0, 6).join(", ")}
          {notOffered.length > 6 ? `, and ${notOffered.length - 6} more` : ""}.
        </p>
      )}
    </div>
  );
}
