import { describe, expect, it } from "vitest";

import {
  extractApiErrorMessage,
  formatDuration,
  formatMinutesHm,
  metricDescriptions,
  metricModalTitle,
} from "./utils";

describe("dashboard utils", () => {
  it("extracts timeout and network errors", () => {
    expect(extractApiErrorMessage({ code: "ECONNABORTED" })).toBe("Request timed out. Please try again.");
    expect(extractApiErrorMessage({ message: "Network Error" })).toBe("Network error. Check your connection and try again.");
  });

  it("flattens nested API detail payloads", () => {
    const error = {
      response: {
        data: {
          detail: [
            { msg: "First error" },
            { detail: ["Second error", { message: "Third error" }] },
          ],
        },
      },
    };

    expect(extractApiErrorMessage(error)).toBe("First error Second error Third error");
  });

  it("falls back from response message to generic error text", () => {
    expect(extractApiErrorMessage({ response: { data: { message: "Top-level message" } } })).toBe("Top-level message");
    expect(extractApiErrorMessage(new Error("Unexpected boom"))).toBe("Unexpected boom");
    expect(extractApiErrorMessage({})).toBe("Unexpected error");
  });

  it("formats durations and rounded minute labels", () => {
    expect(formatDuration(12.5)).toBe("12:30");
    expect(formatMinutesHm(undefined)).toBe("-");
    expect(formatMinutesHm(0)).toBe("-");
    expect(formatMinutesHm(90.4)).toBe("1h 30m");
  });

  it("exposes metric copy for modals", () => {
    expect(metricDescriptions.training_status).toContain("Fitness");
    expect(metricModalTitle.aerobic_load).toBe("Fatigue — Short-term Load");
  });
});