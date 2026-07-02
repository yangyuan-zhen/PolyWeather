import {
  readScanCache,
  writeScanCache,
} from "@/components/dashboard/scan-terminal/use-scan-terminal-query";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const originalLocalStorage = globalThis.localStorage;
  const storage = new Map<string, string>();
  const memoryStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => { storage.delete(key); },
    setItem: (key: string, value: string) => { storage.set(key, value); },
  } as Storage;

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memoryStorage,
  });

  try {
    writeScanCache(
      {
        generated_at: "2026-07-02T12:00:00Z",
        rows: [{ city: "ankara", deb_prediction: 20.3 } as any],
        status: "ready",
      } as any,
      "all",
      "model-summary",
    );
    assert(
      readScanCache("all", "model-summary", { allowStale: true })?.rows?.length === 1,
      "non-empty scan cache should remain readable",
    );

    writeScanCache(
      {
        generated_at: "2026-07-02T12:05:00Z",
        rows: [],
        status: "ready",
      } as any,
      "all",
      "model-summary",
    );
    assert(
      readScanCache("all", "model-summary", { allowStale: true }) === null,
      "empty scan cache responses must be ignored so model summary can revalidate rows",
    );
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
  }
}
