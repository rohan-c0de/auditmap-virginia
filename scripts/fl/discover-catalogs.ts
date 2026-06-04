/**
 * discover-catalogs.ts — fingerprint the catalog platform for each NCCCS
 * college by probing real HTTP responses. No guessing: every classification
 * is backed by a signature found in a live page.
 *
 * Platforms detected: acalog, smartcatalogiq, courseleaf, coursedog,
 * cleancatalog, modern-campus (Acalog's new brand), or "unknown".
 *
 * Output: data/fl/catalog-discovery.json (slug -> {platform, catalogUrl, via}).
 * Usage: npx tsx scripts/nc/discover-catalogs.ts
 */
import * as fs from "fs";
import * as path from "path";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const domains: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join("scripts/fl/fl-college-domains.json"), "utf8")
);

interface Result {
  slug: string;
  domain: string;
  platform: string;
  catalogUrl: string | null;
  via: string;
}

async function fetchText(url: string, timeoutMs = 15000): Promise<{ ok: boolean; url: string; body: string; status: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: ctrl.signal });
    const body = await r.text();
    return { ok: r.ok, url: r.url, body, status: r.status };
  } catch {
    return { ok: false, url, body: "", status: 0 };
  } finally {
    clearTimeout(t);
  }
}

function fingerprint(url: string, body: string): string | null {
  const u = url.toLowerCase();
  const b = body.toLowerCase();
  if (u.includes("smartcatalogiq.com") || b.includes("smartcatalogiq")) return "smartcatalogiq";
  // Coursedog MUST be checked before Acalog: the acalog test below matches a bare
  // `b.includes("acalog")`, and some Coursedog catalogs carry a stray "Acalog"
  // mention (footer/credit) that falsely tagged them acalog. fscj is the known case
  // (catalog.fscj.edu is Coursedog, tenant fscj_peoplesoft, but had 4 incidental
  // "Acalog" markers vs 80 "coursedog" ones). "coursedog" is the stronger signal.
  if (u.includes("coursedog.com") || b.includes("coursedog")) return "coursedog";
  if (u.includes("acalog.com") || b.includes("acalogadmin") || b.includes("preview_program.php") || b.includes("acalog")) return "acalog";
  if (b.includes("courseleaf") || u.includes("/coursecat") || b.includes("courseleaf.com")) return "courseleaf";
  if (b.includes("cleancatalog")) return "cleancatalog";
  if (b.includes("modern campus") || u.includes("moderncampus")) return "modern-campus";
  return null;
}

// Extract the most likely catalog link from a homepage.
function catalogLinks(domain: string, body: string): string[] {
  const out = new Set<string>();
  const re = /href\s*=\s*["']([^"']+)["'][^>]*>([^<]*catalog[^<]*)</gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    let href = m[1];
    if (href.startsWith("//")) href = "https:" + href;
    else if (href.startsWith("/")) href = `https://${domain}${href}`;
    else if (!href.startsWith("http")) continue;
    if (/catalog|acalog|smartcatalog|coursedog|courseleaf/i.test(href)) out.add(href);
  }
  return [...out].slice(0, 6);
}

async function discover(slug: string, domain: string): Promise<Result> {
  const base = domain.replace(/^www\./, "");
  const word = base.split(".")[0];
  // 1. direct candidate URLs (cheap, high-signal)
  const direct = [
    `https://${word}.smartcatalogiq.com`,
    `https://catalog.${base}`,
    `https://${domain}/catalog`,
    `https://catalog.${domain}`,
  ];
  for (const c of direct) {
    const r = await fetchText(c);
    if (r.ok || r.status === 200) {
      const fp = fingerprint(r.url, r.body);
      if (fp) return { slug, domain, platform: fp, catalogUrl: r.url, via: "direct" };
    }
  }
  // 2. homepage -> catalog link -> fingerprint
  const home = await fetchText(`https://${domain}`);
  if (home.ok) {
    for (const link of catalogLinks(domain, home.body)) {
      const r = await fetchText(link);
      if (r.ok) {
        const fp = fingerprint(r.url, r.body);
        if (fp) return { slug, domain, platform: fp, catalogUrl: r.url, via: "homepage-link" };
      }
    }
  }
  return { slug, domain, platform: "unknown", catalogUrl: null, via: "none" };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

(async () => {
  const entries = Object.entries(domains);
  console.log(`Probing ${entries.length} NC colleges...`);
  const results = await pool(entries, 8, ([slug, domain]) => discover(slug, domain));
  const byPlatform: Record<string, number> = {};
  for (const r of results) {
    byPlatform[r.platform] = (byPlatform[r.platform] || 0) + 1;
    console.log(`  ${r.slug.padEnd(34)} ${r.platform.padEnd(15)} ${r.catalogUrl ?? ""}`);
  }
  fs.writeFileSync("data/fl/catalog-discovery.json", JSON.stringify(results, null, 2));
  console.log("\nPlatform distribution:", JSON.stringify(byPlatform, null, 2));
  console.log("Wrote data/fl/catalog-discovery.json");
})();
