import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const coverageExclude = [
  "src/**/*.d.ts",
  "src/main.tsx",
  "src/vite-env.d.ts",
  "src/types/**",
  // Type-only / style-only modules carry no executable logic and skew metrics.
  "src/**/types.ts",
  "src/components/calendar/trainingCalendarStyles.ts",
  // Tiny presentation wrappers re-exported elsewhere; covered transitively.
  "src/components/builder/RepeatBlock.tsx",
  "src/components/builder/WorkoutStep.tsx",
];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary", "lcov"],
      // Default frontend coverage reports on the full src surface.
      include: ["src/**/*.{ts,tsx}"],
      exclude: coverageExclude,
      // Floor thresholds match the currently-achieved baseline so the gate
      // catches regressions. Headline targets (lines/statements/branches)
      // have reached the 75/75/70 goal; functions still climbing toward 70.
      thresholds: {
        lines: 75,
        statements: 75,
        branches: 70,
        functions: 59,
      },
    },
  },
});
