import type { ReadingLesson } from "./lesson";
export const SAMPLE: ReadingLesson = {
  version: 1, title: "Small steps — 解説付きサンプル",
  text: "I have a notebook. I have written three ideas in it.\n\nSmall steps can make a big difference.",
  glosses: [
    ["I","I","代名詞","私は"], ["have","have","動詞","持っている"], ["a","a","冠詞","一つの"],
    ["notebook","notebook","名詞","ノート"], ["I","I","代名詞","私は"],
    ["have","have","助動詞","現在完了を作る", "have + 過去分詞。ここでは「書き終えて、今その内容がある」という完了・結果を表す。",7],
    ["written","write","動詞（過去分詞）","書いた","have writtenで「書き終えた」。"],
    ["three","three","数詞","三つの"], ["ideas","idea","名詞","考え、アイデア"],
    ["in","in","前置詞","〜の中に"], ["it","it","代名詞","それ（ノート）"],
    ["Small","small","形容詞","小さな"], ["steps","step","名詞","一歩一歩の行動"],
    ["can","can","助動詞","〜することがある"], ["make","make","動詞","生み出す","make a differenceで「変化をもたらす」。",18],
    ["a","a","冠詞","一つの"], ["big","big","形容詞","大きな"], ["difference","difference","名詞","違い、変化"],
  ].map(([word, lemma, pos, meaning, note, end], index) => ({
    index, word: String(word), lemma: String(lemma), pos: String(pos), meaning: String(meaning),
    ...(note ? { note: String(note) } : {}), ...(end ? { end: Number(end) } : {}),
  })),
};
