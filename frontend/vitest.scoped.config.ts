import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const coverageInclude = [
  "src/App.tsx",
  "src/components/ProtectedRoute.tsx",
  "src/components/ShareToChatModal.tsx",
  "src/components/IntegrationsPanel.tsx",
  "src/components/activityDetail/formatters.ts",
  "src/components/activityDetail/mapHelpers.tsx",
  "src/components/builder/workoutEditorUtils.ts",
  "src/components/calendar/dateUtils.ts",
  "src/components/calendar/loadModel.ts",
  "src/components/calendar/parseWorkoutText.ts",
  "src/components/calendar/quickWorkout.ts",
  "src/components/coachComparison/utils.ts",
  "src/components/planner/seasonPlanUtils.ts",
  "src/i18n/I18nProvider.tsx",
  "src/pages/LoginPage.tsx",
  "src/utils/**/*.ts",
];

const coverageExclude = [
  "src/**/*.test.{ts,tsx}",
  "src/main.tsx",
  "src/vite-env.d.ts",
  "src/test/**",
  "src/i18n/translations.ts",
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
      reportsDirectory: "coverage-scoped",
      include: coverageInclude,
      exclude: coverageExclude,
      thresholds: {
        lines: 60,
        statements: 60,
      },
    },
  },
});