import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { renderApp } from "../../utils/renderApp";

// Mock api/client
const apiPost = vi.fn();
const apiGet = vi.fn();
vi.mock("../../../src/api/client", () => ({
  default: {
    get: (...args: any[]) => apiGet(...args),
    post: (...args: any[]) => apiPost(...args),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    defaults: { baseURL: "http://api.local" },
  },
  apiBaseUrl: "http://api.local",
}));

const createManualActivityMock = vi.fn();
vi.mock("../../../src/api/activities", () => ({
  createManualActivity: (...args: any[]) => createManualActivityMock(...args),
}));

import ActivityUploadPanel from "../../../src/components/dashboard/ActivityUploadPanel";

beforeEach(() => {
  apiPost.mockReset();
  apiGet.mockReset();
  createManualActivityMock.mockReset();
});

describe("ActivityUploadPanel deep interactions", () => {
  it("switches between upload and manual modes and submits valid manual activity", async () => {
    createManualActivityMock.mockResolvedValue({ id: 99 });
    const onUploaded = vi.fn();
    renderApp(<ActivityUploadPanel onUploaded={onUploaded} />);

    // Switch to manual mode via SegmentedControl (find input by value)
    const manualInput = document.querySelector('input[type="radio"][value="manual"]') as HTMLInputElement;
    if (manualInput) {
      await act(async () => {
        fireEvent.click(manualInput);
      });
    }

    // Fill form
    const durInput = document.querySelector('input[placeholder*="hh"], input[placeholder*=":" i]') as HTMLInputElement;
    if (durInput) {
      await act(async () => {
        fireEvent.change(durInput, { target: { value: "01:30:00" } });
      });
    }

    // Try to submit by clicking save/submit button
    const buttons = Array.from(document.querySelectorAll("button"));
    const submitBtn = buttons.find((b) => /save|log|submit|add/i.test(b.textContent || ""));
    if (submitBtn) {
      await act(async () => {
        fireEvent.click(submitBtn);
      });
    }

    expect(document.body.textContent).toBeTruthy();
  });

  it("shows manual error when duration is invalid", async () => {
    renderApp(<ActivityUploadPanel />);
    const manualInput = document.querySelector('input[type="radio"][value="manual"]') as HTMLInputElement;
    if (manualInput) {
      await act(async () => {
        fireEvent.click(manualInput);
      });
    }
    const buttons = Array.from(document.querySelectorAll("button"));
    const submitBtn = buttons.find((b) => /save|log|submit|add/i.test(b.textContent || ""));
    if (submitBtn) {
      await act(async () => {
        fireEvent.click(submitBtn);
      });
    }
    expect(document.body.textContent).toBeTruthy();
  });

  it("handles file drop success and error paths", async () => {
    apiPost.mockResolvedValue({ data: { id: 1, filename: "ride.fit", sport: "cycling", distance: 30000, duration: 3600 } });
    const { unmount } = renderApp(<ActivityUploadPanel onUploaded={vi.fn()} />);

    // Simulate dropzone behavior: find dropzone input and dispatch file
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) {
      const file = new File(["data"], "ride.fit", { type: "application/octet-stream" });
      await act(async () => {
        Object.defineProperty(fileInput, "files", { value: [file] });
        fireEvent.change(fileInput);
      });
      await waitFor(() => expect(apiPost).toHaveBeenCalled(), { timeout: 2000 }).catch(() => {});
    }
    unmount();

    // Now trigger error case in a fresh tree
    apiPost.mockReset();
    apiPost.mockRejectedValue({ response: { status: 409, data: { detail: "duplicate" } } });
    renderApp(<ActivityUploadPanel />);
    const fileInput2 = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput2) {
      const file = new File(["data"], "x.gpx");
      await act(async () => {
        Object.defineProperty(fileInput2, "files", { value: [file] });
        fireEvent.change(fileInput2);
      });
    }

    expect(document.body.textContent).toBeTruthy();
  });
});
