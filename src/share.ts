import { validateLesson } from "./lesson.ts";
import type { ReadingLesson } from "./lesson.ts";

// ペース読解モードが #lesson= を使うため、自由読解は別のキーを使う。
export const SHARE_PREFIX = "free=";
// QR（バージョン40-L）の上限は2,953バイト。教室の画面やスマホで読み取りやすいよう2,000文字を上限にする。
export const MAX_SHARE_URL_LENGTH = 2000;
const MAX_PAYLOAD_LENGTH = 100_000;
const MAX_INFLATED_BYTES = 200_000;
export const TOO_LONG_MESSAGE = "教材が長いためQRにできません。「公開URLで共有」を使うと短いURLとQRで配布できます（書き出したJSONを public/lessons/ に置いて push し、ファイル名を入力）。";
const BAD_LINK_MESSAGE = "共有リンクを読み込めませんでした。リンクが壊れているか、正しい教材ではありません。";

async function pump(input: Uint8Array, stream: CompressionStream | DecompressionStream, maxBytes = Infinity) {
  const writer = stream.writable.getWriter();
  writer.write(input as BufferSource).then(() => writer.close()).catch(() => {});
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); throw new Error("size"); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}
function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function fromBase64Url(text: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error("format");
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

export async function encodeLesson(lesson: ReadingLesson) {
  const json = new TextEncoder().encode(JSON.stringify(validateLesson(lesson)));
  return toBase64Url(await pump(json, new CompressionStream("deflate-raw")));
}
// URL由来のデータは信頼せず、必ず validateLesson を通す。
export async function decodeLesson(payload: string): Promise<ReadingLesson> {
  let parsed: unknown;
  try {
    if (payload.length > MAX_PAYLOAD_LENGTH) throw new Error("size");
    const bytes = await pump(fromBase64Url(payload), new DecompressionStream("deflate-raw"), MAX_INFLATED_BYTES);
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { throw new Error(BAD_LINK_MESSAGE); }
  return validateLesson(parsed);
}
export function shareUrlFor(base: string, payload: string) {
  const url = `${base.split("#")[0]}#${SHARE_PREFIX}${payload}`;
  if (url.length > MAX_SHARE_URL_LENGTH) throw new Error(TOO_LONG_MESSAGE);
  return url;
}
export async function createShareUrl(lesson: ReadingLesson, base: string) {
  return shareUrlFor(base, await encodeLesson(lesson));
}
export function payloadFromHash(hash: string) {
  const h = hash.replace(/^#/, "");
  return h.startsWith(SHARE_PREFIX) ? h.slice(SHARE_PREFIX.length) : null;
}
