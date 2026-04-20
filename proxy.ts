import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js proxy (formerly "middleware"). Two jobs, routed by path:
 *
 *   1. AUTH ROUTES (/account, /api/account, /auth)
 *      Refresh the Supabase session cookie via `updateSession`.
 *
 *   2. PSEO COURSE PAGES (/<state>/course/<code>)
 *      Validate the course-code format before the route even renders. If the
 *      code is malformed (e.g. a legacy Google-crawled URL like
 *      `/va/course/esl-42:`), return a real HTTP 404 response. This is the
 *      only way to get a 404 *status* on a streamed route — once the response
 *      body starts streaming (which happens the moment `loading.tsx`'s
 *      Suspense boundary renders), the status code is locked at 200 and
 *      `notFound()` can only set the body, not the status. Doing the format
 *      check in the proxy runs before streaming starts. See Next.js docs:
 *      "Status Codes" under loading.js.
 *
 * CRITICAL: Neither branch touches cookies for public pages. The auth branch
 * is scoped by the matcher to auth-only paths. The course branch just does
 * regex validation + a static 404 response. This preserves ISR edge caching
 * (`cache-control: public, s-maxage=…`) for the ~200 prerendered routes —
 * any cookie access on a public page forces
 * `cache-control: private, no-cache, no-store` and kills the cache.
 */

// Same regex as app/[state]/course/[code]/page.tsx `parseCode()`. Kept in
// sync by hand for now; both consumers reject URLs that don't match a
// real course number in the scraped catalog.
const COURSE_CODE_RE = /^[A-Z]{2,5}-[A-Z0-9-]{1,10}$/;

// `/<state>/course/<code>` capture. State is 2 lowercase letters; code is
// whatever the URL path segment is (validated against the regex below after
// uppercasing).
const COURSE_PATH_RE = /^\/([a-z]{2})\/course\/([^/]+)\/?$/;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // -------------------------------------------------------------------------
  // Course page format validation — runs for public paths but doesn't touch
  // cookies, so ISR edge caching is preserved.
  // -------------------------------------------------------------------------
  const courseMatch = pathname.match(COURSE_PATH_RE);
  if (courseMatch) {
    const code = decodeURIComponent(courseMatch[2]).toUpperCase();
    if (!COURSE_CODE_RE.test(code)) {
      // Rewrite to the global 404 page. Using `rewrite` (not `redirect`)
      // keeps the URL in the address bar and produces a 404 status —
      // exactly what Google wants for dropping the URL from its index.
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.next();
  }

  // -------------------------------------------------------------------------
  // Auth session refresh — only for auth-dependent paths (see matcher).
  // -------------------------------------------------------------------------
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Auth routes — need session refresh
    "/account/:path*",
    "/api/account/:path*",
    "/auth/:path*",
    // Course detail routes — need URL format validation
    "/:state/course/:code",
  ],
};
