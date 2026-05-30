import { ImageResponse } from "next/og";
import { getArticleBySlug, categoryLabel } from "@/lib/blog";

export const runtime = "nodejs";
export const alt = "Community College Path Blog — practical guides for community college students";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const meta = getArticleBySlug(slug);

  if (!meta) {
    return new ImageResponse(<div>Not Found</div>, { ...size });
  }

  const formattedDate = new Date(meta.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

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
              marginBottom: "24px",
              fontSize: "20px",
              color: "#0d9488",
              fontWeight: 600,
            }}
          >
            Community College Path Blog
          </div>

          <div
            style={{
              fontSize: "40px",
              fontWeight: 700,
              color: "#111827",
              textAlign: "center",
              lineHeight: 1.2,
              marginBottom: "24px",
              maxWidth: "900px",
            }}
          >
            {meta.title}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                backgroundColor: "#f3f4f6",
                color: "#4b5563",
                padding: "8px 20px",
                borderRadius: "999px",
                fontSize: "18px",
                fontWeight: 500,
              }}
            >
              {categoryLabel(meta.category)}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "18px",
                color: "#9ca3af",
              }}
            >
              {formattedDate}
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
