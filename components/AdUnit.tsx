"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { isAdFreeRoute } from "@/lib/ad-free-routes";

type AdFormat = "auto" | "horizontal" | "rectangle" | "vertical";

interface AdUnitProps {
  slot: string;
  format?: AdFormat;
  className?: string;
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

export default function AdUnit({ slot, format = "auto", className = "" }: AdUnitProps) {
  const adRef = useRef<HTMLModElement>(null);
  const pushed = useRef(false);
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_ID;
  const adFree = isAdFreeRoute(usePathname());

  useEffect(() => {
    if (!clientId || adFree || pushed.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushed.current = true;
    } catch {
      // AdSense not loaded
    }
  }, [clientId, adFree]);

  // No ad slot on authenticated/private routes — defense-in-depth alongside
  // AdSenseScript. Today no AdUnit is placed on such a route, but this keeps
  // the guarantee if one is ever added. See lib/ad-free-routes.ts.
  if (!clientId || adFree) return null;

  return (
    <div className={`ad-container overflow-hidden ${className}`}>
      <ins
        ref={adRef}
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={clientId}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}
