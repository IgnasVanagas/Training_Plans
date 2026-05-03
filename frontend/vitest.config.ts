import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const coverageExclude = [
  "src/**/*.test.{ts,tsx}",
  "src/test/**",
  "src/**/*.d.ts",
];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary", "lcov"],
      // Default frontend coverage reports on the full src surface.
      include: ["src/**/*.{ts,tsx}"],
      exclude: coverageExclude,
    },
  },
});
