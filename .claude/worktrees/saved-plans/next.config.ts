import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  // Explicitly bundle every state's prereqs.json into the serverless
  // functions that PARSE it — only the API routes need the file content.
  // The state layout used to also need it for an `fs.existsSync` check,
  // but that was replaced with a registry-based `hasPrereqsCoverage()`
  // lookup so the layout no longer touches the filesystem.
  //
  // Removing the `/[state]/**` entry was the fix for Vercel deploys
  // failing on the 250 MB serverless function cap after phase 4 added
  // the programs/online routes. The previous glob force-bundled the
  // prereq JSON into every state route bundle even though only the
  // /api/[state]/prereqs/* handlers actually read the files.
  outputFileTracingIncludes: {
    "/api/[state]/prereqs/**": ["./data/*/prereqs.json"],
    // transfer-equiv.json is NOT re-included here despite the blanket
    // exclusion below. At ~200 MB across all states, bundling it into
    // serverless functions blew past Vercel's 250 MB cap. Production
    // reads transfers from Supabase; the local JSON fallback in
    // lib/transfer.ts is only exercised in local dev (no size cap).
  },
  // `lib/data-freshness.ts` (#401) calls `fs.readdirSync(path.join(
  // "data", state, "courses", collegeSlug))` with dynamic state+slug
  // parameters to look up the latest mtime per course-data directory.
  // Next.js' tracer can't narrow the dynamic pattern, so it
  // conservatively bundles ALL matching files into every function that
  // imports the module — ~180 MB of course JSON across 25+ states.
  // That blew past Vercel's 250 MB serverless function cap on the
  // post-#402 main deploy.
  //
  // Course JSON is in Supabase at runtime; the on-disk files exist
  // only for build-time generation and the freshness mtime lookup.
  // Excluding the dirs from function tracing means freshness lookups
  // return null in production (no files to stat) and callers degrade
  // to hiding the "Last updated" line — better than failing the deploy.
  // Same exclusion for transfer-equiv.json (heavy per-state mappings,
  // also read by data-freshness via `getTransferLastUpdated` and at
  // runtime in `lib/transfer.ts`; the transfer routes that genuinely
  // need it are re-included below).
  //
  // The follow-up to drop the null-degradation is to pre-build a
  // small `data/{state}/.last-updated.json` manifest at scrape time
  // and read that instead. Out of scope for this hotfix.
  outputFileTracingExcludes: {
    "**/*": [
      "./data/*/courses/**",
      "./data/*/transfer-equiv.json",
    ],
  },
  async redirects() {
    // VCCS 2022 renames — these colleges officially changed names in 2022
    // and external links (press, Wikipedia, prior PDFs) may still point at
    // the old slug. Map each old slug to the current one before the generic
    // /college/:id → /va/college/:id rule below so the rename wins.
    // See issue #337.
    const vccsRenames: Array<{ old: string; current: string }> = [
      { old: "john-tyler", current: "brightpoint" },
      { old: "jtcc", current: "brightpoint" },
      { old: "thomas-nelson", current: "vpcc" },
      { old: "tncc", current: "vpcc" },
      { old: "dabney-s-lancaster", current: "mgcc" },
      { old: "dslcc", current: "mgcc" },
      { old: "lord-fairfax", current: "laurelridge" },
      { old: "lfcc", current: "laurelridge" },
    ];
    const renameRedirects = vccsRenames.flatMap((r) => [
      {
        source: `/va/college/${r.old}`,
        destination: `/va/college/${r.current}`,
        permanent: true,
      },
      {
        source: `/college/${r.old}`,
        destination: `/va/college/${r.current}`,
        permanent: true,
      },
    ]);

    // Backward-compatible redirects from old un-prefixed routes to /va/.
    return [
      ...renameRedirects,
      // /colleges is now a real all-states directory page — no redirect
      { source: "/college/:id", destination: "/va/college/:id", permanent: true },
      { source: "/courses", destination: "/va/courses", permanent: true },
      { source: "/starting-soon", destination: "/va/starting-soon", permanent: true },
      { source: "/schedule", destination: "/va/schedule", permanent: true },
      { source: "/transfer", destination: "/va/transfer", permanent: true },
      { source: "/results", destination: "/va/results", permanent: true },
      // /about is now a sitewide page — no redirect needed
      { source: "/program/:slug", destination: "/va/program/:slug", permanent: true },
    ];
  },
};

const withMDX = createMDX({});

export default withMDX(nextConfig);
