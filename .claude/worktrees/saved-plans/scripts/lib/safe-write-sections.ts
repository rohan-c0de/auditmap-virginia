import fs from "fs";

/**
 * Write a term's scraped sections to disk, refusing to overwrite a
 * non-empty existing file with an empty result.
 *
 * Per CLAUDE.md invariant #4: "If a scraper fails, leave the existing
 * data untouched rather than substitute placeholder courses." A scraper
 * that crashed mid-pagination, or hit a transient 0-result response,
 * or had its session cookie expire, must not silently erase the prior
 * good data on disk.
 *
 * Returns true if the file was written, false if the guard kicked in.
 */
export function safeWriteSections<T>(
  outFile: string,
  sections: T[],
  label?: string
): boolean {
  if (sections.length === 0 && fs.existsSync(outFile)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outFile, "utf-8"));
      if (Array.isArray(prev) && prev.length > 0) {
        const tag = label ? `${label}: ` : "";
        console.warn(
          `  ⚠ ${tag}scraper returned 0 sections but existing file has ${prev.length}; keeping previous data`
        );
        return false;
      }
    } catch {
      // Existing file unreadable — fall through and write the empty result
    }
  }
  fs.writeFileSync(outFile, JSON.stringify(sections, null, 2));
  return true;
}
