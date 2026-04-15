"use client";

import { useEffect, useRef } from "react";
import { track, type AnalyticsEvent } from "@/lib/analytics";

type Props = {
  event: AnalyticsEvent;
  params?: Record<string, string | number | boolean | null | undefined>;
};

/**
 * Fire a GA4 event once on mount from a server-rendered page.
 * Drop this inside any page/layout — it renders nothing but records the view.
 */
export default function TrackView({ event, params }: Props) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    track(event, params || {});
  }, [event, params]);
  return null;
}
