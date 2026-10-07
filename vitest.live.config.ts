import path from "node:path";

import { defineConfig } from "vitest/config";

// Live integration tests against a REAL Appwrite project (the one in .env).
//   npm run test:live
// Kept out of the default config (`npm test`) on purpose: they create and delete
// real records. Only run against a non-production project.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["tests/live/**/*.live.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
