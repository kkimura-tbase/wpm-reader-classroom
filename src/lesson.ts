export type Gloss = { index: number; word: string; lemma: string; pos: string; meaning: string; note?: string; end?: number };
export type ReadingLesson = { version: 1; title: string; text: string; glosses: Gloss[] };
export type ReadingRecord = { id: string; date: string; title: string; text: string; words: number; seconds: number; wpm: number; used: number; percent: number };

// Word indices are independent of whitespace and punctuation; apostrophes and hyphens stay inside words.
export function tokenize(text: string) {
  const expression = /[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g;
  return Array.from(text.matchAll(expression), (match, index) => ({
    index, word: match[0], start: match.index!, stop: match.index! + match[0].length,
  }));
}
export function lookupKey(word: string) { return word.toLowerCase().replaceAll("’", "'"); }
export function allowance(words: number, percent: number) { return Math.floor(words * percent / 100); }
export function measuredWpm(words: number, seconds: number) { return seconds > 0 ? Math.round(words * 60 / seconds) : 0; }

export function validateLesson(input: unknown): ReadingLesson {
  if (!input || typeof input !== "object") throw new Error("教材はJSON形式のオブジェクトにしてください。");
  const value = input as Record<string, unknown>;
  if (value.version !== 1 || typeof value.title !== "string" || !value.title.trim() || value.title.length > 80 ||
    typeof value.text !== "string" || !value.text.trim() || value.text.length > 12000 || !Array.isArray(value.glosses)) {
    throw new Error("version・title・text・glossesを確認してください（本文12,000文字まで）。");
  }
  const words = tokenize(value.text);
  if (!words.length || words.length > 1000 || value.glosses.length > words.length) throw new Error("教材は1〜1,000語、解説は各単語につき1件までです。");
  const seen = new Set<number>();
  const glosses = value.glosses.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("解説の形式が正しくありません。");
    const g = entry as Gloss;
    if (!Number.isInteger(g.index) || !words[g.index] || seen.has(g.index) || words[g.index].word !== g.word)
      throw new Error(`解説の位置と単語が一致しません：${String(g.index)} / ${String(g.word)}`);
    for (const key of ["lemma", "pos", "meaning"] as const)
      if (typeof g[key] !== "string" || !g[key].trim() || g[key].length > 1000) throw new Error(`${g.word}の${key}を確認してください。`);
    if (g.note !== undefined && (typeof g.note !== "string" || g.note.length > 2000)) throw new Error("補足は2,000文字までです。");
    if (g.end !== undefined && (!Number.isInteger(g.end) || g.end <= g.index || g.end > words.length)) throw new Error("語句の終了位置が正しくありません。");
    seen.add(g.index);
    return { index: g.index, word: g.word, lemma: g.lemma, pos: g.pos, meaning: g.meaning, ...(g.note !== undefined ? { note: g.note } : {}), ...(g.end !== undefined ? { end: g.end } : {}) };
  });
  return { version: 1, title: value.title, text: value.text, glosses };
}
export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
