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
    exclude: ["node_modules", ".next", "dist", "data"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
