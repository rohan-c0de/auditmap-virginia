/**
 * California — Colleague Self-Service scrape
 *
 * Calls the shared template at scripts/lib/scrape-colleague.ts for
 * California CCs reachable via public Colleague Self-Service endpoints.
 *
 * Usage:
 *   npx tsx scripts/ca/scrape-colleague.ts
 *   npx tsx scripts/ca/scrape-colleague.ts --college=cabrillo-college
 */
import { scrapeColleagueState } from "../lib/scrape-colleague";

const HOSTS: Record<string, string> = {
  "santa-ana-college":          "https://colss-prod.cloud.rsccd.edu",
  "cabrillo-college":           "https://cabrillo-ss.colleague.elluciancloud.com",
  "cuyamaca-college":           "https://selfservice.gcccd.edu",
  "college-of-the-desert":      "https://ss.collegeofthedesert.edu",
  "evergreen-valley-college":   "https://colss-prod.ec.sjeccd.edu",
  "grossmont-college":          "https://selfservice.gcccd.edu",
  "hartnell-college":           "https://stuserv.hartnell.edu",
  "palo-verde-college":         "https://prod-selfserv.paloverde.edu",
  "san-jose-city-college":      "https://colss-prod.ec.sjeccd.edu",
  "victor-valley-college":      "https://vvc-ss.colleague.elluciancloud.com",
  "yuba-college":               "https://yc-self-service.yccd.edu",
  "woodland-community-college": "https://wcc-self-service.yccd.edu",
  // SCCCD (4)
  "fresno-city-college":        "https://selfservice.scccd.edu",
  "reedley-college":            "https://selfservice.scccd.edu",
  "clovis-community-college":   "https://selfservice.scccd.edu",
  "madera-community-college":   "https://selfservice.scccd.edu",
  // SBCCD (2)
  "crafton-hills-college":      "https://colss-prod.ec.sbccd.edu",
  "san-bernardino-valley-college": "https://colss-prod.ec.sbccd.edu",
  // Yosemite CCD (2)
  "columbia-college":           "https://selfservice.yosemite.edu",
  "modesto-junior-college":     "https://selfservice.yosemite.edu",
  // Singletons
  "butte-college":              "https://selfservice.butte.edu",
  "chaffey-college":            "https://colss-prod.ec.chaffey.edu",
  "college-of-the-canyons":     "https://selfservice.canyons.edu",
  "el-camino-community-college-district": "https://selfservice.elcamino.edu",
  "napa-valley-college":        "https://colss-prod.ec.napavalley.edu",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  console.log("🌴 CA Colleague scraper");
  console.log(`   Hosts: ${Object.keys(HOSTS).length}`);

  const result = await scrapeColleagueState({
    state: "ca",
    hosts: HOSTS,
    collegeFilter,
    noImport: true,
  });

  console.log(
    `\n✅ Done — ${result.grandTotal} sections across ${result.results.length} colleges.`
  );
}

main().catch((err) => {
  console.error("❌ CA Colleague scraper failed:", err);
  process.exit(1);
});
