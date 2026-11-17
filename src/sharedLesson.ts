import { validateLesson } from "./lesson.ts";
import type { ReadingLesson } from "./lesson.ts";
import { SAMPLE } from "./sampleLesson.ts";

const LEGACY_PACE_SAMPLE = `A small change in the way we read can make a big difference. When readers try to understand every single word, they often lose the main idea. Skilled readers move forward at a steady pace. They notice key words, connect ideas, and adjust their speed when the text becomes difficult.\n\nReading faster does not mean rushing. It means using your attention wisely. Start with a comfortable goal, follow the highlighted words, and keep moving. After reading, pause and write the most important idea in your own words. This short reflection helps turn speed into real understanding.`;

export const LESSON_KEY = "wpm-shared-lesson";
export function restoreLesson(storage: Pick<Storage, "getItem">): ReadingLesson | null {
  for (const key of [LESSON_KEY, "wpm-free-lesson", "wpm-reader-v1"]) {
    try {
      const saved = JSON.parse(storage.getItem(key) || "null");
      if (key === LESSON_KEY && storage.getItem(key) === "null") return null;
      if (!saved) continue;
      if (saved.text === SAMPLE.text && saved.title === SAMPLE.title) continue;
      if (key === "wpm-reader-v1" && saved.text === LEGACY_PACE_SAMPLE) continue;
      return validateLesson(key === "wpm-reader-v1"
        ? { version: 1, title: "保存した教材", text: saved.text, glosses: [] } : saved);
    } catch { /* Try older saved material, leaving it intact. */ }
  }
  return null;
}
export function changeLessonText(lesson: ReadingLesson, text: string): ReadingLesson {
  return text === lesson.text ? lesson : { ...lesson, text, glosses: [] };
}
