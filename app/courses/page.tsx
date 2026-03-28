import type { Metadata } from "next";
import CourseSearchClient from "./CourseSearchClient";

export const metadata: Metadata = {
  title: "Find a Course — Search All 23 VCCS Colleges | AuditMap Virginia",
  description:
    "Search for courses across all 23 Virginia community colleges at once. Find the best schedule, location, and format for auditing.",
};

export default function CoursesPage() {
  return <CourseSearchClient />;
}
