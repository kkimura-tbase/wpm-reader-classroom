import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveLessonSrc, createSrcShareUrl, srcFromSearch, fetchLesson, MAX_LESSON_BYTES } from "../src/sharesrc.ts";
import { SAMPLE } from "../src/sampleLesson.ts";

const PAGE = "https://kkimura-tbase.github.io/wpm-reader-classroom/?src=x#hash";
const ROOT = "https://kkimura-tbase.github.io/wpm-reader-classroom/lessons/";
const reply = (body, init = {}) => async () => new Response(body, { status: 200, ...init });

test("allowed src values resolve under lessons/", () => {
  assert.equal(resolveLessonSrc("foo.json", PAGE), `${ROOT}foo.json`);
  assert.equal(resolveLessonSrc("lessons/foo.json", PAGE), `${ROOT}foo.json`);
  assert.equal(resolveLessonSrc("lessons/a/b.json", PAGE), `${ROOT}a/b.json`);
  assert.equal(resolveLessonSrc(`${ROOT}foo.json`, PAGE), `${ROOT}foo.json`);
  assert.equal(resolveLessonSrc("foo.json", "http://localhost:5173/"), "http://localhost:5173/lessons/foo.json");
});
test("unsafe src values are rejected", () => {
  const bad = ["", "  ", "../foo.json", "lessons/../foo.json", "lessons/../../x.json", "a/../../x.json", "%2e%2e/foo.json",
    "lessons/%2e%2e/x.json", "lessons/..%2fx.json", "..\\foo.json", "/foo.json", "/lessons/foo.json", "//evil.example/lessons/foo.json",
    "https://evil.example/lessons/foo.json", "https://kkimura-tbase.github.io/other/lessons/foo.json",
    "https://kkimura-tbase.github.io/wpm-reader-classroom/foo.json", "javascript:alert(1)", "data:application/json,{}",
    "foo.txt", "lessons/", "lessons/.json/", "foo.json?x=1", "foo.json#a", "lessons//foo.json", "a".repeat(400) + ".json",
    "https://user:pw@kkimura-tbase.github.io/wpm-reader-classroom/lessons/foo.json"];
  for (const value of bad) assert.throws(() => resolveLessonSrc(value, PAGE), /教材の場所/, value);
});
test("share url keeps the app page and uses a relative src", () => {
  assert.equal(createSrcShareUrl("foo.json", PAGE), "https://kkimura-tbase.github.io/wpm-reader-classroom/?src=lessons%2Ffoo.json");
  assert.equal(srcFromSearch(new URL(createSrcShareUrl("foo.json", PAGE)).search), "lessons/foo.json");
  assert.equal(srcFromSearch("?a=1"), null);
  assert.throws(() => createSrcShareUrl("../x.json", PAGE));
});
test("fetchLesson validates the downloaded lesson", async () => {
  assert.deepEqual(await fetchLesson("foo.json", PAGE, reply(JSON.stringify(SAMPLE))), SAMPLE);
  const sample = JSON.parse(readFileSync(new URL("../public/lessons/sample.json", import.meta.url), "utf8"));
  assert.equal((await fetchLesson("sample.json", PAGE, reply(JSON.stringify(sample)))).version, 1);
});
test("fetchLesson rejects bad responses", async () => {
  await assert.rejects(fetchLesson("foo.json", PAGE, reply("not json")));
  await assert.rejects(fetchLesson("foo.json", PAGE, reply(JSON.stringify({ ...SAMPLE, version: 2 }))));
  await assert.rejects(fetchLesson("foo.json", PAGE, reply(JSON.stringify({ ...SAMPLE, glosses: [{ ...SAMPLE.glosses[0], word: "zzz" }] }))));
  await assert.rejects(fetchLesson("foo.json", PAGE, reply("nope", { status: 404 })));
  await assert.rejects(fetchLesson("foo.json", PAGE, reply("{}", { headers: { "content-length": String(MAX_LESSON_BYTES + 1) } })));
  await assert.rejects(fetchLesson("foo.json", PAGE, reply(" ".repeat(MAX_LESSON_BYTES + 1))));
  await assert.rejects(fetchLesson("../foo.json", PAGE, () => { throw new Error("must not fetch"); }), /教材の場所/);
});
