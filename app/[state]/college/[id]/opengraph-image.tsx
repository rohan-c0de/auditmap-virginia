import { ImageResponse } from "next/og";
import { loadInstitutions } from "@/lib/institutions";
import { getStateConfig, isValidState } from "@/lib/states/registry";
import { getCourseCount } from "@/lib/courses";
import { getCurrentTerm } from "@/lib/terms";

export const runtime = "nodejs";
export const alt = "College Detail — CC CourseMap";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ state: string; id: string }>;
}) {
  const { state, id } = await params;
  if (!isValidState(state)) {
    return new ImageResponse(<div>Not Found</div>, { ...size });
  }

  const institutions = loadInstitutions(state);
  const institution = institutions.find((i) => i.id === id);
  if (!institution) {
    return new ImageResponse(<div>Not Found</div>, { ...size });
  }

  const config = getStateConfig(state);
  const allowed = institution.audit_policy.allowed;
  const courseCount = getCourseCount(
    institution.college_slug,
    getCurrentTerm(state),
    state
  );

  const statusColor = allowed ? "#059669" : "#d97706";
  const statusBg = allowed ? "#ecfdf5" : "#fffbeb";
  const statusText = allowed ? "Auditing Available" : "Contact College";

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
            padding: "50px 60px",
            width: "100%",
            height: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "16px",
              fontSize: "20px",
              color: "#0d9488",
              fontWeight: 600,
            }}
          >
            CC CourseMap {config.name}
          </div>

          <div
            style={{
              fontSize: "44px",
              fontWeight: 700,
              color: "#111827",
              textAlign: "center",
              lineHeight: 1.2,
              marginBottom: "24px",
            }}
          >
            {institution.name}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              marginBottom: "20px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                backgroundColor: statusBg,
                color: statusColor,
                padding: "8px 20px",
                borderRadius: "999px",
                fontSize: "20px",
                fontWeight: 600,
              }}
            >
              {statusText}
            </div>
            {courseCount > 0 && (
              <div
                style={{
                  display: "flex",
                  fontSize: "20px",
                  color: "#6b7280",
                }}
              >
                {`${courseCount} courses this term`}
              </div>
            )}
          </div>

          <div
            style={{
              fontSize: "20px",
              color: "#9ca3af",
              textAlign: "center",
            }}
          >
            {`${institution.name} · Courses, schedules, transfer info & audit policies`}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
