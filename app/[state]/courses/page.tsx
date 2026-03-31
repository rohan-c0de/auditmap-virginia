import type { Metadata } from "next";
import CourseSearchClient from "./CourseSearchClient";
import { getStateConfig } from "@/lib/states/registry";

type Props = {
  params: Promise<{ state: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  const config = getStateConfig(state);
  return {
    title: `Find a Course — Search All ${config.collegeCount} ${config.systemName} Colleges | ${config.branding.siteName}`,
    description: `Search for courses across all ${config.collegeCount} ${config.name} community colleges at once. Find the best schedule, location, and format for auditing.`,
  };
}

export default async function CoursesPage({ params }: Props) {
  const { state } = await params;
  const config = getStateConfig(state);

  return (
    <CourseSearchClient
      state={state}
      systemName={config.systemName}
      collegeCount={config.collegeCount}
    />
  );
}
