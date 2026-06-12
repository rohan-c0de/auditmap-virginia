"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  STATE_CHANGE_EVENT,
  readStoredState,
} from "./state-selection";

// The homepage's four "what you can do" cards. Client component so the card
// destinations follow the hero's selected state chip: manual choice (stored by
// the hero) > geo-IP guess (server prop) > the national /colleges index.
// Server HTML renders with geoState, then the mount effect swaps in a stored
// manual choice and the event listener tracks live chip switches.

type Card = {
  num: string;
  title: string;
  body: string;
  /** Path under /{state} when a state is known, e.g. "courses". */
  statePath: string;
  cta: string;
  icon: React.ReactNode;
};

const CARDS: Card[] = [
  {
    num: "01",
    title: "Search any course",
    body: "One search across every college in your state — by code, subject, or what you're trying to learn.",
    statePath: "courses",
    cta: "Start searching",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
      />
    ),
  },
  {
    num: "02",
    title: "Check what transfers",
    body: "Pick your CC and your target university. See which courses count, which don't, and what they map to.",
    statePath: "transfer",
    cta: "Look up transfers",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
      />
    ),
  },
  {
    num: "03",
    title: "Build a schedule",
    body: "Drag classes onto a weekly grid, see conflicts immediately, and export when you're ready to register.",
    statePath: "schedule",
    cta: "Open the planner",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
      />
    ),
  },
  {
    num: "04",
    title: "Plan a degree",
    body: "Pick a program, choose your transfer target, and see every required course — which ones count there, and what's open now.",
    statePath: "colleges",
    cta: "Start planning",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5"
      />
    ),
  },
];

export default function HomeFeatureCards({
  geoState,
  stateSlugs,
}: {
  geoState: string | null;
  stateSlugs: string[];
}) {
  const [selectedState, setSelectedState] = useState<string | null>(geoState);

  useEffect(() => {
    const stored = readStoredState(stateSlugs);
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedState(stored);
    }
    const onChange = (e: Event) => {
      const slug = (e as CustomEvent<string>).detail;
      if (stateSlugs.includes(slug)) setSelectedState(slug);
    };
    window.addEventListener(STATE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(STATE_CHANGE_EVENT, onChange);
  }, [stateSlugs]);

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {CARDS.map((card) => (
        <Link
          key={card.num}
          href={selectedState ? `/${selectedState}/${card.statePath}` : "/colleges"}
          className="group rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-md transition-all"
        >
          <div className="flex items-center justify-between">
            <div className="w-11 h-11 rounded-xl bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                {card.icon}
              </svg>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
              {card.num}
            </span>
          </div>
          <h3 className="mt-5 text-lg font-semibold text-slate-900 dark:text-slate-100">
            {card.title}
          </h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {card.body}
          </p>
          <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-teal-700 dark:text-teal-400 group-hover:gap-2 transition-all">
            {card.cta}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </span>
        </Link>
      ))}
    </div>
  );
}
