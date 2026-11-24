export const LOOKUP_LIMITS = [0, 1, 2, 3, 5, 10, 15, 20] as const;
export type ReadingMode = "free" | "pace";
export type PaceTab = "setup" | "reader" | "notes";

type SessionData = {
  free: {
    seconds: number;
    percent: number;
    tapped: number[];
    lookedAt: number[];
    marked: number[];
    passageTop: number;
    pageTop: number;
    ratio: number;
  };
  pace: {
    position: number;
    seconds: number;
    wpm: number;
    tab: PaceTab;
    pageTop: number;
    speechOn: boolean;
  };
};

const storageKey = (mode: ReadingMode) => "wpm-" + mode + "-checkpoint";
const nonNegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const indices = (value: unknown): value is number[] => Array.isArray(value) && value.every(index => Number.isSafeInteger(index) && index >= 0);

export function loadReadingSession<M extends ReadingMode>(mode: M, text: string): (SessionData[M] & { savedAt: number }) | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(mode)) || "null");
    if (!saved || saved.text !== text || !nonNegative(saved.savedAt) || !nonNegative(saved.seconds) || !nonNegative(saved.pageTop)) return null;
    if (mode === "free") {
      if (!LOOKUP_LIMITS.some(value => value === saved.percent) || !indices(saved.tapped) || !indices(saved.lookedAt)
        || !indices(saved.marked) || !nonNegative(saved.passageTop) || !nonNegative(saved.ratio) || saved.ratio < 40 || saved.ratio > 75) return null;
    } else if (!nonNegative(saved.position) || !nonNegative(saved.wpm) || saved.wpm < 40 || saved.wpm > 500
      || !["setup", "reader", "notes"].includes(saved.tab) || typeof saved.speechOn !== "boolean") return null;
    return saved;
  } catch { return null; }
}

export function saveReadingSession<M extends ReadingMode>(mode: M, text: string, data: SessionData[M]): boolean {
  try {
    localStorage.setItem(storageKey(mode), JSON.stringify({ text, savedAt: Date.now(), ...data }));
    return true;
  } catch { return false; }
}

export function clearReadingSession(mode: ReadingMode) {
  try { localStorage.removeItem(storageKey(mode)); }
  catch { /* Storage may be disabled. */ }
}

export function latestReadingMode(text: string): ReadingMode {
  const pace = loadReadingSession("pace", text);
  const free = loadReadingSession("free", text);
  return pace && pace.savedAt > (free?.savedAt ?? -1) ? "pace" : "free";
}
