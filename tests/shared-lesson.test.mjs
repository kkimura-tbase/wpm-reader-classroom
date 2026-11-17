import test from "node:test";
import assert from "node:assert/strict";
import { restoreLesson, changeLessonText, LESSON_KEY } from "../src/sharedLesson.ts";
import { SAMPLE } from "../src/sampleLesson.ts";
const storage = data => ({ getItem: key => data[key] ?? null });

test("shared material wins over stale per-mode copies and retains contextual glosses", () => {
  const current = { ...SAMPLE, title: "Imported lesson" };
  assert.deepEqual(restoreLesson(storage({ [LESSON_KEY]: JSON.stringify(current), "wpm-free-lesson": JSON.stringify(SAMPLE), "wpm-reader-v1": JSON.stringify({ text: "Old text." }) })), current);
});
test("existing free or pace material migrates without changing source storage", () => {
  assert.deepEqual(restoreLesson(storage({ "wpm-free-lesson": JSON.stringify(SAMPLE) })), SAMPLE);
  const migrated = restoreLesson(storage({ [LESSON_KEY]: "broken", "wpm-reader-v1": JSON.stringify({ text: "Saved pace text." }) }));
  assert.equal(migrated.text, "Saved pace text.");
  assert.deepEqual(migrated.glosses, []);
  assert.deepEqual(restoreLesson({ getItem() { throw new Error("denied"); } }), SAMPLE);
});
test("unchanged text keeps glosses; editing clears position-dependent glosses", () => {
  assert.equal(changeLessonText(SAMPLE, SAMPLE.text), SAMPLE);
  assert.deepEqual(changeLessonText(SAMPLE, "New text."), { ...SAMPLE, text: "New text.", glosses: [] });
  assert.ok(SAMPLE.glosses.length);
});
