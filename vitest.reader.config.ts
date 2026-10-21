import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["convex/**/*.test.ts", "src/components/reader/reading-progress.test.ts"],
    server: { deps: { inline: ["@convex-dev/rate-limiter", "@convex-dev/agent"] } },
  },
});
