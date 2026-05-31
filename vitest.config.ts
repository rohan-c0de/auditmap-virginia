import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["**/__tests__/**/*.test.ts"],
    exclude: [
      "node_modules",
      ".next",
      "dist",
      "data",
      // Claude Code worktrees are local scratch trees; they sometimes
      // contain accidentally-committed duplicates of tests, which would
      // double-run (and fail against stale source code there). Excluded
      // the same way eslint.config.mjs does.
      ".claude/worktrees/**",
      ".claude/skills/**",
    ],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
