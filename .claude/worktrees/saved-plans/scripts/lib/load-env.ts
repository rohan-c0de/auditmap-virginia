import fs from "fs";
import path from "path";

let loaded = false;

/**
 * Load environment variables from .env.local (strips quotes, skips comments).
 * Safe to call multiple times — only reads the file once.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const envPath = path.join(process.cwd(), ".env.local");
  try {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.local may not exist (e.g. in CI)
  }
}
