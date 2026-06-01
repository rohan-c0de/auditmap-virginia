/**
 * transfer-merge.ts
 *
 * Shared preserve-merge for transfer-equivalency scrapers. Lets multiple
 * scrapers write the same data/{state}/transfer-equiv.json without clobbering
 * each other, and makes a partial run (some colleges/receivers failed)
 * non-destructive instead of wiping the file.
 *
 * Ownership of a row is keyed by:
 *   (sending-college slug from the notes `[slug]` prefix, receiving `university` slug)
 *
 * A run "owns" exactly the (sender, receiver) pairs present in the rows it just
 * produced. mergeTransferRows() keeps every existing row whose pair this run did
 * NOT produce — rows from a different scraper (e.g. CT.Net + a per-university
 * scraper in the same state), or rows for a college this run failed to reach —
 * and replaces the rest with the fresh rows.
 *
 * This generalizes the logic that previously lived inline in
 * scrape-ctnet-multisource.ts (and the NH/ME scrapers it was copied from), so a
 * future "add another receiving university" scraper for a state is additive and
 * conflict-free by construction.
 *
 * Note: the importer (scripts/import-transfers.ts) still enforces the global
 * >50%-row-drop guard, so a broken scrape can't silently shrink prod even
 * through this merge.
 */

import fs from "fs";
import path from "path";

export interface TransferRowLike {
  university: string;
  notes: string;
}

/** Extract the sending-college slug from a row's `[slug] …` notes prefix. */
export function senderSlugFromNotes(notes: string): string {
  return notes.match(/^\[([\w-]+)\]/)?.[1] ?? "";
}

function ownershipKey(row: TransferRowLike): string {
  return `${senderSlugFromNotes(row.notes)}|${row.university}`;
}

/**
 * Merge freshly-scraped rows into the state's existing transfer-equiv.json,
 * preserving rows this run did not produce. Returns the merged array; the
 * caller is responsible for writing it to disk.
 *
 * @param state      state slug (e.g. "wi") — used to locate the data file
 * @param newRows    rows produced by the current run
 * @param opts.log   optional logger for the preserved/new/total counts
 */
export function mergeTransferRows<T extends TransferRowLike>(
  state: string,
  newRows: T[],
  opts: { log?: (msg: string) => void } = {},
): T[] {
  const owned = new Set(newRows.map(ownershipKey));
  const outPath = path.join(process.cwd(), "data", state, "transfer-equiv.json");

  let preserved: T[] = [];
  try {
    const existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    if (Array.isArray(existing)) {
      preserved = (existing as T[]).filter((row) => !owned.has(ownershipKey(row)));
    }
  } catch {
    // No existing file (or unreadable) — fresh start.
  }

  const merged = [...preserved, ...newRows];
  opts.log?.(
    `Merged: ${preserved.length} preserved + ${newRows.length} new = ${merged.length} total`,
  );
  return merged;
}
