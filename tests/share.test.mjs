import test from "node:test";
import assert from "node:assert/strict";
import { encodeLesson, decodeLesson, shareUrlFor, createShareUrl, payloadFromHash, MAX_SHARE_URL_LENGTH, TOO_LONG_MESSAGE } from "../src/share.ts";
import { SAMPLE } from "../src/sampleLesson.ts";

const BASE = "https://example.github.io/wpm-reader-classroom/";
const raw = async (value, format = "deflate-raw") => {
  const stream = new Blob([typeof value === "string" ? value : JSON.stringify(value)]).stream().pipeThrough(new CompressionStream(format));
  return Buffer.from(await new Response(stream).arrayBuffer()).toString("base64url");
};

test("encode/decode roundtrip keeps the lesson and uses URL-safe characters", async () => {
  const payload = await encodeLesson(SAMPLE);
  assert.match(payload, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeLesson(payload), SAMPLE);
  const url = await createShareUrl(SAMPLE, `${BASE}#old`);
  assert.ok(url.startsWith(`${BASE}#free=`));
  assert.deepEqual(await decodeLesson(payloadFromHash(new URL(url).hash)), SAMPLE);
  assert.equal(payloadFromHash("#lesson=abc"), null);
});
test("invalid share data is rejected", async () => {
  for (const bad of ["", "!!!", "abc", "A".repeat(200), "A".repeat(100_001)])
    await assert.rejects(decodeLesson(bad));
  await assert.rejects(decodeLesson(await raw("not json")));
  await assert.rejects(decodeLesson(await raw({ ...SAMPLE, version: 2 })));
  await assert.rejects(decodeLesson(await raw({ ...SAMPLE, glosses: [{ ...SAMPLE.glosses[0], word: "zzz" }] })));
  await assert.rejects(decodeLesson(await raw({ ...SAMPLE, title: "<img src=x onerror=alert(1)>".repeat(5) })));
});
test("decompression bombs are rejected", async () => {
  await assert.rejects(decodeLesson(await raw("a".repeat(5_000_000))));
});
test("too-long lessons are refused with a Japanese message", async () => {
  const text = Array.from({ length: 600 }, (_, i) => `w${(i * 7919 % 100000).toString(36)}x${i}`).join(" ");
  await assert.rejects(createShareUrl({ version: 1, title: "long", text, glosses: [] }, BASE), { message: TOO_LONG_MESSAGE });
  assert.throws(() => shareUrlFor(BASE, "a".repeat(MAX_SHARE_URL_LENGTH)), { message: TOO_LONG_MESSAGE });
  assert.doesNotThrow(() => shareUrlFor(BASE, "a".repeat(100)));
});
