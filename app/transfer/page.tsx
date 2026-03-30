import Link from "next/link";
import type { Metadata } from "next";
import { loadTransferMappings, getUniversities } from "@/lib/transfer";
import { loadAllCourses } from "@/lib/courses";
import { getCurrentTerm } from "@/lib/terms";
import TransferClient from "./TransferClient";

export const metadata: Metadata = {
  title: "Transfer Course Finder — Which VCCS Courses Transfer? | AuditMap Virginia",
  description:
    "Find which Virginia community college courses transfer to Virginia Tech, VCU, and other universities. See direct equivalencies, elective credit, and course availability.",
};

export default function TransferPage() {
  const universities = getUniversities();
  const defaultUni = universities[0]?.slug || "vt";
  // Pass ALL mappings — client filters by selected university
  const mappings = loadTransferMappings();

  // Get current course availability for cross-referencing
  const allCourses = loadAllCourses(getCurrentTerm());
  const courseAvailability: Record<string, { colleges: string[]; totalSections: number }> = {};
  for (const c of allCourses) {
    const key = `${c.course_prefix}-${c.course_number}`;
    if (!courseAvailability[key]) {
      courseAvailability[key] = { colleges: [], totalSections: 0 };
    }
    courseAvailability[key].totalSections++;
    if (!courseAvailability[key].colleges.includes(c.college_code)) {
      courseAvailability[key].colleges.push(c.college_code);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <Link
        href="/"
        className="text-sm text-teal-600 hover:text-teal-700 mb-6 inline-block"
      >
        &larr; Back to search
      </Link>

      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        Transfer Course Finder
      </h1>
      <p className="text-gray-600 mb-8">
        Find which VCCS courses transfer to your target university. See direct
        equivalencies, elective credit, and what&apos;s available this term.
      </p>

      <TransferClient
        universities={universities}
        mappings={mappings}
        courseAvailability={courseAvailability}
        defaultUniversity={defaultUni}
      />
    </div>
  );
}
