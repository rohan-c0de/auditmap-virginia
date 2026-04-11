import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  async redirects() {
    // Backward-compatible redirects from old routes to /va/ prefixed routes
    return [
      // /colleges is now a real all-states directory page — no redirect
      { source: "/college/:id", destination: "/va/college/:id", permanent: true },
      { source: "/courses", destination: "/va/courses", permanent: true },
      { source: "/starting-soon", destination: "/va/starting-soon", permanent: true },
      { source: "/schedule", destination: "/va/schedule", permanent: true },
      { source: "/transfer", destination: "/va/transfer", permanent: true },
      { source: "/results", destination: "/va/results", permanent: true },
      { source: "/about", destination: "/va/about", permanent: true },
    ];
  },
};

const withMDX = createMDX({});

export default withMDX(nextConfig);
