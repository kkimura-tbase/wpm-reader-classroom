import { memo, useEffect, useMemo, useRef, useState } from "react";
import Home from "./App";
import { downloadMarkedLesson } from "./markedImage";
import { allowance, downloadJson, lookupKey, measuredWpm, tokenize } from "./lesson";
import type { ReadingLesson, ReadingRecord } from "./lesson";
const NotesBoard = memo(Home);


function storedRecords(): ReadingRecord[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem("wpm-free-history") || "[]");
    return Array.isArray(data) ? data.filter((r): r is ReadingRecord => r && typeof r.id === "string" && typeof r.date === "string" && typeof r.title === "string" && typeof r.text === "string" && ["words","seconds","wpm","used","percent"].every(k => typeof r[k] === "number" && Number.isFinite(r[k]))).slice(0, 100) : [];
  } catch { return []; }
}
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function FreeReader({ onBusy, lesson, setLesson }: { onBusy: (busy: boolean) => void; lesson: ReadingLesson; setLesson: (lesson: ReadingLesson) => void }) {
  const [records, setRecords] = useState(storedRecords);
  const [phase, setPhase] = useState<"ready" | "reading" | "done">("ready");
  const [percent, setPercent] = useState(5);
  const [lookedAt, setLookedAt] = useState<number[]>([]);
  const [marked, setMarked] = useState<number[]>([]);
  const [tapped, setTapped] = useState<number[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<ReadingRecord | null>(null);
  const [setupOpen, setSetupOpen] = useState(true);
  const readingPanelRef = useRef<HTMLElement>(null);
  const passageRef = useRef<HTMLElement>(null);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [ratio, setRatio] = useState(60);
  const [notesLeft, setNotesLeft] = useState(() => {
    try { return JSON.parse(localStorage.getItem("wpm-free-notes-left") || "false") === true; }
    catch { return false; }
  });
  const [popup, setPopup] = useState({ top: 80, left: 20, maxHeight: 320 });
  const startRef = useRef<number | null>(null);
  const words = useMemo(() => tokenize(lesson.text), [lesson.text]);
  const glosses = useMemo(() => new Map(lesson.glosses.map(g => [g.index, g])), [lesson.glosses]);
  const used = useMemo(() => [...new Set(lookedAt.flatMap(index => words[index] ? [lookupKey(words[index].word)] : []))], [lookedAt, words]);
  const limit = allowance(words.length, percent);
  const token = selected === null ? undefined : words[selected];
  const gloss = selected === null ? undefined : glosses.get(selected);
  const canSee = phase === "done" || (phase === "reading" && !!token && used.includes(lookupKey(token.word)));
  const previous = result ? records.find(r => r.id !== result.id && r.text === result.text && r.percent === result.percent) : undefined;

  function save(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); setSaveError(""); }
    catch { setSaveError("端末に保存できませんでした。必要な教材・履歴はファイルで保存してください。"); }
  }

  useEffect(() => { save("wpm-free-notes-left", notesLeft); }, [notesLeft]);
  useEffect(() => {
    onBusy(phase === "reading");
    return () => onBusy(false);
  }, [phase, onBusy]);
  useEffect(() => {
    if (phase !== "reading") return;
    const tick = () => setSeconds((performance.now() - startRef.current!) / 1000);
    const id = window.setInterval(tick, 250);
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => { clearInterval(id); window.removeEventListener("beforeunload", warn); };
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

  useEffect(() => { setTapped([]); setLookedAt([]); setMarked([]); setSelected(null); setExportMessage(""); }, [lesson.text]);

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
    setSetupOpen(true);
    setTapped([]); setExportMessage("");
    setPhase("ready"); setLookedAt([]); setMarked([]); setSelected(null); setSeconds(0); setResult(null); startRef.current = null;
  }
  function start() {
    if (!words.length || words.length > 1000 || startRef.current !== null) return;
    setSelected(null); setLookedAt([]); setMarked([]); setResult(null); setSeconds(0);
    startRef.current = performance.now(); setPhase("reading"); setMessage("");
    setSetupOpen(false); focusReading();
  }
  function finish() {
    if (startRef.current === null) return;
    const elapsed = Math.max(0.001, (performance.now() - startRef.current) / 1000);
    startRef.current = null;
    const record: ReadingRecord = { id: crypto.randomUUID(), date: new Date().toISOString(), title: lesson.title, text: lesson.text, words: words.length, seconds: elapsed, wpm: measuredWpm(words.length, elapsed), used: used.length, percent };
    const next = [record, ...records].slice(0, 100);
    setSeconds(elapsed); setResult(record); setRecords(next); save("wpm-free-history", next); setPhase("done"); setSelected(null);
    requestAnimationFrame(() => passageRef.current?.querySelector(".fr-passage-end")?.scrollIntoView({ block: "end", behavior: "instant" }));
  }
  function choose(index: number) {
    setTapped(old => old.includes(index) ? old : [...old, index]);
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
    <header className="fr-heading"><div><h1>自由読解</h1><p>① 上限を選ぶ → ② 開始して読む → ③ 本文末尾で読了・画像保存</p></div></header>
    <details className="fr-setup" open={setupOpen} onToggle={e => setSetupOpen(e.currentTarget.open)}>
      <summary>読解の設定 <span className="fr-setup-summary">辞書 {percent}%・{limit}語まで</span></summary>
      <fieldset disabled={phase !== "ready"}>
        <label>調べられる単語数：{limit}語まで（本文の{percent}%）
          <span className="fr-slider-control">
          <input className="fr-lookup-slider" aria-label="辞書利用の上限" aria-valuetext={`本文の${percent}%・${limit}語まで`} type="range" min="0" max="7" step="1" value={[0, 1, 2, 3, 5, 10, 15, 20].indexOf(percent)} onChange={e => setPercent([0, 1, 2, 3, 5, 10, 15, 20][Number(e.target.value)])} />
          <span className="fr-slider-labels" aria-hidden="true">{[0, 1, 2, 3, 5, 10, 15, 20].map(value => <span key={value} style={{ left: `${[0, 1, 2, 3, 5, 10, 15, 20].indexOf(value) * 100 / 7}%` }}>{value}%</span>)}</span>
          </span>
        </label>
        {percent > 0 && limit === 0 && <p>この本文の長さでは上限が0語になります。調べたい場合は、より高い割合を選んでください。</p>}
        <p>{words.length}語 ／ 解説 {lesson.glosses.length}件。上限は小数点以下切り捨て。同じ綴りの再確認は無料（大文字・小文字は区別しません）。</p>
        {!lesson.glosses.length && <p>本文のみの教材です。WPM計測・手書きメモを利用できます。</p>}
        <details className="fr-teacher-tools"><summary>教材の編集・保存</summary>
          <div className="fr-actions"><button onClick={() => downloadJson(lesson, "reading-lesson.json")}>教材ファイルを保存</button></div>
        <label>教材名<input maxLength={80} value={lesson.title} onChange={e => setLesson({ ...lesson, title: e.target.value })} /></label>
        <details><summary>本文を貼り付ける（解説なし）</summary>
          <p>解説付き教材の本文を変更すると、位置のずれを防ぐため解説をすべて解除します。</p>
          <textarea aria-label="自由読解の本文" maxLength={12000} value={lesson.text} onChange={e => {
            if (lesson.glosses.length && !confirm("本文を編集すると、登録済みの解説がすべて解除されます。続けますか？")) return;
            setLesson({ ...lesson, text: e.target.value, glosses: [] }); setSelected(null);
          }} />
        </details>
        </details>
      </fieldset>
    </details>
    {message && <p className="fr-message" role="status">{message}</p>}
    {saveError && <p className="fr-message" role="alert">{saveError}</p>}
    <section className="fr-session" aria-label="計測と辞書残数">
      <div><small>経過時間</small><strong>{time(seconds)}</strong></div>
      <div><small>調べられる単語 残り</small><strong>{phase === "done" ? "制限なし" : `${Math.max(0, limit - used.length)} / ${limit}語`}</strong></div>
      <div><small>本文</small><strong>{words.length}語</strong></div>
      {phase === "ready" && <button className="primary" disabled={!words.length || words.length > 1000 || !lesson.title.trim()} onClick={start}>開始</button>}
      {phase === "reading" && <button className="primary" onClick={finish}>読了・WPMを表示</button>}
      {phase === "done" && <button onClick={prepareReread}>再読・教材の変更</button>}
    </section>
    <p className="fr-hint">辞書・メモ・別画面を見ている時間も計測に含みます。「読了」後もメモは続けられます。</p>
    <div className="fr-layout-controls">
      <label className="fr-ratio">画面の比率　本文 {ratio}：メモ {100-ratio}<input aria-label="本文とメモの比率" type="range" min="40" max="75" step="5" value={ratio} onChange={e => setRatio(Number(e.target.value))} /></label>
      <button className="fr-swap-layout" aria-pressed={notesLeft} aria-controls="reading-workspace" onClick={() => { setNotesLeft(value => !value); setSelected(null); }}>本文とメモを左右入れ替え</button>
      <span role="status">{notesLeft ? "左：メモ ／ 右：本文" : "左：本文 ／ 右：メモ"}</span>
    </div>
    <div id="reading-workspace" className={`fr-workspace${notesLeft ? " fr-notes-left" : ""}`} style={{ gridTemplateColumns: notesLeft ? `minmax(0, ${100-ratio}fr) minmax(0, ${ratio}fr)` : `minmax(0, ${ratio}fr) minmax(0, ${100-ratio}fr)` }}>
      <section className="fr-reading" ref={readingPanelRef} aria-label="読解本文">
        <header className="fr-reading-header">
          <div className="fr-title-row"><h2>{lesson.title || "教材"}</h2>
            {phase === "ready" ? <button className="fr-reading-action primary" disabled={!words.length || words.length > 1000 || !lesson.title.trim()} onClick={start}>開始</button>
              : <span className={`fr-phase fr-phase-${phase}`}>{phase === "reading" ? "計測中" : "読了"}</span>}
          </div>
          <div className="fr-reading-status"><span>{phase === "ready" ? "開始すると単語の解説を確認できます" : phase === "done" ? "復習：解説を自由に確認できます" : "単語をタップして確認"}</span>
            <span>経過 <b>{time(seconds)}</b> ／ 辞書 <b>{phase === "done" ? "制限なし" : `残り${Math.max(0, limit - used.length)}語`}</b></span>
          </div>
        </header>
        <article className="fr-text" ref={passageRef} onScroll={() => setSelected(null)}>
          <div className="fr-passage" lang="en">{textParts}{lesson.text.slice(last)}</div>
          <footer className="fr-passage-end" aria-label="本文末尾の操作">
            {phase !== "done" && <>
              <p>{phase === "ready" ? "まだ計測を開始していません。本文右上の「開始」を押してください。" : "読み終えたら、ここで計測を止められます。"}</p>
              <button className="fr-reading-action primary" disabled={phase !== "reading"} onClick={finish}>読了・WPMを表示</button>
            </>}
            {result && <>
              <div className="fr-end-result" role="status"><strong>{result.wpm} <small>WPM</small></strong><span>{time(result.seconds)} ／ 辞書 {result.used}語</span>
                {previous && <p>同じ本文・同じ制限での前回：{previous.wpm} WPM → 今回 {result.wpm} WPM</p>}
              </div>
              <p>黄色マーカーを付けた本文を、単語帳用の画像として保存できます。</p>
              <div className="fr-end-actions"><button className="fr-reading-action primary" disabled={exporting} onClick={() => void exportImage()}>{exporting ? "画像を作成中…" : "マーカー付き本文を画像保存（PNG）"}</button><button className="fr-reading-action" onClick={prepareReread}>もう一度読む</button></div>
              {exportMessage && <p role="alert">{exportMessage}</p>}
            </>}
          </footer>
        </article>
        {token && <aside className="fr-gloss" style={popup} aria-label="単語の解説">
          <button className="fr-close" onClick={() => setSelected(null)} aria-label="解説を閉じる">×</button>
          <h3>{token.word}</h3>
          {canSee && gloss ? <><small>{gloss.lemma} · {gloss.pos}</small><p className="fr-meaning">{gloss.meaning}</p>{gloss.note && <p>{gloss.note}</p>}</> :
            <p>{!gloss ? "この単語の解説は未登録です。回数は消費しません。" : phase === "ready" ? "「開始」を押すと解説を確認できます。" : "辞書の上限に達しました。読了後に確認できます。"}</p>}
          <div className="fr-gloss-actions"><button onClick={() => setMarked(old => old.includes(token.index) ? old.filter(i => i !== token.index) : [...old, token.index])}>{marked.includes(token.index) ? "あとで確認を解除" : "あとで確認に追加"}</button>
          <button className="fr-undo-tap" onClick={() => undoTap(token.index)}>このタップを取り消す</button></div>
        </aside>}
      </section>
      <section className="fr-notes"><h2>手書きメモ</h2><p>内容を自分の言葉や図でまとめよう</p><NotesBoard notesOnly /></section>
    </div>
    <section className="fr-review"><h2>黄色マーカー付きの本文を保存</h2>
      <p>タップした箇所に黄色マーカーを付けます。同じ綴りでも、タップしていない箇所には付きません。解説未登録・上限到達後のタップも対象です。</p>
      <div className="fr-actions"><button disabled={phase !== "done" || exporting} onClick={() => void exportImage()}>{exporting ? "画像を作成中…" : "マーカー付き本文を画像保存（PNG）"}</button><span>マーカー：{tapped.length}箇所</span></div>
      <p>{phase !== "done" ? "「読了・WPMを表示」の後に保存できます。" : "読了後にタップした単語も画像に反映されます。"}白背景の画像に教材名と本文全体を保存します。再読・教材変更の前に保存してください。</p>
      {exportMessage && <p role="alert">{exportMessage}</p>}
    </section>
    <section className="fr-review"><h2>あとで確認・タップした単語</h2>
      {marked.length === 0 && tapped.length === 0 ? <p>気になる単語に印をつけると、ここに並びます。</p> :
        <div className="fr-actions">{words.filter(w => marked.includes(w.index) || tapped.includes(w.index)).map(w => <button key={w.index} onClick={() => { const target = passageRef.current?.querySelector<HTMLElement>(`[data-word-index="${w.index}"]`); target?.scrollIntoView({ block: "center", behavior: "instant" }); requestAnimationFrame(() => choose(w.index)); }}>{marked.includes(w.index) ? "☆ " : ""}{w.word} <small>#{w.index+1}</small></button>)}</div>}
    </section>
    <details className="fr-history"><summary>読書記録（この端末・最大100件）</summary>
      <div className="fr-actions"><button onClick={() => downloadJson(records, "reading-history.json")}>履歴を書き出す</button><button disabled={phase === "reading" || !records.length} onClick={() => { if (confirm("この端末の自由読解の履歴を消去しますか？")) { setRecords([]); save("wpm-free-history", []); } }}>履歴を消去</button></div>
      <div className="fr-table"><table><thead><tr><th>日時</th><th>教材</th><th>語数</th><th>時間</th><th>WPM</th><th>辞書</th><th>上限</th></tr></thead><tbody>{records.map(r => <tr key={r.id}><td>{new Date(r.date).toLocaleString("ja-JP")}</td><td>{r.title}</td><td>{r.words}</td><td>{time(r.seconds)}</td><td>{r.wpm}</td><td>{r.used}回</td><td>{r.percent}%</td></tr>)}</tbody></table></div>
      <p>手書き画像は履歴に蓄積しません。ブラウザのデータを消すと記録も消えます。</p>
    </details>
  </main>;
}
