/**
 * discover-catalog.ts — auto-discover current catalog IDs for Acalog and
 * Coursedog so prereq scrapers don't need manual updates each summer.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Discover the current (non-archived) Acalog catalog ID by parsing the
 * `<select name="catalog">` dropdown on the catalog index page.
 *
 * Returns the `catoid` of the `selected` option, or the first non-archived
 * option if none is selected. Falls back to `fallback` on any error.
 */
export async function discoverAcalogCatoid(
  baseUrl: string,
  fallback: number
): Promise<number> {
  try {
    const resp = await fetch(`${baseUrl}/index.php`, {
      headers: { "User-Agent": UA },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const html = await resp.text();

    const optionRe =
      /<option\s[^>]*value="(\d+)"[^>]*(selected)?[^>]*>([^<]+)/gi;
    let match;
    let selectedId: number | null = null;
    let firstNonArchived: number | null = null;

    while ((match = optionRe.exec(html)) !== null) {
      const id = parseInt(match[1], 10);
      const isSelected = !!match[2];
      const label = match[3];
      const isArchived = label.includes("[ARCHIVED");

      if (isSelected && !isArchived) {
        selectedId = id;
        break;
      }
      if (!isArchived && firstNonArchived === null) {
        firstNonArchived = id;
      }
    }

    const catoid = selectedId ?? firstNonArchived;
    if (catoid !== null) {
      console.log(`  Auto-discovered Acalog catoid=${catoid} from ${baseUrl}`);
      return catoid;
    }

    console.warn(`  No active catalog found at ${baseUrl}, using fallback=${fallback}`);
    return fallback;
  } catch (err) {
    console.warn(
      `  Acalog discovery failed for ${baseUrl}: ${(err as Error).message}, using fallback=${fallback}`
    );
    return fallback;
  }
}

/**
 * Discover the current Coursedog catalog ID by fetching the catalogs API.
 *
 * Picks the non-archived catalog with the latest `effectiveStartDate`.
 * Falls back to `fallback` on any error.
 */
export async function discoverCoursedogCatalog(
  school: string,
  referer: string,
  fallback: string
): Promise<string> {
  try {
    const resp = await fetch(
      `https://app.coursedog.com/api/v1/ca/${school}/catalogs`,
      {
        headers: {
          "User-Agent": UA,
          Referer: referer,
          Origin: new URL(referer).origin,
        },
      }
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const catalogs: Array<{
      _id: string;
      displayName: string;
      archivedAt: number | null;
      effectiveStartDate?: string;
    }> = await resp.json();

    const active = catalogs
      .filter((c) => c.archivedAt === null)
      .sort((a, b) =>
        (b.effectiveStartDate ?? "").localeCompare(a.effectiveStartDate ?? "")
      );

    if (active.length > 0) {
      const best = active[0];
      console.log(
        `  Auto-discovered Coursedog catalog="${best.displayName}" id=${best._id}`
      );
      return best._id;
    }

    console.warn(`  No active Coursedog catalog for ${school}, using fallback=${fallback}`);
    return fallback;
  } catch (err) {
    console.warn(
      `  Coursedog discovery failed for ${school}: ${(err as Error).message}, using fallback=${fallback}`
    );
    return fallback;
  }
}
