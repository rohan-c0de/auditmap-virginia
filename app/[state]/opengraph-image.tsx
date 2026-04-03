import { ImageResponse } from "next/og";
import { getStateConfig, isValidState } from "@/lib/states/registry";

export const runtime = "nodejs";
export const alt = "CC CourseMap — Community College Course Finder";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state } = await params;
  if (!isValidState(state)) {
    return new ImageResponse(<div>Not Found</div>, { ...size });
  }

  const config = getStateConfig(state);
  const b = config.branding;

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
              gap: "12px",
              marginBottom: "24px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                backgroundColor: "#0d9488",
                borderRadius: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontSize: "24px",
                fontWeight: 700,
              }}
            >
              CCM
            </div>
            <span
              style={{
                fontSize: "28px",
                fontWeight: 700,
                color: "#0d9488",
              }}
            >
              CC CourseMap
            </span>
          </div>

          <div
            style={{
              fontSize: "48px",
              fontWeight: 700,
              color: "#111827",
              textAlign: "center",
              lineHeight: 1.2,
              marginBottom: "20px",
            }}
          >
            {`Find ${config.name} Community College Courses`}
          </div>

          <div
            style={{
              fontSize: "22px",
              color: "#6b7280",
              textAlign: "center",
              lineHeight: 1.5,
              maxWidth: "800px",
            }}
          >
            {`Search ${config.collegeCount} ${config.systemName} colleges · Transfer equivalencies · Schedule builder · Free for ${config.seniorWaiver?.ageThreshold ?? 60}+`}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
