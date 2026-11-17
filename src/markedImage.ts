import { tokenize } from "./lesson.ts";
import type { ReadingLesson } from "./lesson.ts";

export const MARKER_COLOR = "#ffeb3b";
type Run = { text: string; offset: number; x: number; line: number };

// Wrap by measured width, retaining source offsets so only tapped occurrences are colored.
export function layoutText(text: string, width: number, measure: (text: string) => number) {
  const runs: Run[] = [];
  let x = 0, line = 0, newlines = 0;
  for (const match of text.matchAll(/\r\n|\r|\n|[^\S\r\n]+|[^\s]+/gu)) {
    const value = match[0];
    if (/^[\r\n]/.test(value)) {
      if (newlines < 2) { line++; x = 0; }
      newlines++;
      continue;
    }
    if (/^\s/.test(value)) { if (x) x += measure(" "); continue; }
    newlines = 0;
    if (x && x + measure(value) > width) { x = 0; line++; }
    let part = "", offset = match.index;
    for (const char of value) {
      if (part && measure(part + char) > width) {
        runs.push({ text: part, offset, x, line });
        offset += part.length; part = ""; x = 0; line++;
      }
      part += char;
    }
    if (part) { runs.push({ text: part, offset, x, line }); x += measure(part); }
  }
  return { runs, lines: line + 1 };
}

export async function renderMarkedLesson(lesson: ReadingLesson, tapped: readonly number[]) {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("このブラウザでは画像を作成できません。");
  const width = 1440, margin = 64, bodySize = 30, lineHeight = 46;
  const measure = (text: string) => ctx.measureText(text).width;
  ctx.font = 'bold 40px Arial, sans-serif';
  const title = layoutText(lesson.title, width - margin * 2, measure);
  ctx.font = `${bodySize}px Arial, sans-serif`;
  const body = layoutText(lesson.text, width - margin * 2, measure);
  const bodyTop = margin + title.lines * 54 + 30;
  const height = bodyTop + body.lines * lineHeight + margin;
  // Stay within conservative canvas dimensions/memory limits on mobile devices.
  const scale = Math.min(1, 8192 / height, Math.sqrt(12_000_000 / (width * height)));
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale); ctx.textBaseline = "top";
  ctx.fillStyle = "#000000"; ctx.font = 'bold 40px Arial, sans-serif';
  for (const run of title.runs) ctx.fillText(run.text, margin + run.x, margin + run.line * 54);
  ctx.font = `${bodySize}px Arial, sans-serif`;
  const chosen = new Set(tapped);
  const marked = tokenize(lesson.text).filter(word => chosen.has(word.index));
  for (const run of body.runs) {
    const x = margin + run.x, y = bodyTop + run.line * lineHeight;
    for (const word of marked) {
      const start = Math.max(word.start, run.offset), stop = Math.min(word.stop, run.offset + run.text.length);
      if (stop <= start) continue;
      const left = measure(run.text.slice(0, start - run.offset));
      const right = measure(run.text.slice(0, stop - run.offset));
      ctx.fillStyle = MARKER_COLOR;
      ctx.fillRect(x + left, y, right - left, bodySize + 5);
    }
    ctx.fillStyle = "#000000"; ctx.fillText(run.text, x, y);
  }
  return canvas;
}

export async function downloadMarkedLesson(lesson: ReadingLesson, tapped: readonly number[]) {
  const canvas = await renderMarkedLesson(lesson, tapped);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("画像を作成できませんでした。")), "image/png"));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `${lesson.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 80) || "reading"}-marked.png`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
