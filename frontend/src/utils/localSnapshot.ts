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

export const writeSnapshot = <T>(key: string, data: T): void => {
  if (typeof window === "undefined") return;
  try {
    const envelope: SnapshotEnvelope<T> = {
      v: SNAPSHOT_VERSION,
      ts: Date.now(),
      data,
    };
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // ignore quota/storage errors
  }
};
