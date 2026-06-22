/**
 * Cron shard 0/6 of the VCCS PeopleSoft course scrape.
 *
 * The unified scheduled-scrape workflow runs one wrapper per parallel runner
 * (one matrix entry per ScrapeJob in lib/states/va/config.ts) and appends
 * `--no-import --term "<resolved vccs-ps terms>"`. Splitting the 23 colleges
 * into 6 balanced shards (≈4 colleges each) keeps every runner well under the
 * 6h Actions timeout that the single all-colleges run exceeded — even with the
 * two live terms (Summer+Fall) the vccs-ps term system currently resolves and
 * Northern Virginia CC (88 subjects, the system's largest) in one shard.
 *
 * Manual rerun of just this shard:
 *   npx tsx scripts/va/scrape-peoplesoft.ts --term "Fall 2026" --shard 0/6
 */
import { runShard } from "./scrape-peoplesoft";

runShard(0, 6).catch((e) => {
  console.error(e);
  process.exit(1);
});
