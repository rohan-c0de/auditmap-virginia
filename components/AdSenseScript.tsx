"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { isAdFreeRoute } from "@/lib/ad-free-routes";

export default function AdSenseScript() {
  const clientId = process.env.NEXT_PUBLIC_ADSENSE_ID;
  const pathname = usePathname();

  // Do not load Google's ad library on authenticated/private routes (the
  // account dashboard, a saved-plan view) — viewed by signed-in students
  // including under-18 dual-enrollees. usePathname() is reactive, so on
  // client-side navigation INTO an ad-free route this returns null and the
  // injected <script> is unmounted. See lib/ad-free-routes.ts.
  if (!clientId || isAdFreeRoute(pathname)) return null;

  return (
    <Script
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`}
      crossOrigin="anonymous"
      strategy="afterInteractive"
    />
  );
}
