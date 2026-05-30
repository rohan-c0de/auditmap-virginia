/**
 * Helper for the CollegeTransfer.Net OData scrapers (NH, ME, DC, and any
 * future state using the same API). Fetches the set of institutions
 * registered in CT.Net for a given US state, so the scraper can filter
 * equivalencies to in-state target schools only.
 *
 * Why: the OData `Equivalencies` endpoint filtered by `SourceInstitutionId`
 * returns mappings to *every* registered institution in the database,
 * including out-of-state long-tail entries that are not real articulation
 * pathways. Showing these to users is misleading. See feedback memory
 * "Transfer data must be in-state only" for the rule.
 */

const BASE_URL = "https://courseatlasservices.azurewebsites.net/odata/v2";
const API_KEY =
  process.env.COLLEGETRANSFER_API_KEY ||
  "bc923312-6f95-4340-8eed-c89bd576521c";

export interface InStateInstitutionSet {
  /** Institution IDs for filtering OData responses by TargetInstitutionId. */
  ids: Set<number>;
  /** Institution names for filtering already-scraped JSON. */
  names: Set<string>;
}

/**
 * Fetch the set of CollegeTransfer.Net institutions for a US state.
 * `stateName` must be the full state name as CT.Net spells it
 * (e.g. "New Hampshire", "Maine", "District of Columbia").
 */
export async function fetchInStateInstitutions(
  stateName: string,
): Promise<InStateInstitutionSet> {
  const ids = new Set<number>();
  const names = new Set<string>();
  let skip = 0;
  const top = 200;

  while (true) {
    const params = new URLSearchParams({
      $format: "json",
      apikey: API_KEY,
      $filter: `State eq '${stateName.replace(/'/g, "''")}'`,
      $top: String(top),
      $skip: String(skip),
    });
    const url = `${BASE_URL}/Institutions?${params}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(
        `Institutions fetch for "${stateName}" failed: HTTP ${resp.status}`,
      );
    }
    const data = (await resp.json()) as {
      value: { InstitutionId: number; Name: string }[];
    };
    for (const inst of data.value) {
      ids.add(inst.InstitutionId);
      names.add(inst.Name);
    }
    if (data.value.length < top) break;
    skip += top;
  }

  return { ids, names };
}
