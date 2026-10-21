import test from "node:test";
import assert from "node:assert/strict";
import { tokenize, validateLesson, allowance, measuredWpm, lookupKey } from "../src/lesson.ts";
import { SAMPLE } from "../src/sampleLesson.ts";

test("word indices preserve punctuation, paragraphs, contractions, and source offsets", () => {
  const text = "“Don't stop,” she said.\n\nA well-known idea—isn't new.";
  const tokens = tokenize(text);
  assert.deepEqual(tokens.map(t => t.word), ["Don't","stop","she","said","A","well-known","idea","isn't","new"]);
  tokens.forEach(t => assert.equal(text.slice(t.start, t.stop), t.word));
});
test("all sample occurrences are mapped, including lexical and auxiliary have", () => {
  const lesson = validateLesson(SAMPLE);
  assert.equal(lesson.glosses.length, tokenize(lesson.text).length);
  assert.equal(lesson.glosses[1].pos, "動詞");
  assert.equal(lesson.glosses[5].pos, "助動詞");
  assert.equal(lookupKey("Have"), lookupKey("have"));
  assert.equal(lookupKey("don’t"), lookupKey("don't"));
});
test("stale, duplicate, invalid and oversized glosses are rejected", () => {
  for (const bad of [
    { ...SAMPLE, version: 2 },
    { ...SAMPLE, text: "We have a notebook." },
    { ...SAMPLE, glosses: [SAMPLE.glosses[0], SAMPLE.glosses[0]] },
    { ...SAMPLE, glosses: [{ ...SAMPLE.glosses[0], end: 999 }] },
    { ...SAMPLE, glosses: [{ ...SAMPLE.glosses[0], meaning: "" }] },
    { ...SAMPLE, glosses: [{ ...SAMPLE.glosses[0], index: -1 }] },
    { ...SAMPLE, text: "word ".repeat(1001) },
    { ...SAMPLE, text: "a".repeat(12001) },
    null,
  ]) assert.throws(() => validateLesson(bad));
});
test("plain text lessons and roundtrip exports stay valid", () => {
  assert.deepEqual(validateLesson(JSON.parse(JSON.stringify(SAMPLE))), SAMPLE);
  assert.equal(validateLesson({ ...SAMPLE, glosses: [] }).glosses.length, 0);
});
test("limits floor partial words; zero and full allowance work", () => {
  assert.equal(allowance(18, 0), 0);
  assert.equal(allowance(18, 10), 1);
  assert.equal(allowance(18, 100), 18);
});
test("WPM uses elapsed seconds, not display timer ticks", () => {
  assert.equal(measuredWpm(300, 120), 150);
  assert.equal(measuredWpm(18, 7.5), 144);
  assert.equal(measuredWpm(18, 0), 0);
});
