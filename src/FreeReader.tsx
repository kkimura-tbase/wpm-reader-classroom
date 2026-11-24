import { memo, useEffect, useMemo, useRef, useState } from "react";
import Board from "./NotesBoard";
import type { NotesControls } from "./NotesBoard";
import { downloadMarkedLesson } from "./markedImage";
import { allowance, downloadJson, lookupKey, measuredWpm, tokenize } from "./lesson";
import type { ReadingLesson, ReadingRecord } from "./lesson";
import { clearReadingSession, loadReadingSession, LOOKUP_LIMITS, saveReadingSession } from "./readingSession";

const NotesBoard = memo(Board);
const DEFAULT_RATIO = 50;

function storedRecords(): ReadingRecord[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem("wpm-free-history") || "[]");
    return Array.isArray(data) ? data.filter((r): r is ReadingRecord => r && typeof r.id === "string" && typeof r.date === "string" && typeof r.title === "string" && typeof r.text === "string" && ["words","seconds","wpm","used","percent"].every(k => typeof r[k] === "number" && Number.isFinite(r[k]))).slice(0, 100) : [];
  } catch { return []; }
}
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function FreeReader({ onBusy, lesson, setLesson }: { onBusy: (busy: boolean) => void; lesson: ReadingLesson; setLesson: (lesson: ReadingLesson) => void }) {
  const [restored] = useState(() => loadReadingSession("free", lesson.text));
  const [records, setRecords] = useState(storedRecords);
  const [phase, setPhase] = useState<"ready" | "reading" | "paused" | "done">(restored ? "paused" : "ready");
  const [percent, setPercent] = useState(restored?.percent ?? 5);
  const [lookedAt, setLookedAt] = useState<number[]>(restored?.lookedAt ?? []);
  const [marked, setMarked] = useState<number[]>(restored?.marked ?? []);
  const [tapped, setTapped] = useState<number[]>(restored?.tapped ?? []);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(restored?.seconds ?? 0);
  const [result, setResult] = useState<ReadingRecord | null>(null);
  const [setupOpen, setSetupOpen] = useState(!restored);
  const readingPanelRef = useRef<HTMLElement>(null);
  const passageRef = useRef<HTMLElement>(null);
  const notesRef = useRef<NotesControls>(null);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [ratio, setRatio] = useState(restored?.ratio ?? DEFAULT_RATIO);
  const [notesLeft, setNotesLeft] = useState(() => {
    try { return JSON.parse(localStorage.getItem("wpm-free-notes-left") || "false") === true; }
    catch { return false; }
  });
  const [popup, setPopup] = useState({ top: 80, left: 20, maxHeight: 320 });
  const startRef = useRef<number | null>(null);
  const accumulated = useRef(restored?.seconds ?? 0);
  const loadedText = useRef(lesson.text);
  const [savingPause, setSavingPause] = useState(false);
  const words = useMemo(() => tokenize(lesson.text), [lesson.text]);
  const glosses = useMemo(() => new Map(lesson.glosses.map(g => [g.index, g])), [lesson.glosses]);
  const used = useMemo(() => [...new Set(lookedAt.flatMap(index => words[index] ? [lookupKey(words[index].word)] : []))], [lookedAt, words]);
  const limit = allowance(words.length, percent);
  const token = selected === null ? undefined : words[selected];
  const gloss = selected === null ? undefined : glosses.get(selected);
  const canSee = phase === "done" || ((phase === "reading" || phase === "paused") && !!token && used.includes(lookupKey(token.word)));
  const previous = result ? records.find(r => r.id !== result.id && r.text === result.text && r.percent === result.percent) : undefined;

  function save(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); setSaveError(""); }
    catch { setSaveError("端末に保存できませんでした。必要な教材・履歴はファイルで保存してください。"); }
  }

  useEffect(() => { save("wpm-free-notes-left", notesLeft); }, [notesLeft]);
  useEffect(() => {
    onBusy(phase === "reading" || savingPause);
    return () => onBusy(false);
  }, [phase, savingPause, onBusy]);
  useEffect(() => {
    if (phase !== "reading") return;
    const tick = () => setSeconds(elapsedNow());
    const id = window.setInterval(tick, 250);
    return () => clearInterval(id);
  }, [phase]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    const dismiss = () => setSelected(null);
    window.addEventListener("keydown", escape);
    window.addEventListener("scroll", dismiss);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, []);

  useEffect(() => {
    if (loadedText.current === lesson.text) return;
    loadedText.current = lesson.text;
    resetReading();
    clearReadingSession("pace");
  }, [lesson.text]);

  useEffect(() => {
    if (!restored) return;
    const frame = requestAnimationFrame(() => {
      if (passageRef.current) passageRef.current.scrollTop = restored.passageTop;
      window.scrollTo({ top: restored.pageTop, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [restored]);

  function elapsedNow() {
    return accumulated.current + (startRef.current === null ? 0 : (performance.now() - startRef.current) / 1000);
  }
  function saveProgress(elapsed: number) {
    return saveReadingSession("free", lesson.text, {
      seconds: elapsed, percent, tapped, lookedAt, marked, ratio,
      passageTop: passageRef.current?.scrollTop ?? 0, pageTop: window.scrollY,
    });
  }
  async function pauseReading() {
    if (startRef.current === null) return;
    accumulated.current = elapsedNow();
    startRef.current = null;
    setSeconds(accumulated.current);
    setSelected(null);
    setPhase("paused");
    setSavingPause(true);
    const saved = saveProgress(accumulated.current);
    const notesSaved = await notesRef.current?.checkpoint();
    setSavingPause(false);
    setMessage(saved && notesSaved !== false ? "この端末に保存しました。" : "保存できない内容があります。この画面を開いたままにしてください。");
  }
  function resumeReading() {
    if (savingPause || startRef.current !== null) return;
    startRef.current = performance.now();
    setMessage("");
    setPhase("reading");
  }
  useEffect(() => {
    const checkpoint = () => {
      if (phase === "reading") void pauseReading();
      if (phase === "paused") saveProgress(accumulated.current);
    };
    const onHide = () => { if (document.visibilityState === "hidden") checkpoint(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", checkpoint);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", checkpoint);
    };
  }, [phase, lesson.text, percent, tapped, lookedAt, marked, ratio]);
  useEffect(() => {
    if (phase === "paused" && !savingPause && (tapped !== restored?.tapped || lookedAt !== restored?.lookedAt || marked !== restored?.marked || ratio !== restored?.ratio)) {
      saveProgress(accumulated.current);
    }
  }, [tapped, lookedAt, marked, ratio]);

  async function exportImage() {
    setExporting(true); setExportMessage("");
    try { await downloadMarkedLesson(lesson, tapped); }
    catch (error) { setExportMessage(error instanceof Error ? error.message : "画像を保存できませんでした。"); }
    finally { setExporting(false); }
  }
  function focusReading() {
    requestAnimationFrame(() => {
      if (passageRef.current) passageRef.current.scrollTop = 0;
      readingPanelRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    });
  }
  function prepareReread() {
    if (tapped.length && !confirm("再読すると黄色マーカーが消えます。必要な画像は保存しましたか？")) return;
    resetReading(); focusReading();
  }
  function resetReading() {
    clearReadingSession("free");
    accumulated.current = 0;
    setMessage("");
    setSetupOpen(true);
    setTapped([]); setExportMessage("");
    setPhase("ready"); setLookedAt([]); setMarked([]); setSelected(null); setSeconds(0); setResult(null); startRef.current = null;
  }
  function resetAll() {
    if (!confirm("計測・設定・黄色マーカー・手書きメモをリセットしますか？教材と読書記録は残ります。")) return;
    notesRef.current?.reset();
    resetReading(); setPercent(5); setRatio(DEFAULT_RATIO); setNotesLeft(false); setMessage("");
    if (passageRef.current) passageRef.current.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function start() {
    if (!words.length || words.length > 1000 || startRef.current !== null) return;
    setSelected(null); setLookedAt([]); setMarked([]); setResult(null); setSeconds(0);
    accumulated.current = 0;
    startRef.current = performance.now(); setPhase("reading"); setMessage("");
    setSetupOpen(false); focusReading();
  }
  function finish() {
    if (phase !== "reading" && phase !== "paused") return;
    const elapsed = Math.max(0.001, elapsedNow());
    startRef.current = null;
    clearReadingSession("free");
    const record: ReadingRecord = { id: crypto.randomUUID(), date: new Date().toISOString(), title: lesson.title, text: lesson.text, words: words.length, seconds: elapsed, wpm: measuredWpm(words.length, elapsed), used: used.length, percent };
    const next = [record, ...records].slice(0, 100);
    setSeconds(elapsed); setResult(record); setRecords(next); save("wpm-free-history", next); setPhase("done"); setSelected(null);
    requestAnimationFrame(() => passageRef.current?.querySelector(".fr-passage-end")?.scrollIntoView({ block: "end", behavior: "instant" }));
  }
  function choose(index: number) {
    if (phase !== "paused") setTapped(old => old.includes(index) ? old : [...old, index]);
    if (selected === index) {
      setSelected(null);
      return;
    }
    const anchor = document.querySelector(`[data-word-index="${index}"]`)?.getBoundingClientRect();
    if (anchor) {
      const below = window.innerHeight - anchor.bottom - 20;
      const above = anchor.top - 20;
      const openBelow = below >= 240 || below >= above;
      const maxHeight = Math.max(40, Math.min(360, openBelow ? below : above));
      setPopup({
        top: openBelow ? anchor.bottom + 8 : Math.max(12, anchor.top - maxHeight - 8),
        left: Math.max(12, Math.min(anchor.left, window.innerWidth - 372)),
        maxHeight,
      });
    }
    setSelected(index);
    const w = words[index]; const g = glosses.get(index);
    if (phase === "reading" && g) {
      const key = lookupKey(w.word);
      if (used.includes(key) || used.length < limit) setLookedAt(old => old.includes(index) ? old : [...old, index]);
    }
  }
  function undoTap(index: number) {
    setTapped(old => old.filter(value => value !== index));
    setLookedAt(old => old.filter(value => value !== index));
    setMarked(old => old.filter(value => value !== index));
    setSelected(null);
  }
  let last = 0;
  const textParts = words.map(w => {
    const before = lesson.text.slice(last, w.start); last = w.stop;
    const isGroup = canSee && gloss && w.index >= gloss.index && w.index < (gloss.end ?? gloss.index + 1);
    return <span key={w.index}>{before}<button
      className={`fr-word ${marked.includes(w.index) ? "marked" : ""} ${tapped.includes(w.index) ? "highlighted" : ""} ${selected === w.index ? "selected" : ""} ${isGroup ? "phrase" : ""}`}
      data-word-index={w.index} onClick={() => choose(w.index)} aria-label={`${w.word}（${w.index + 1}語目）の解説`} aria-pressed={selected === w.index}>{w.word}</button></span>;
  });

  return <main className="free-reader">
    <header className="fr-heading"><div><h1>自由読解</h1></div><button className="reset-link" disabled={exporting || savingPause} onClick={resetAll}>リセット</button></header>
    <details className="fr-setup" open={setupOpen} onToggle={e => setSetupOpen(e.currentTarget.open)}>
      <summary>読解の設定 <span className="fr-setup-summary">辞書 {percent}%・{limit}語まで</span></summary>
      <fieldset disabled={phase !== "ready"}>
        <label>調べられる単語数：{limit}語まで（本文の{percent}%）
          <span className="fr-slider-control">
          <input className="fr-lookup-slider" aria-label="辞書利用の上限" aria-valuetext={`本文の${percent}%・${limit}語まで`} type="range" min="0" max={LOOKUP_LIMITS.length - 1} step="1" value={LOOKUP_LIMITS.findIndex(value => value === percent)} onChange={e => setPercent(LOOKUP_LIMITS[Number(e.target.value)])} />
          <span className="fr-slider-labels" aria-hidden="true">{LOOKUP_LIMITS.map((value, index) => <span key={value} style={{ left: `${index * 100 / (LOOKUP_LIMITS.length - 1)}%` }}>{value}%</span>)}</span>
          </span>
        </label>
        {percent > 0 && limit === 0 && <p>上限は0語です。調べる場合は割合を増やしてください。</p>}
        {!lesson.glosses.length && <p>単語解説なし</p>}
        <details className="fr-teacher-tools"><summary>教材の編集・保存</summary>
          <div className="fr-actions"><button onClick={() => downloadJson(lesson, "reading-lesson.json")}>教材ファイルを保存</button></div>
        <label>教材名<input maxLength={80} value={lesson.title} onChange={e => setLesson({ ...lesson, title: e.target.value })} /></label>
        <details><summary>本文を貼り付ける（解説なし）</summary>
          <textarea aria-label="自由読解の本文" maxLength={12000} value={lesson.text} onChange={e => {
            if (lesson.glosses.length && !confirm("本文を編集すると、登録済みの解説がすべて解除されます。続けますか？")) return;
            setLesson({ ...lesson, text: e.target.value, glosses: [] }); setSelected(null);
          }} />
        </details>
        </details>
      </fieldset>
    </details>
    {saveError && <p className="fr-message" role="alert">{saveError}</p>}
    <div className="fr-layout-controls">
      <label className="fr-ratio">本文 {ratio}：メモ {100-ratio}<input aria-label="本文とメモの比率" type="range" min="40" max="75" step="5" value={ratio} onChange={e => setRatio(Number(e.target.value))} /></label>
      <button className="fr-swap-layout" aria-pressed={notesLeft} aria-controls="reading-workspace" onClick={() => { setNotesLeft(value => !value); setSelected(null); }}>⇄ 左右を入れ替え</button>
    </div>
    <div id="reading-workspace" className={`fr-workspace${notesLeft ? " fr-notes-left" : ""}`} style={{ gridTemplateColumns: notesLeft ? `minmax(0, ${100-ratio}fr) minmax(0, ${ratio}fr)` : `minmax(0, ${ratio}fr) minmax(0, ${100-ratio}fr)` }}>
      <section className="fr-reading" ref={readingPanelRef} aria-label="読解本文">
        <header className="fr-reading-header">
          <div className="fr-title-row"><h2>{lesson.title || "教材"}</h2>
            {phase === "ready" && <button className="fr-reading-action primary" disabled={!words.length || words.length > 1000 || !lesson.title.trim()} onClick={start}>開始</button>}
            {phase === "reading" && <button className="fr-reading-action" onClick={() => void pauseReading()}>一時停止</button>}
            {phase === "paused" && <button className="fr-reading-action primary" disabled={savingPause} onClick={resumeReading}>{savingPause ? "保存中…" : "再開"}</button>}
            {phase === "done" && <span className="fr-phase">読了</span>}
          </div>
          <div className="fr-reading-status"><span>{words.length}語{phase === "paused" ? " ／ 一時停止中" : ""}</span>
            <span>経過 <b>{time(seconds)}</b> ／ 辞書 <b>{phase === "done" ? "制限なし" : `残り${Math.max(0, limit - used.length)}語`}</b></span>
          </div>
          {message && <p className="fr-pause-message" role="status">{message}</p>}
        </header>
        <article className="fr-text" ref={passageRef} onScroll={() => setSelected(null)}>
          <div className="fr-passage" lang="en">{textParts}{lesson.text.slice(last)}</div>
          <footer className="fr-passage-end" aria-label="本文末尾の操作">
            {phase !== "done" && <>
              {phase === "ready" && <span className="fr-phase">未開始</span>}
              <button className="fr-reading-action primary" disabled={phase === "ready" || savingPause} onClick={finish}>読了・WPMを表示</button>
            </>}
            {result && <>
              <div className="fr-end-result" role="status"><strong>{result.wpm} <small>WPM</small></strong><span>{time(result.seconds)} ／ 辞書 {result.used}語</span>
                {previous && <p>同じ本文・同じ制限での前回：{previous.wpm} WPM → 今回 {result.wpm} WPM</p>}
              </div>
              <div className="fr-end-actions"><button className="fr-reading-action primary" disabled={exporting} onClick={() => void exportImage()}>{exporting ? "画像を作成中…" : "マーカー付き本文を画像保存（PNG）"}</button><button className="fr-reading-action" onClick={prepareReread}>もう一度読む</button></div>
              {exportMessage && <p role="alert">{exportMessage}</p>}
            </>}
          </footer>
        </article>
        {token && <aside className="fr-gloss" style={popup} aria-label="単語の解説">
          <button className="fr-close" onClick={() => setSelected(null)} aria-label="解説を閉じる">×</button>
          <h3>{token.word}</h3>
          {canSee && gloss ? <><small>{gloss.lemma} · {gloss.pos}</small><p className="fr-meaning">{gloss.meaning}</p>{gloss.note && <p>{gloss.note}</p>}</> :
            <p>{!gloss ? "この単語の解説は未登録です。回数は消費しません。" : phase === "ready" ? "「開始」を押すと解説を確認できます。" : phase === "paused" ? "再開すると単語を調べられます。" : "辞書の上限に達しました。読了後に確認できます。"}</p>}
          {(phase !== "paused" || tapped.includes(token.index)) && <div className="fr-gloss-actions"><button onClick={() => setMarked(old => old.includes(token.index) ? old.filter(i => i !== token.index) : [...old, token.index])}>{marked.includes(token.index) ? "あとで確認を解除" : "あとで確認に追加"}</button>
          <button className="fr-undo-tap" onClick={() => undoTap(token.index)}>このタップを取り消す</button></div>}
        </aside>}
      </section>
      <div className="fr-notes"><NotesBoard embedded notesRef={notesRef} /></div>
    </div>
    {(marked.length > 0 || tapped.length > 0) && <section className="fr-review"><h2>あとで確認・タップした単語</h2>
        <div className="fr-actions">{words.filter(w => marked.includes(w.index) || tapped.includes(w.index)).map(w => <button key={w.index} onClick={() => { const target = passageRef.current?.querySelector<HTMLElement>(`[data-word-index="${w.index}"]`); target?.scrollIntoView({ block: "center", behavior: "instant" }); requestAnimationFrame(() => choose(w.index)); }}>{marked.includes(w.index) ? "☆ " : ""}{w.word} <small>#{w.index+1}</small></button>)}</div>
    </section>}
    <details className="fr-history"><summary>読書記録（この端末・最大100件）</summary>
      <div className="fr-actions"><button onClick={() => downloadJson(records, "reading-history.json")}>履歴を書き出す</button><button disabled={phase === "reading" || !records.length} onClick={() => { if (confirm("この端末の自由読解の履歴を消去しますか？")) { setRecords([]); save("wpm-free-history", []); } }}>履歴を消去</button></div>
      <div className="fr-table"><table><thead><tr><th>日時</th><th>教材</th><th>語数</th><th>時間</th><th>WPM</th><th>辞書</th><th>上限</th></tr></thead><tbody>{records.map(r => <tr key={r.id}><td>{new Date(r.date).toLocaleString("ja-JP")}</td><td>{r.title}</td><td>{r.words}</td><td>{time(r.seconds)}</td><td>{r.wpm}</td><td>{r.used}回</td><td>{r.percent}%</td></tr>)}</tbody></table></div>
      <p>この端末の記録です。ブラウザのデータを消すと記録も消えます。</p>
    </details>
  </main>;
}
