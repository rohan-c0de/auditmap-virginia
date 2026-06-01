import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  experimental: {
    // Two reasons to keep this low:
    //  1. Supabase pool — default 8 pages/worker × 3 workers = 24 pages at
    //     once, each running multiple queries, saturates the free-tier pool
    //     (~15 conns) → "Timed out acquiring connection" build failures.
    //  2. Memory — each in-flight page loads a state's course/program data;
    //     several large states (CA 189k sections, TX) rendering at once
    //     spiked peak RAM past Vercel's 8 GB build machine → OOM (exit 137).
    //     A prior bump to 4 reintroduced the OOM. At 2, the build still hit
    //     Supabase pool saturation locally (7 workers × 2 = 14 concurrent
    //     pages > ~15-conn free-tier pool → "statement timeout" / connection
    //     resets during static generation). Set to 1 so concurrent in-flight
    //     pages = worker count, staying under the pool and minimizing RAM.
    // The high-cardinality + data-heavy per-state pages now generate
    // on-demand (empty generateStaticParams across course/subject/program/
    // about/plan/results/starting-soon/programs), so build-time generation
    // is minimal regardless — this cap is the belt to that suspenders.
    staticGenerationMaxConcurrency: 1,
  },
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
  // ── Serverless-function bundle size (Vercel 250 MB cap) ────────────────
  //
  // Now that the state landing page and the sitemap routes render
  // on-demand (`dynamic = "force-dynamic"`, see app/[state]/page.tsx),
  // each becomes a serverless function that bundles every file its code
  // path touches via `fs`. Next's tracer cannot narrow dynamic
  // `path.join(process.cwd(), "data", state, …)` arguments, so it
  // conservatively pulls EVERY state's copy of the touched data dir into
  // the function. The per-state `data/` payload is enormous:
  //
  //     data/*/courses/**            ~1.9 GB   (Supabase-backed at runtime)
  //     data/*/transfer-equiv.json   ~724 MB   (Supabase-backed at runtime)
  //     data/*/programs/**           ~200 MB   (fs-backed; program pages need it)
  //     data/*/scorecard/**          ~27 MB    (fs-backed; college pages need it)
  //     data/*/scorecard-programs/** ~20 MB
  //
  // Strategy: exclude the three Supabase-backed heavyweights from EVERY
  // function bundle. All three are loaded Supabase-first at runtime, with
  // the on-disk JSON only a dev/build fallback (see loadCoursesForCollege
  // / loadAllCourses in lib/courses.ts, loadTransferMappings* in
  // lib/transfer.ts, loadCollegePrograms / loadProgramAcrossColleges in
  // lib/programs/requirements.ts — each tries Supabase, then falls back to
  // the file). Production has all three in Postgres, so excluding the
  // files from the bundle changes nothing a user sees while removing
  // ~2.9 GB of would-be-traced payload.
  //
  // NOT excluded: data/*/scorecard/** (~27 MB) and scorecard-programs
  // (~20 MB). Those are read straight from disk at request time (no
  // Supabase table) by the college detail page's outcome tiles, and
  // they're small enough to bundle without threatening the cap.
  //
  // Note on precedence: Next applies excludes AFTER includes, so a
  // "**/*" exclude wins over any per-route re-include of the same glob —
  // re-including programs/ for the program routes does NOT work. That's
  // fine here precisely because programs is Supabase-backed; the routes
  // get their data over the wire, not from the bundle.
  outputFileTracingExcludes: {
    "**/*": [
      "./data/*/courses/**",
      "./data/*/transfer-equiv.json",
      "./data/*/programs/**",
    ],
  },
  outputFileTracingIncludes: {
    // Prereq API parses prereqs.json directly from disk; pin it so the
    // tracer always bundles it for this route.
    "/api/[state]/prereqs/**": ["./data/*/prereqs.json"],
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
