"use client";

import dynamic from "next/dynamic";

const CourseTable = dynamic(() => import("./CourseTable"), {
  ssr: false,
  loading: () => (
    <div>
      <div className="mb-4 h-[72px] animate-pulse rounded-lg bg-gray-100 dark:bg-slate-800" />
      <div className="h-[600px] animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-900" />
    </div>
  ),
});

export default CourseTable;
