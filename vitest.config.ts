import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Live tests (tests/live.test.ts) skip themselves unless
    // AGENT_MEMORY_LIVE=1; no separate config needed.
  },
});
