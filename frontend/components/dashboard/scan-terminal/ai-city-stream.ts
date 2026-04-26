const AI_CITY_MAX_CONCURRENT = 2;
let aiCityActiveCount = 0;
const aiCityPendingQueue: Array<() => void> = [];

function createAiCityAbortError() {
  return new DOMException("The AI city request was aborted.", "AbortError");
}

function drainAiCityFetchQueue() {
  while (aiCityActiveCount < AI_CITY_MAX_CONCURRENT && aiCityPendingQueue.length) {
    const next = aiCityPendingQueue.shift();
    next?.();
  }
}

export function enqueueAiCityFetch<T>(
  task: () => Promise<T>,
  signal: AbortSignal,
  callbacks?: {
    onQueued?: () => void;
    onStart?: () => void;
  },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let started = false;
    let queuedStart: (() => void) | null = null;

    const cleanup = () => {
      signal.removeEventListener("abort", handleAbort);
    };
    const removeQueuedStart = () => {
      if (!queuedStart) return;
      const index = aiCityPendingQueue.indexOf(queuedStart);
      if (index >= 0) {
        aiCityPendingQueue.splice(index, 1);
      }
      queuedStart = null;
    };
    const finishActive = () => {
      aiCityActiveCount = Math.max(0, aiCityActiveCount - 1);
      cleanup();
      drainAiCityFetchQueue();
    };
    const handleAbort = () => {
      if (started) return;
      removeQueuedStart();
      cleanup();
      reject(createAiCityAbortError());
      drainAiCityFetchQueue();
    };
    const start = () => {
      queuedStart = null;
      if (signal.aborted) {
        cleanup();
        reject(createAiCityAbortError());
        drainAiCityFetchQueue();
        return;
      }
      started = true;
      aiCityActiveCount += 1;
      callbacks?.onStart?.();
      task()
        .then(resolve, reject)
        .finally(finishActive);
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    queuedStart = start;
    if (aiCityActiveCount < AI_CITY_MAX_CONCURRENT) {
      start();
    } else {
      callbacks?.onQueued?.();
      aiCityPendingQueue.push(start);
    }
  });
}

export function parseSseBlock(block: string): { event: string; data: unknown } | null {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim() || "message";
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: raw };
  }
}

function decodeJsonStringFragment(fragment: string) {
  const safe = fragment.replace(/\\$/g, "");
  try {
    return JSON.parse(`"${safe.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return safe
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
  }
}

function extractStreamingJsonField(raw: string, field: string) {
  const keyIndex = raw.indexOf(`"${field}"`);
  if (keyIndex < 0) return "";
  const colonIndex = raw.indexOf(":", keyIndex);
  if (colonIndex < 0) return "";
  const quoteIndex = raw.indexOf('"', colonIndex + 1);
  if (quoteIndex < 0) return "";
  let end = raw.length;
  let escaped = false;
  for (let i = quoteIndex + 1; i < raw.length; i += 1) {
    const char = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      end = i;
      break;
    }
  }
  return decodeJsonStringFragment(raw.slice(quoteIndex + 1, end)).trim();
}

export function extractStreamingAirportRead(raw: string, locale: string) {
  const primaryField = locale === "en-US" ? "metar_read_en" : "metar_read_zh";
  const fallbackField = locale === "en-US" ? "metar_read_zh" : "metar_read_en";
  return (
    extractStreamingJsonField(raw, primaryField) ||
    extractStreamingJsonField(raw, fallbackField)
  );
}
