import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Code worktrees are local scratch trees that occasionally
    // include accidentally-committed copies of WIP files; they aren't
    // part of the deployed app and shouldn't gate CI. (One stale tree
    // under saved-plans/ currently carries 6 `no-explicit-any` errors
    // that fail lint on every PR including main itself.)
    ".claude/worktrees/**",
    // The blog-pipeline skill scripts are Claude's automation, not
    // shipped product code; same rationale.
    ".claude/skills/**",
  ]),
]);

export default eslintConfig;
