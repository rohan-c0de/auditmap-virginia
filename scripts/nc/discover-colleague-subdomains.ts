/**
 * discover-colleague-subdomains.ts
 *
 * Probes common Self-Service subdomain patterns for all NC community colleges
 * to find which ones have an Ellucian Colleague Self-Service public course catalog.
 *
 * Also checks for Banner SSB endpoints.
 *
 * Usage:
 *   npx tsx scripts/nc/discover-colleague-subdomains.ts
 *   npx tsx scripts/nc/discover-colleague-subdomains.ts --college wake-technical
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 8000;
const CONCURRENCY = 5;

// Subdomain prefixes to probe (based on known working NC college URLs)
const SUBDOMAIN_PREFIXES = [
  "selfservice",  // durham-technical, cape-fear, abtech, gtcc
  "selfserve",    // wake-technical
  "selfserv",     // fayetteville-technical
  "ss",
  "ssb",
  "ss-prod.cloud", // rowan-cabarrus
  "my",           // forsyth-technical
  "mycollegess",  // central-piedmont
  "sscourses",    // pitt
  "colleague",
  "portal",
  "reg",
  "registration",
  "ellucian",
  "student",
];

// Paths to probe at each subdomain
const COLLEAGUE_PATHS = ["/Student/Courses"];
const BANNER_SSB_PATHS = [
  "/StudentRegistrationSsb/ssb/classSearch/classSearch",
  "/StudentRegistrationSsb/ssb/registration/registration",
];

// Already confirmed colleges — skip these
const ALREADY_HAVE_DATA = new Set([
  "wake-technical",
  "fayetteville-technical",
  "durham-technical",
  "central-piedmont",
  "asheville-buncombe-technical",
  "forsyth-technical",
  "guilford-technical",
  "pitt",
  "rowan-cabarrus",
]);

interface DiscoveryResult {
  slug: string;
  domain: string;
  system: "colleague" | "banner-ssb" | "auth-required" | "not-found";
  url: string | null;
  details: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripWww(domain: string): string {
  return domain.replace(/^www\./, "");
}

async function probeUrl(
  url: string
): Promise<{ status: number; finalUrl: string; bodySnippet: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    const body = await resp.text();
    return {
      status: resp.status,
      finalUrl: resp.url,
      bodySnippet: body.substring(0, 2000),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isColleaguePage(bodySnippet: string, finalUrl: string): boolean {
  // Check for Colleague Self-Service markers
  return (
    bodySnippet.includes("__RequestVerificationToken") ||
    bodySnippet.includes("term-id") ||
    bodySnippet.includes("esg-course-catalog") ||
    bodySnippet.includes("Ellucian.CatalogAdvancedSearch") ||
    bodySnippet.includes("CourseCatalogViewModel") ||
    // URL stayed on /Student/ path (not redirected to WordPress)
    (finalUrl.includes("/Student/") && bodySnippet.includes("Course"))
  );
}

function isBannerSsbPage(bodySnippet: string): boolean {
  return (
    bodySnippet.includes("classSearch") ||
    bodySnippet.includes("term-search") ||
    bodySnippet.includes("ss-header-logo") ||
    bodySnippet.includes("banneridentity") ||
    bodySnippet.includes("BannerGeneralSsb")
  );
}

function isLoginPage(finalUrl: string, bodySnippet: string): boolean {
  return (
    finalUrl.includes("/Account/Login") ||
    finalUrl.includes("/login") ||
    finalUrl.includes("quicklaunch.io") ||
    finalUrl.includes("adfs") ||
    finalUrl.includes("/sso/") ||
    bodySnippet.includes("Sign in") && bodySnippet.includes("Password")
  );
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

async function discoverCollege(
  slug: string,
  domain: string
): Promise<DiscoveryResult> {
  const baseDomain = stripWww(domain);

  // Try each subdomain + path combo
  for (const prefix of SUBDOMAIN_PREFIXES) {
    const baseUrl = `https://${prefix}.${baseDomain}`;

    // Check Colleague paths
    for (const urlPath of COLLEAGUE_PATHS) {
      const fullUrl = `${baseUrl}${urlPath}`;
      const result = await probeUrl(fullUrl);

      if (!result) continue;

      if (result.status === 200 || result.status === 302) {
        // Check if it's a login page
        if (isLoginPage(result.finalUrl, result.bodySnippet)) {
          // Note auth-required but keep looking (might have a different public URL)
          continue;
        }

        if (isColleaguePage(result.bodySnippet, result.finalUrl)) {
          return {
            slug,
            domain,
            system: "colleague",
            url: baseUrl,
            details: `Colleague found at ${fullUrl} (status ${result.status})`,
          };
        }
      }
    }

    // Check Banner SSB paths
    for (const urlPath of BANNER_SSB_PATHS) {
      const fullUrl = `${baseUrl}${urlPath}`;
      const result = await probeUrl(fullUrl);

      if (!result) continue;

      if (result.status === 200) {
        if (isBannerSsbPage(result.bodySnippet)) {
          return {
            slug,
            domain,
            system: "banner-ssb",
            url: baseUrl,
            details: `Banner SSB found at ${fullUrl}`,
          };
        }
      }
    }
  }

  // Also try the main domain directly (some colleges serve Colleague from the main domain)
  for (const urlPath of COLLEAGUE_PATHS) {
    const fullUrl = `https://${baseDomain}${urlPath}`;
    const result = await probeUrl(fullUrl);
    if (result && (result.status === 200 || result.status === 302)) {
      if (isColleaguePage(result.bodySnippet, result.finalUrl)) {
        return {
          slug,
          domain,
          system: "colleague",
          url: `https://${baseDomain}`,
          details: `Colleague found at main domain ${fullUrl}`,
        };
      }
      if (isLoginPage(result.finalUrl, result.bodySnippet)) {
        return {
          slug,
          domain,
          system: "auth-required",
          url: fullUrl,
          details: `Login required at ${result.finalUrl}`,
        };
      }
    }
  }

  // Try Banner SSB on main domain
  for (const urlPath of BANNER_SSB_PATHS) {
    const fullUrl = `https://${baseDomain}${urlPath}`;
    const result = await probeUrl(fullUrl);
    if (result && result.status === 200 && isBannerSsbPage(result.bodySnippet)) {
      return {
        slug,
        domain,
        system: "banner-ssb",
        url: `https://${baseDomain}`,
        details: `Banner SSB found at main domain ${fullUrl}`,
      };
    }
  }

  return {
    slug,
    domain,
    system: "not-found",
    url: null,
    details: "No Colleague or Banner SSB system detected",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const collegeFlag = args.indexOf("--college");

  // Load domain mappings
  const domainsPath = path.join(
    process.cwd(),
    "scripts",
    "nc",
    "nc-college-domains.json"
  );
  const domains: Record<string, string> = JSON.parse(
    fs.readFileSync(domainsPath, "utf-8")
  );

  // Determine which colleges to probe
  let targets: [string, string][];
  if (collegeFlag >= 0) {
    const slug = args[collegeFlag + 1];
    if (!domains[slug]) {
      console.error(`Unknown college: ${slug}`);
      process.exit(1);
    }
    targets = [[slug, domains[slug]]];
  } else {
    targets = Object.entries(domains).filter(
      ([slug]) => !ALREADY_HAVE_DATA.has(slug)
    );
  }

  console.log(`Probing ${targets.length} colleges for Self-Service URLs...\n`);

  const results: DiscoveryResult[] = [];

  // Process in batches for concurrency control
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(([slug, domain]) => {
        process.stdout.write(`  [${i + batch.indexOf([slug, domain]) + 1}/${targets.length}] ${slug}...`);
        return discoverCollege(slug, domain);
      })
    );

    for (const result of batchResults) {
      results.push(result);
      const icon =
        result.system === "colleague"
          ? "✅"
          : result.system === "banner-ssb"
          ? "🔶"
          : result.system === "auth-required"
          ? "🔒"
          : "❌";
      console.log(`  ${icon} ${result.slug}: ${result.details}`);
    }
  }

  // Summary
  const colleague = results.filter((r) => r.system === "colleague");
  const bannerSsb = results.filter((r) => r.system === "banner-ssb");
  const authRequired = results.filter((r) => r.system === "auth-required");
  const notFound = results.filter((r) => r.system === "not-found");

  console.log(`\n--- Summary ---`);
  console.log(`  Colleague Self-Service: ${colleague.length}`);
  console.log(`  Banner SSB: ${bannerSsb.length}`);
  console.log(`  Auth Required: ${authRequired.length}`);
  console.log(`  Not Found: ${notFound.length}`);

  if (colleague.length > 0) {
    console.log(`\n--- Colleague URLs (add to scraper) ---`);
    for (const r of colleague) {
      console.log(`  "${r.slug}": "${r.url}",`);
    }
  }

  if (bannerSsb.length > 0) {
    console.log(`\n--- Banner SSB URLs ---`);
    for (const r of bannerSsb) {
      console.log(`  "${r.slug}": "${r.url}",`);
    }
  }

  // Save results
  const outPath = path.join(process.cwd(), "data", "nc", "colleague-urls.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
  console.log(`\nResults saved to ${outPath}`);
}

main().catch(console.error);
