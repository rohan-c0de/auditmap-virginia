/**
 * Texas — Jenzabar WebForms (AddDrop_Courses / Course_Search portlet)
 *
 * Thin wrapper around the shared template at
 * scripts/lib/scrape-jenzabar-webforms.ts for TX Jenzabar colleges whose
 * public class search uses the ASP.NET WebForms variant (`pg0$V$ddlTerm`,
 * `pg0$V$btnSearch`, letter-chunk pagination).
 *
 * URL form-element presence verified on 2026-05-28 (each page renders a
 * real `<select name="pg0$V$ddlTerm">` without auth):
 *
 *   paris-junior-college               mypjc.parisjc.edu        AddDrop_Courses
 *   north-central-texas-college        my.nctc.edu              AddDrop_Courses
 *   texarkana-college                  my.texarkanacollege.edu  Course_Search
 *
 * Kilgore College already has its own bespoke scraper at
 * scripts/tx/scrape-kilgore.ts — predates this template; leaving it
 * untouched to avoid regressing a working production scraper.
 *
 * Two TX Jenzabar colleges remain deferred:
 *   - hill-college, ranger-college — public Everyone.jnz URL only contains
 *     the marker as a navigation reference; the portlet body itself is
 *     login-gated (no `#pg0_V_ddlTerm` element in unauth page response).
 *   - northeast-texas-community-college — uses the `Simple_Query` portlet
 *     (`pg0_V_divSQResults`), a different DOM structure; needs a bespoke
 *     scraper.
 *
 * Usage:
 *   npx tsx scripts/tx/scrape-jenzabar-webforms.ts
 *   npx tsx scripts/tx/scrape-jenzabar-webforms.ts --college=texarkana-college
 */
import { scrapeJenzabarWebformsState } from "../lib/scrape-jenzabar-webforms";

const HOSTS: Record<string, string> = {
  "paris-junior-college":
    "https://mypjc.parisjc.edu/ICS/Portal_Homepage.jnz?portlet=AddDrop_Courses&screen=Advanced+Course+Search&screenType=next",
  "north-central-texas-college":
    "https://my.nctc.edu/ICS/Academics/Academics_Homepage.jnz?portlet=AddDrop_Courses&screen=Advanced+Course+Search&screenType=next",
  "texarkana-college":
    "https://my.texarkanacollege.edu/ICS/Home.jnz?portlet=Course_Search&screen=Advanced+Course+Search&screenType=next",
  // Course_Search.jnz (not Home.jnz) renders the public `pg0$V$ddlTerm`
  // Advanced Course Search portlet with real terms (2026 FA/SP etc.) — the
  // page also carries the portal login widget in its header, same as the
  // three above. Verified 2026-06.
  "midland-college":
    "https://mymcportal.midland.edu/ICS/Course_Search.jnz?portlet=Course_Search&screen=Advanced+Course+Search&screenType=next",
};

async function main() {
  const args = process.argv.slice(2);
  const collegeFilter = args
    .find((a) => a.startsWith("--college="))
    ?.split("=")[1];

  await scrapeJenzabarWebformsState({
    state: "tx",
    hosts: HOSTS,
    collegeFilter,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
