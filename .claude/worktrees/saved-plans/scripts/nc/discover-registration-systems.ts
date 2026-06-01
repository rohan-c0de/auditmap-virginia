/**
 * discover-registration-systems.ts
 *
 * Probes each NC community college website to identify which course registration
 * system they use (Ellucian Self-Service Banner, Colleague, WebAdvisor, etc.).
 *
 * Usage:
 *   npx tsx scripts/nc/discover-registration-systems.ts
 *   npx tsx scripts/nc/discover-registration-systems.ts --college wake-technical
 */

import * as fs from "fs";
import * as path from "path";

const DOMAINS: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(__dirname, "nc-college-domains.json"), "utf-8")
);

const TIMEOUT_MS = 10000;
const DELAY_MS = 200;

interface ProbeResult {
  slug: string;
  domain: string;
  system: string | null;
  selfServiceUrl: string | null;
  details: string;
}

// Known Ellucian Self-Service paths to probe
const PROBES = [
  {
    name: "Self-Service Banner 9",
    paths: [
      "/Student/Courses",
      "/StudentRegistrationSsb/ssb/classSearch/classSearch",
      "/StudentRegistrationSsb/ssb/registration/registration",
    ],
  },
  {
    name: "Colleague Self-Service",
    paths: [
      "/Student/Courses/Search",
      "/Student/Student/Courses",
    ],
  },
  {
    name: "WebAdvisor",
    paths: [
      "/WebAdvisor/WebAdvisor",
      "/webadvisor",
    ],
  },
  {
    name: "EAB Navigate / Custom",
    paths: [
      "/classes",
      "/schedule",
      "/course-schedule",
      "/class-schedule",
    ],
  },
];

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<{ status: number; redirectUrl?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "AuditMap-Discovery/1.0 (educational research project)",
      },
    });
    clearTimeout(timer);
    return { status: resp.status, redirectUrl: resp.url };
  } catch {
    clearTimeout(timer);
    return { status: 0 };
  }
}

async function probeCollege(slug: string, domain: string): Promise<ProbeResult> {
  const baseUrls = [`https://${domain}`, `https://selfservice.${domain}`, `https://ssb.${domain}`];

  for (const base of baseUrls) {
    for (const probeGroup of PROBES) {
      for (const probePath of probeGroup.paths) {
        const url = `${base}${probePath}`;
        const result = await fetchWithTimeout(url, TIMEOUT_MS);

        if (result.status >= 200 && result.status < 400) {
          return {
            slug,
            domain,
            system: probeGroup.name,
            selfServiceUrl: result.redirectUrl || url,
            details: `Found at ${url} (status ${result.status})`,
          };
        }
      }
    }
  }

  return {
    slug,
    domain,
    system: null,
    selfServiceUrl: null,
    details: "No known registration system detected",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const collegeFlag = args.indexOf("--college");
  const targetCollege = collegeFlag >= 0 ? args[collegeFlag + 1] : null;

  const slugs = targetCollege ? [targetCollege] : Object.keys(DOMAINS);

  console.log(`Probing ${slugs.length} colleges for registration systems...\n`);

  const results: ProbeResult[] = [];

  for (const slug of slugs) {
    const domain = DOMAINS[slug];
    if (!domain) {
      console.log(`  ⚠ Unknown slug: ${slug}`);
      continue;
    }

    process.stdout.write(`  ${slug.padEnd(35)}`);
    const result = await probeCollege(slug, domain);
    results.push(result);

    if (result.system) {
      console.log(`✓ ${result.system} — ${result.selfServiceUrl}`);
    } else {
      console.log(`✗ No system detected`);
    }

    await sleep(DELAY_MS);
  }

  // Summary
  const detected = results.filter((r) => r.system);
  const bySystem = detected.reduce((acc, r) => {
    acc[r.system!] = (acc[r.system!] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`\n--- Summary ---`);
  console.log(`Detected: ${detected.length}/${results.length}`);
  for (const [sys, count] of Object.entries(bySystem).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${sys}: ${count}`);
  }
  console.log(`Not detected: ${results.length - detected.length}`);

  // Write results
  const outPath = path.join(process.cwd(), "data", "nc", "registration-systems.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
  console.log(`\nResults written to ${outPath}`);
}

main().catch(console.error);
