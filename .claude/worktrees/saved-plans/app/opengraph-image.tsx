import { ImageResponse } from "next/og";
import { getAllStates } from "@/lib/states/registry";

export const runtime = "nodejs";
export const alt = "Community College Path — Community College Course Finder";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Root-level Open Graph image for /, /colleges, /blog index, and any
// route that doesn't define its own opengraph-image.tsx. Per-state and
// per-college overrides live deeper in the app/ tree (see
// app/[state]/opengraph-image.tsx and app/[state]/college/[id]/opengraph-image.tsx).

export default async function Image() {
  const states = getAllStates();
  const totalColleges = states.reduce((sum, s) => sum + s.collegeCount, 0);

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          width: "100%",
          height: "100%",
          backgroundColor: "#f0fdfa",
          padding: "60px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "white",
            borderRadius: "24px",
            border: "2px solid #99f6e4",
            padding: "60px 80px",
            width: "100%",
            height: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              marginBottom: "32px",
            }}
          >
            <div
              style={{
                width: "64px",
                height: "64px",
                backgroundColor: "#0d9488",
                borderRadius: "14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontSize: "30px",
                fontWeight: 700,
              }}
            >
              CCP
            </div>
            <span
              style={{
                fontSize: "36px",
                fontWeight: 700,
                color: "#0d9488",
              }}
            >
              Community College Path
            </span>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "56px",
              fontWeight: 800,
              color: "#0f172a",
              textAlign: "center",
              lineHeight: 1.1,
              marginBottom: "24px",
              letterSpacing: "-0.02em",
            }}
          >
            Find courses, plan transfers
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "30px",
              color: "#475569",
              textAlign: "center",
              maxWidth: "900px",
              lineHeight: 1.4,
            }}
          >
            {totalColleges}+ community colleges across {states.length} states.
            Course search, transfer lookup, schedule builder.
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
