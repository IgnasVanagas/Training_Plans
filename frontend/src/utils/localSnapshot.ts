type SnapshotEnvelope<T> = {
  v: number;
  ts: number;
  data: T;
};

const SNAPSHOT_VERSION = 1;

export const readSnapshot = <T>(key: string): T | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as SnapshotEnvelope<T>;
    if (!parsed || parsed.v !== SNAPSHOT_VERSION) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
};

const evictOldSnapshots = (keepKey: string): void => {
  try {
    const ls = window.localStorage;
    // Collect only snapshot keys (must have v + ts fields) with their timestamps
    const entries: { key: string; ts: number }[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (!k || k === keepKey) continue;
      try {
        const raw = ls.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        // Only evict entries that are valid snapshot envelopes — skip auth tokens
        // and any other non-snapshot keys that live in localStorage.
        if (parsed && typeof parsed.v === "number" && typeof parsed.ts === "number") {
          entries.push({ key: k, ts: parsed.ts });
        }
      } catch {
        // unparseable — not a snapshot, leave it alone
      }
    }
    // Remove oldest entries first (up to half)
    entries.sort((a, b) => a.ts - b.ts);
    const toRemove = entries.slice(0, Math.max(1, Math.ceil(entries.length / 2)));
    for (const { key } of toRemove) {
      ls.removeItem(key);
    }
  } catch {
    // ignore
  }
};

export const writeSnapshot = <T>(key: string, data: T): void => {
  if (typeof window === "undefined") return;
  const envelope: SnapshotEnvelope<T> = {
    v: SNAPSHOT_VERSION,
    ts: Date.now(),
    data,
  };
  const serialized = JSON.stringify(envelope);
  try {
    window.localStorage.setItem(key, serialized);
  } catch {
    // Quota exceeded — evict old entries and retry once
    try {
      evictOldSnapshots(key);
      window.localStorage.setItem(key, serialized);
    } catch {
      // still no space — give up silently
    }
  }
};
