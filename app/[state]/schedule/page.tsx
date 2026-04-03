import type { Metadata } from "next";
import ScheduleClient from "./ScheduleClient";
import { getStateConfig } from "@/lib/states/registry";

type Props = {
  params: Promise<{ state: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  const config = getStateConfig(state);
  return {
    title: `Smart Schedule Builder — ${config.branding.siteName}`,
    description: `Build conflict-free course schedules across all ${config.collegeCount} ${config.name} community colleges. Set your constraints and get personalized schedule suggestions.`,
  };
}

export default async function SchedulePage({ params }: Props) {
  const { state } = await params;
  const config = getStateConfig(state);

  return (
    <ScheduleClient
      state={state}
      systemName={config.systemName}
      collegeCount={config.collegeCount}
      defaultZip={config.defaultZip}
    />
  );
}
