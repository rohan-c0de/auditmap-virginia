"use client";

import { useState } from "react";
import CourseTable from "@/components/CourseTable";
import AuditInstructions from "@/components/AuditInstructions";
import PrintInstructions from "@/components/PrintInstructions";
import ScheduleBuilder from "@/components/ScheduleBuilder";
import type { Institution, CourseSection } from "@/lib/types";

type TransferLookup = Record<
  string,
  { university: string; type: "direct" | "elective" | "no-credit"; course: string }[]
>;

interface Props {
  courses: CourseSection[];
  institution: Institution;
  collegeSlug: string;
  transferLookup?: TransferLookup;
  systemName?: string;
  courseListingUrl?: string;
}

export default function CollegeDetailClient({
  courses,
  institution,
  collegeSlug,
  systemName,
  transferLookup,
  courseListingUrl,
}: Props) {
  const [selectedCourse, setSelectedCourse] = useState<CourseSection | null>(
    null
  );
  const [showInstructions, setShowInstructions] = useState(false);
  const [pinnedCRNs, setPinnedCRNs] = useState<Set<string>>(new Set());

  function togglePin(crn: string) {
    setPinnedCRNs((prev) => {
      const next = new Set(prev);
      if (next.has(crn)) next.delete(crn);
      else next.add(crn);
      return next;
    });
  }

  return (
    <div>
      <CourseTable
        courses={courses}
        collegeSlug={collegeSlug}
        systemName={systemName}
        courseListingUrl={courseListingUrl}
        onAuditClick={(course) => {
          setSelectedCourse(course);
          setShowInstructions(true);
        }}
        pinnedCRNs={pinnedCRNs}
        onTogglePin={togglePin}
        transferLookup={transferLookup}
      />

      <ScheduleBuilder
        courses={courses}
        pinnedCRNs={pinnedCRNs}
        onTogglePin={togglePin}
      />

      {/* Audit instructions modal */}
      {showInstructions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 relative">
            <div className="absolute top-4 right-4 flex items-center gap-2">
              <PrintInstructions
                institution={institution}
                course={selectedCourse || undefined}
              />
              <button
                onClick={() => setShowInstructions(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            <AuditInstructions
              institution={institution}
              course={selectedCourse || undefined}
              defaultOpen={true}
            />
          </div>
        </div>
      )}
    </div>
  );
}
