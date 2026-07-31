import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Deliberately NOT "lib/**/*.test.ts": lib/dealerRebates/*.test.ts are
    // standalone node:assert scripts run with `npx tsx`, not vitest suites, and
    // a recursive glob makes them fail with "No test suite found".
    include: ["app/**/*.test.ts", "lib/*.test.ts", "lib/scanners/**/*.test.ts"],
  },
});
