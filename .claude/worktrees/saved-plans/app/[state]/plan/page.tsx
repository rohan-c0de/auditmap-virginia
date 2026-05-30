import type { Metadata } from "next";
import { getAllStates } from "@/lib/states/registry";
import { requireStateConfig } from "@/lib/states/route-helpers";
import PlannerClient from "./PlannerClient";

type Props = {
  params: Promise<{ state: string }>;
};

export function generateStaticParams() {
  return getAllStates().map((s) => ({ state: s.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  const config = requireStateConfig(state);
  return {
    title: `Semester Planner — ${config.branding.siteName}`,
    description: `Plan your course sequence at ${config.name} community colleges. Automatically maps prerequisites into a semester-by-semester plan so you know exactly what to take and when.`,
    robots: { index: false, follow: true },
  };
}

export default async function PlanPage({ params }: Props) {
  const { state } = await params;
  const config = requireStateConfig(state);

  return (
    <PlannerClient
      state={state}
      systemName={config.systemName}
    />
  );
}
