import { validateLesson } from "./lesson.ts";
import type { ReadingLesson } from "./lesson.ts";

export const SRC_PARAM = "src";
export const LESSONS_DIR = "lessons/";
export const MAX_LESSON_BYTES = 2_000_000;

const dirOf = (pageUrl: URL) => pageUrl.origin + pageUrl.pathname.replace(/[^/]*$/, "");

// ?src= の値を検証し、同一オリジンの lessons/ 配下の絶対URLだけを返す。
export function resolveLessonSrc(input: string, pageUrl: string): string {
  const raw = input.trim();
  const fail = () => new Error("教材の場所が正しくありません。同じサイトの lessons/ 配下の .json ファイルだけ指定できます。");
  if (!raw || raw.length > 300 || /[\u0000-\u001f\\?#]/.test(raw)) throw fail();
  const page = new URL(pageUrl);
  const dir = dirOf(page);
  let target: URL;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) {
      target = new URL(raw);
    } else {
      if (raw.startsWith("/")) throw fail();
      const rel = raw.startsWith(LESSONS_DIR) ? raw : LESSONS_DIR + raw;
      target = new URL(rel, dir);
    }
  } catch { throw fail(); }
  if (target.protocol !== "https:" && target.protocol !== "http:") throw fail();
  if (target.origin !== page.origin || target.search || target.hash || target.username || target.password) throw fail();
  let path: string;
  try { path = decodeURIComponent(target.pathname); } catch { throw fail(); }
  const base = new URL(dir).pathname + LESSONS_DIR;
  if (!path.startsWith(base) || !path.toLowerCase().endsWith(".json")) throw fail();
  const rest = path.slice(base.length);
  if (!rest || rest.split("/").some(s => s === "" || s === "." || s === "..") || /[\\\u0000-\u001f]/.test(rest)) throw fail();
  if (target.pathname.includes("%2e") || target.pathname.includes("%2E") || target.pathname.includes("%2f") || target.pathname.includes("%2F") || target.pathname.includes("%5c") || target.pathname.includes("%5C")) throw fail();
  return target.href;
}

// 共有用リンク: アプリのページURLに ?src=<lessons/ 以下の相対パス> を付ける。
export function createSrcShareUrl(input: string, pageUrl: string): string {
  const resolved = new URL(resolveLessonSrc(input, pageUrl));
  const page = new URL(pageUrl);
  const rel = resolved.pathname.slice(new URL(dirOf(page)).pathname.length);
  const url = new URL(page.origin + page.pathname);
  url.searchParams.set(SRC_PARAM, rel);
  return url.href;
}

export function srcFromSearch(search: string): string | null {
  return new URLSearchParams(search).get(SRC_PARAM);
}

async function readLimited(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > MAX_LESSON_BYTES) throw new Error("size");
  if (!res.body) {
    const text = await res.text();
    if (new TextEncoder().encode(text).length > MAX_LESSON_BYTES) throw new Error("size");
    return text;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_LESSON_BYTES) { await reader.cancel(); throw new Error("size"); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(all);
}

export async function fetchLesson(input: string, pageUrl: string, fetchImpl: typeof fetch = fetch): Promise<ReadingLesson> {
  const url = resolveLessonSrc(input, pageUrl);
  let parsed: unknown;
  try {
    const res = await fetchImpl(url, { credentials: "omit", redirect: "error", cache: "no-cache" });
    if (!res.ok) throw new Error("http");
    parsed = JSON.parse(await readLimited(res));
  } catch { throw new Error("公開された教材を取得できませんでした。ファイルが存在するか、2MB以下の正しいJSONか確認してください。"); }
  return validateLesson(parsed);
}
