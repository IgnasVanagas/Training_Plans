import { beforeEach, describe, expect, it, vi } from "vitest";

import { readSnapshot, writeSnapshot } from "./localSnapshot";

type TestStorage = Storage & {
  seed: (key: string, value: string) => void;
  failNextSet: (count?: number) => void;
};

const createStorage = (): TestStorage => {
  const values = new Map<string, string>();
  let remainingFailures = 0;

  const storage = {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("quota exceeded");
      }

      values.set(key, String(value));
    },
    seed: (key: string, value: string) => {
      values.set(key, value);
    },
    failNextSet: (count = 1) => {
      remainingFailures = count;
    },
  } as TestStorage;

  Object.defineProperty(storage, "length", {
    configurable: true,
    get: () => values.size,
  });

  return storage;
};

describe("localSnapshot", () => {
  let storage: TestStorage;

  beforeEach(() => {
    vi.restoreAllMocks();
    storage = createStorage();

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage,
    });
  });

  it("reads a valid versioned snapshot", () => {
    storage.seed("calendar", JSON.stringify({ v: 1, ts: 100, data: { ready: true } }));

    expect(readSnapshot<{ ready: boolean }>("calendar")).toEqual({ ready: true });
  });

  it("returns undefined for invalid or stale snapshots", () => {
    storage.seed("broken", "not-json");
    storage.seed("old", JSON.stringify({ v: 0, ts: 99, data: { ready: false } }));

    expect(readSnapshot("broken")).toBeUndefined();
    expect(readSnapshot("old")).toBeUndefined();
    expect(readSnapshot("missing")).toBeUndefined();
  });

  it("writes a versioned snapshot envelope", () => {
    vi.spyOn(Date, "now").mockReturnValue(123456789);

    writeSnapshot("dashboard", { tab: "overview" });

    expect(JSON.parse(storage.getItem("dashboard") || "null")).toEqual({
      v: 1,
      ts: 123456789,
      data: { tab: "overview" },
    });
  });

  it("evicts the oldest snapshot on quota errors and retries once", () => {
    vi.spyOn(Date, "now").mockReturnValue(500);

    storage.seed("snapshot-old", JSON.stringify({ v: 1, ts: 100, data: { id: 1 } }));
    storage.seed("snapshot-new", JSON.stringify({ v: 1, ts: 300, data: { id: 2 } }));
    storage.seed("auth-token", "plain-token");
    storage.failNextSet();

    writeSnapshot("dashboard", { tab: "calendar" });

    expect(storage.getItem("snapshot-old")).toBeNull();
    expect(storage.getItem("snapshot-new")).not.toBeNull();
    expect(storage.getItem("auth-token")).toBe("plain-token");
    expect(JSON.parse(storage.getItem("dashboard") || "null")).toEqual({
      v: 1,
      ts: 500,
      data: { tab: "calendar" },
    });
  });

  it("silently gives up when the retry also fails", () => {
    storage.failNextSet(2);

    expect(() => writeSnapshot("dashboard", { tab: "settings" })).not.toThrow();
    expect(storage.getItem("dashboard")).toBeNull();
  });
});