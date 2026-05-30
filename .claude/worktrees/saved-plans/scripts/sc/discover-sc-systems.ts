/**
 * discover-sc-systems.ts
 *
 * Probes SC technical college websites to identify which course registration
 * system they use (Colleague Self-Service, Banner SSB, CourseDog, etc.).
 *
 * Usage:
 *   npx tsx scripts/sc/discover-sc-systems.ts
 *   npx tsx scripts/sc/discover-sc-systems.ts --college trident
 */

const TIMEOUT_MS = 10000;
const DELAY_MS = 300;

// SC technical colleges that need discovery
// Maps slug → primary domain
const SC_DOMAINS: Record<string, string> = {
  "orangeburg-calhoun": "octech.edu",
  "tri-county": "tctc.edu",
  "trident": "tridenttech.edu",
  "midlands": "midlandstech.edu",
  "northeastern": "netc.edu",
  "williamsburg": "wiltechs.edu",
  // Already known but include for re-probing
  "greenville": "gvltec.edu",
  "horry-georgetown": "hgtc.edu",
  "piedmont": "ptc.edu",
  "york": "yorktech.edu",
  "spartanburg": "sccsc.edu",
  "central-carolina": "cctech.edu",
};

// Subdomain prefixes to probe for each domain
const SUBDOMAIN_PREFIXES = [
  "",            // bare domain
  "selfservice",
  "ssb",
  "ssb-prod",
  "ss",
  "banner",
  "courses",
  "my",
  "reg",
  "selfserv",
  "selfserviceprod",
  "student",
];

// Paths to probe and what they indicate
const PROBES = [
  {
    name: "Colleague Self-Service",
    paths: [
      "/Student/Courses",
      "/Student/Courses/Search",
    ],
    markers: ["__RequestVerificationToken", "Colleague"],
  },
  {
    name: "Banner SSB 9",
    paths: [
      "/StudentRegistrationSsb/ssb/classSearch/classSearch",
      "/StudentRegistrationSsb/ssb/registration/registration",
    ],
    markers: ["BannerGeneralSsb", "classSearch"],
  },
  {
    name: "WebAdvisor",
    paths: [
      "/WebAdvisor/WebAdvisor",
      "/webadvisor",
    ],
    markers: ["WebAdvisor"],
  },
  {
    name: "Schedule/Catalog Page",
    paths: [
      "/classes",
      "/schedule",
      "/course-schedule",
      "/class-schedule",
      "/academics/class-schedules",
      "/academics/course-schedule",
    ],
    markers: [],
  },
];

interface ProbeResult {
  slug: string;
  domain: string;
  system: string | null;
  url: string | null;
  details: string;
  responseSnippet?: string;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<{ status: number; redirectUrl?: string; body?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timer);
    // Read first 5KB of body for marker detection
    const text = await resp.text();
    const snippet = text.slice(0, 5000);
    return { status: resp.status, redirectUrl: resp.url, body: snippet };
  } catch {
    clearTimeout(timer);
    return { status: 0 };
  }
}

async function probeCollege(slug: string, domain: string): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  for (const prefix of SUBDOMAIN_PREFIXES) {
    const host = prefix ? `${prefix}.${domain}` : domain;

    for (const probeGroup of PROBES) {
      for (const probePath of probeGroup.paths) {
        const url = `https://${host}${probePath}`;
        const result = await fetchWithTimeout(url, TIMEOUT_MS);

        if (result.status >= 200 && result.status < 400 && result.body) {
          // Check for platform-specific markers in body
          const hasMarker =
            probeGroup.markers.length === 0 ||
            probeGroup.markers.some((m) => result.body!.includes(m));

          if (hasMarker) {
            // Additional detection: check body for CourseDog
            let system = probeGroup.name;
            if (result.body.includes("coursedog") || result.body.includes("CourseDog")) {
              system = "CourseDog";
            }
            if (result.body.includes("cygnet") || result.body.includes("Cygnet")) {
              system = "Ellucian Cygnet";
            }

            results.push({
              slug,
              domain,
              system,
              url: result.redirectUrl || url,
              details: `${result.status} at ${url}`,
              responseSnippet: result.body.slice(0, 200),
            });
          }
        }
      }
    }
  }

  // Also probe for CourseDog embed on main site
  const mainUrl = `https://www.${domain}`;
  const mainResult = await fetchWithTimeout(mainUrl, TIMEOUT_MS);
  if (mainResult.body) {
    if (mainResult.body.includes("coursedog") || mainResult.body.includes("CourseDog")) {
      results.push({
        slug,
        domain,
        system: "CourseDog",
        url: mainUrl,
        details: `CourseDog detected on main site`,
      });
    }
    if (mainResult.body.includes("cygnet") || mainResult.body.includes("Cygnet")) {
      results.push({
        slug,
        domain,
        system: "Ellucian Cygnet",
        url: mainUrl,
        details: `Cygnet detected on main site`,
      });
    }
  }

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const collegeFlag = args.indexOf("--college");
  const targetCollege = collegeFlag >= 0 ? args[collegeFlag + 1] : null;

  const slugs = targetCollege ? [targetCollege] : Object.keys(SC_DOMAINS);

  console.log(`Probing ${slugs.length} SC colleges for registration systems...\n`);

  for (const slug of slugs) {
    const domain = SC_DOMAINS[slug];
    if (!domain) {
      console.log(`  Unknown slug: ${slug}\n`);
      continue;
    }

    console.log(`${slug} (${domain}):`);
    const results = await probeCollege(slug, domain);

    if (results.length === 0) {
      console.log(`  No registration system detected\n`);
    } else {
      // Deduplicate by system name
      const seen = new Set<string>();
      for (const r of results) {
        const key = `${r.system}:${r.url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(`  [${r.system}] ${r.url}`);
        console.log(`    ${r.details}`);
      }
      console.log();
    }

    await sleep(DELAY_MS);
  }
}

main().catch(console.error);
