import { validateLesson } from "./lesson.ts";
import type { ReadingLesson } from "./lesson.ts";
import { SAMPLE } from "./sampleLesson.ts";

export const LESSON_KEY = "wpm-shared-lesson";
export function restoreLesson(storage: Pick<Storage, "getItem">): ReadingLesson {
  for (const key of [LESSON_KEY, "wpm-free-lesson", "wpm-reader-v1"]) {
    try {
      const saved = JSON.parse(storage.getItem(key) || "null");
      if (!saved) continue;
      return validateLesson(key === "wpm-reader-v1"
        ? { version: 1, title: "保存した教材", text: saved.text, glosses: [] } : saved);
    } catch { /* Try older saved material, leaving it intact. */ }
  }
  return SAMPLE;
}
export function changeLessonText(lesson: ReadingLesson, text: string): ReadingLesson {
  return text === lesson.text ? lesson : { ...lesson, text, glosses: [] };
}
