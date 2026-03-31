import { Suspense } from "react";
import type { Metadata } from "next";
import ResultsContent from "./ResultsContent";
import { getStateConfig } from "@/lib/states/registry";

type Props = {
  params: Promise<{ state: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state } = await params;
  const config = getStateConfig(state);
  return {
    title: `Search Results — ${config.branding.siteName}`,
    description: `Community colleges near you in ${config.name} that offer course auditing.`,
  };
}

export default async function ResultsPage({ params }: Props) {
  const { state } = await params;

  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-4 py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/3" />
            <div className="h-4 bg-gray-200 rounded w-1/2" />
            <div className="grid lg:grid-cols-2 gap-8 mt-8">
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-40 bg-gray-200 rounded-lg" />
                ))}
              </div>
              <div className="h-[500px] bg-gray-200 rounded-lg" />
            </div>
          </div>
        </div>
      }
    >
      <ResultsContent state={state} />
    </Suspense>
  );
}
