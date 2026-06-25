import { defineConfig } from "vitest/config";

// Scoped to this app; tests run in the node env against in-memory fakes (no
// miniflare/D1 needed). The root vitest config only includes packages/**.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
