import { memo, useEffect, useMemo, useRef, useState } from "react";
import Home from "./App";
import QRCode from "qrcode";
import { allowance, downloadJson, lookupKey, measuredWpm, tokenize, validateLesson } from "./lesson";
import { createShareUrl, decodeLesson, payloadFromHash } from "./share";
import { createSrcShareUrl, fetchLesson, srcFromSearch, SRC_PARAM } from "./sharesrc";
import type { Gloss, ReadingLesson, ReadingRecord } from "./lesson";
const NotesBoard = memo(Home);

import { SAMPLE } from "./sampleLesson";
function storedLesson(): ReadingLesson {
  try { return validateLesson(JSON.parse(localStorage.getItem("wpm-free-lesson") || "")); } catch { return SAMPLE; }
}
function storedRecords(): ReadingRecord[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem("wpm-free-history") || "[]");
    return Array.isArray(data) ? data.filter((r): r is ReadingRecord => r && typeof r.id === "string" && typeof r.date === "string" && typeof r.title === "string" && typeof r.text === "string" && ["words","seconds","wpm","used","percent"].every(k => typeof r[k] === "number" && Number.isFinite(r[k]))).slice(0, 100) : [];
  } catch { return []; }
}
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function FreeReader({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const [lesson, setLesson] = useState(storedLesson);
  const [records, setRecords] = useState(storedRecords);
  const [phase, setPhase] = useState<"ready" | "reading" | "done">("ready");
  const [percent, setPercent] = useState(10);
  const [used, setUsed] = useState<string[]>([]);
  const [marked, setMarked] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<ReadingRecord | null>(null);
  const [teacher, setTeacher] = useState(false);
  const [draft, setDraft] = useState<Gloss | null>(null);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [ratio, setRatio] = useState(60);
  const [popup, setPopup] = useState({ top: 80, left: 20, maxHeight: 320 });
  const [shareUrl, setShareUrl] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [pubName, setPubName] = useState("");
  const [pubUrl, setPubUrl] = useState("");
  const [pubQr, setPubQr] = useState("");
  const [pubMessage, setPubMessage] = useState("");
  const startRef = useRef<number | null>(null);
  const words = useMemo(() => tokenize(lesson.text), [lesson.text]);
  const glosses = useMemo(() => new Map(lesson.glosses.map(g => [g.index, g])), [lesson.glosses]);
  const limit = allowance(words.length, percent);
  const token = selected === null ? undefined : words[selected];
  const gloss = selected === null ? undefined : glosses.get(selected);
  const canSee = teacher || phase === "done" || (phase === "reading" && !!token && used.includes(lookupKey(token.word)));
  const previous = result ? records.find(r => r.id !== result.id && r.text === result.text && r.percent === result.percent) : undefined;

  function save(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)); setSaveError(""); }
    catch { setSaveError("端末に保存できませんでした。必要な教材・履歴はファイルで保存してください。"); }
  }
  useEffect(() => { save("wpm-free-lesson", lesson); }, [lesson]);
  useEffect(() => { setShareUrl(""); setQrUrl(""); setShareMessage(""); }, [lesson]);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const payload = payloadFromHash(location.hash);
      if (payload === null) return;
      history.replaceState(null, "", `${location.pathname}${location.search}`);
      decodeLesson(payload).then(next => {
        if (cancelled) return;
        setLesson(next); resetReading(); setTeacher(false); setMessage("共有された教材を読み込みました。");
      }).catch(e => { if (!cancelled) setMessage(e instanceof Error ? e.message : "共有リンクを読み込めませんでした。"); });
    };
    load();
    window.addEventListener("hashchange", load);
    return () => { cancelled = true; window.removeEventListener("hashchange", load); };
  }, []);
  async function makePublicShare() {
    setPubMessage(""); setPubUrl(""); setPubQr("");
    try {
      const url = createSrcShareUrl(pubName, location.href);
      setPubUrl(url);
      setPubQr(await QRCode.toDataURL(url, { errorCorrectionLevel: "L", width: 480, margin: 3, color: { dark: "#16212b", light: "#ffffff" } }));
      try { await navigator.clipboard.writeText(url); setPubMessage("共有URLをコピーし、QRコードを表示しました。ファイルを公開（push・デプロイ）済みか確認してください。"); }
      catch { setPubMessage("共有URLを作成しました。下の欄からコピーしてください。"); }
    } catch (e) { setPubMessage(e instanceof Error ? e.message : "共有URLを作成できませんでした。"); }
  }
  useEffect(() => {
    const name = srcFromSearch(location.search);
    if (name === null) return;
    let cancelled = false;
    const params = new URLSearchParams(location.search);
    params.delete(SRC_PARAM);
    const rest = params.toString();
    history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);
    fetchLesson(name, location.href).then(next => {
      if (cancelled) return;
      setLesson(next); resetReading(); setTeacher(false); setMessage("公開された教材を読み込みました。");
    }).catch(e => { if (!cancelled) setMessage(e instanceof Error ? e.message : "公開された教材を読み込めませんでした。"); });
    return () => { cancelled = true; };
  }, []);
  async function makeShare() {
    setShareMessage(""); setShareUrl(""); setQrUrl("");
    try {
      const url = await createShareUrl(lesson, location.href);
      setShareUrl(url);
      setQrUrl(await QRCode.toDataURL(url, { errorCorrectionLevel: "L", width: 480, margin: 3, color: { dark: "#16212b", light: "#ffffff" } }));
      try { await navigator.clipboard.writeText(url); setShareMessage("共有URLをコピーし、QRコードを表示しました。"); }
      catch { setShareMessage("共有URLを作成しました。下の欄からコピーしてください。"); }
    } catch (e) { setShareMessage(e instanceof Error ? e.message : "共有URLを作成できませんでした。"); }
  }
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

  function resetReading() {
    setPhase("ready"); setUsed([]); setMarked([]); setSelected(null); setSeconds(0); setResult(null); startRef.current = null;
  }
  function replaceLesson(next: ReadingLesson) {
    if (!confirm("教材を切り替えます。手書きメモは共通のノートとして残ります。必要なら先に画像保存してください。")) return;
    setLesson(next); resetReading(); setMessage("教材を読み込みました。"); setTeacher(false);
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("教材ファイルは2MB以下にしてください。");
      replaceLesson(validateLesson(JSON.parse(await file.text())));
    } catch (e) { setMessage(e instanceof Error ? e.message : "教材を読み込めませんでした。"); }
  }
  function start() {
    if (!words.length || words.length > 1000 || startRef.current !== null) return;
    setTeacher(false); setSelected(null); setUsed([]); setMarked([]); setResult(null); setSeconds(0);
    startRef.current = performance.now(); setPhase("reading"); setMessage("");
  }
  function finish() {
    if (startRef.current === null) return;
    const elapsed = Math.max(0.001, (performance.now() - startRef.current) / 1000);
    startRef.current = null;
    const record: ReadingRecord = { id: crypto.randomUUID(), date: new Date().toISOString(), title: lesson.title, text: lesson.text, words: words.length, seconds: elapsed, wpm: measuredWpm(words.length, elapsed), used: used.length, percent };
    const next = [record, ...records].slice(0, 100);
    setSeconds(elapsed); setResult(record); setRecords(next); save("wpm-free-history", next); setPhase("done"); setSelected(null);
  }
  function choose(index: number) {
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
    setDraft(g ? { ...g } : { index, word: w.word, lemma: w.word.toLowerCase(), pos: "", meaning: "", note: "" });
    if (phase === "reading" && g) {
      const key = lookupKey(w.word);
      setUsed(old => old.includes(key) || old.length >= limit ? old : [...old, key]);
    }
  }
  function saveGloss() {
    if (!draft) return;
    try {
      const next = validateLesson({ ...lesson, glosses: [...lesson.glosses.filter(g => g.index !== draft.index), draft].sort((a,b) => a.index-b.index) });
      setLesson(next); setMessage("解説を保存しました。配布用の教材を書き出してください。");
    } catch (e) { setMessage((e as Error).message); }
  }
  let last = 0;
  const textParts = words.map(w => {
    const before = lesson.text.slice(last, w.start); last = w.stop;
    const isGroup = canSee && gloss && w.index >= gloss.index && w.index < (gloss.end ?? gloss.index + 1);
    return <span key={w.index}>{before}<button
      className={`fr-word ${marked.includes(w.index) ? "marked" : ""} ${used.includes(lookupKey(w.word)) ? "looked" : ""} ${selected === w.index ? "selected" : ""} ${isGroup ? "phrase" : ""}`}
      data-word-index={w.index} onClick={() => choose(w.index)} aria-label={`${w.word}（${w.index + 1}語目）の解説`} aria-pressed={selected === w.index}>{w.word}</button></span>;
  });

  return <main className="free-reader">
    <header className="fr-heading"><div><div className="eyebrow">READ AT YOUR OWN PACE</div><h1>自由読解</h1><p>読む。必要な言葉を調べる。自分の言葉でまとめる。</p></div><span className="fr-chip">AI・外部辞書への通信なし</span></header>
    <details className="fr-setup" open={phase === "ready" ? true : undefined}>
      <summary>教材と設定 — {lesson.title}</summary>
      <fieldset disabled={phase !== "ready"}>
        <div className="fr-actions">
          <label className="fr-file">教材をインポート<input type="file" accept=".json,application/json" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <button onClick={() => replaceLesson(SAMPLE)}>サンプル教材</button>
          <button onClick={() => downloadJson(lesson, "reading-lesson.json")}>教材を書き出す</button>
          <button onClick={() => void makeShare()}>URL・QRで配布</button>
          <button onClick={() => { setTeacher(!teacher); setSelected(null); }} aria-pressed={teacher}>教師用プレビュー・修正</button>
        </div>
        {shareMessage && <p className="fr-message" role="status">{shareMessage}</p>}
        {shareUrl && <div className="fr-share">
          <input readOnly aria-label="共有URL" value={shareUrl} onFocus={e => e.target.select()} />
          {qrUrl && <img src={qrUrl} width={240} height={240} alt="教材共有用のQRコード" />}
        </div>}
        <details className="fr-public">
          <summary>公開URLで共有（長い教材向け）</summary>
          <p>教師の手順：①「教材を書き出す」でJSONを保存 → ②リポジトリの <code>public/lessons/</code> に置いて push（Pagesに自動公開） → ③下にファイル名（例：<code>foo.json</code>）を入力して共有URL・QRを作成。</p>
          <p><strong>注意：</strong>公開リポジトリのため、置いた教材は誰でも閲覧できます。個人情報や非公開の教材は置かないでください。</p>
          <div className="fr-actions">
            <input aria-label="公開する教材のファイル名" placeholder="foo.json" maxLength={200} value={pubName} onChange={e => setPubName(e.target.value)} />
            <button disabled={!pubName.trim()} onClick={() => void makePublicShare()}>共有URLとQRを作成</button>
          </div>
          {pubMessage && <p className="fr-message" role="status">{pubMessage}</p>}
          {pubUrl && <div className="fr-share">
            <input readOnly aria-label="公開URLの共有リンク" value={pubUrl} onFocus={e => e.target.select()} />
            {pubQr && <img src={pubQr} width={240} height={240} alt="公開URL共有用のQRコード" />}
          </div>}
        </details>
        <label>教材名<input maxLength={80} value={lesson.title} onChange={e => setLesson({ ...lesson, title: e.target.value })} /></label>
        <details><summary>本文を貼り付ける（解説なし）</summary>
          <p>解説付き教材の本文を変更すると、位置のずれを防ぐため解説をすべて解除します。</p>
          <textarea aria-label="自由読解の本文" maxLength={12000} value={lesson.text} onChange={e => {
            if (lesson.glosses.length && !confirm("本文を編集すると、登録済みの解説がすべて解除されます。続けますか？")) return;
            setLesson({ ...lesson, text: e.target.value, glosses: [] }); setSelected(null);
          }} />
        </details>
        <label>辞書の上限：{percent / 10}割（{percent}%）・{limit}回
          <input aria-label="辞書利用の上限" type="range" min="0" max="100" step="10" value={percent} onChange={e => setPercent(Number(e.target.value))} />
        </label>
        <p>{words.length}語 ／ 解説 {lesson.glosses.length}件。上限は小数点以下切り捨て。同じ綴りの再確認は無料（大文字・小文字は区別しません）。</p>
        {!lesson.glosses.length && <p>本文のみの教材です。WPM計測・手書きメモを利用できます。</p>}
        <p>教師用プレビューは確認用です。ログインによるアクセス制限ではありません。</p>
      </fieldset>
    </details>
    {message && <p className="fr-message" role="status">{message}</p>}
    {saveError && <p className="fr-message" role="alert">{saveError}</p>}
    <section className="fr-session" aria-label="計測と辞書残数">
      <div><small>経過時間</small><strong>{time(seconds)}</strong></div>
      <div><small>辞書 残り</small><strong>{phase === "done" ? "制限なし" : `${Math.max(0, limit - used.length)} / ${limit}`}</strong></div>
      <div><small>本文</small><strong>{words.length}語</strong></div>
      {phase === "ready" && <button className="primary" disabled={!words.length || words.length > 1000 || !lesson.title.trim()} onClick={start}>開始</button>}
      {phase === "reading" && <button className="primary" onClick={finish}>読了・WPMを表示</button>}
      {phase === "done" && <button onClick={resetReading}>再読・教材の変更</button>}
    </section>
    <p className="fr-hint">辞書・メモ・別画面を見ている時間も計測に含みます。「読了」後もメモは続けられます。</p>
    {result && <section className="fr-result" role="status"><strong>{result.wpm} <small>WPM</small></strong><span>辞書・メモ利用を含む読解速度 ／ 辞書 {result.used}回（本文語数の{(result.used / result.words * 100).toFixed(1)}%）</span>
      {previous ? <p>同じ本文・同じ制限での前回：{previous.wpm} WPM → 今回 {result.wpm} WPM（{result.wpm-previous.wpm >= 0 ? "+" : ""}{result.wpm-previous.wpm}）</p> : <p>同じ本文・同じ辞書制限で再読すると前回と比較できます。</p>}
    </section>}
    <label className="fr-ratio">画面の比率　本文 {ratio}：メモ {100-ratio}<input aria-label="本文とメモの比率" type="range" min="40" max="75" step="5" value={ratio} onChange={e => setRatio(Number(e.target.value))} /></label>
    <div className="fr-workspace" style={{ gridTemplateColumns: `minmax(0, ${ratio}fr) minmax(0, ${100-ratio}fr)` }}>
      <section className="fr-reading"><header><h2>{lesson.title || "教材"}</h2><span>{teacher ? "教師用プレビュー" : phase === "done" ? "復習 — 解説を自由に確認できます" : "単語をタップして確認"}</span></header>
        <article className="fr-text" lang="en" onScroll={() => setSelected(null)}>{textParts}{lesson.text.slice(last)}</article>
        {token && <aside className="fr-gloss" style={popup} aria-label="単語の解説">
          <button className="fr-close" onClick={() => setSelected(null)} aria-label="解説を閉じる">×</button>
          <h3>{token.word}</h3>
          {canSee && gloss ? <><small>{gloss.lemma} · {gloss.pos}</small><p className="fr-meaning">{gloss.meaning}</p>{gloss.note && <p>{gloss.note}</p>}</> :
            <p>{!gloss ? "この単語の解説は未登録です。回数は消費しません。" : phase === "ready" ? "「開始」を押すと解説を確認できます。" : "辞書の上限に達しました。読了後に確認できます。"}</p>}
          {!teacher && <button onClick={() => setMarked(old => old.includes(token.index) ? old.filter(i => i !== token.index) : [...old, token.index])}>{marked.includes(token.index) ? "あとで確認を解除" : "あとで確認に追加"}</button>}
          {teacher && draft && <div className="fr-editor">
            {(["lemma","pos","meaning","note"] as const).map((key, i) => <label key={key}>{["原形","品詞","意味","語句・文法の補足"][i]}<textarea value={draft[key] ?? ""} maxLength={key === "note" ? 2000 : 1000} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}
            <button onClick={saveGloss}>この解説を保存</button>
          </div>}
        </aside>}
      </section>
      <section className="fr-notes"><h2>手書きメモ</h2><p>内容を自分の言葉や図でまとめよう</p><NotesBoard notesOnly /></section>
    </div>
    <section className="fr-review"><h2>あとで確認・調べた単語</h2>
      {marked.length === 0 && used.length === 0 ? <p>気になる単語に印をつけると、ここに並びます。</p> :
        <div className="fr-actions">{words.filter(w => marked.includes(w.index) || used.includes(lookupKey(w.word))).map(w => <button key={w.index} onClick={() => { choose(w.index); document.querySelector(".fr-reading")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{marked.includes(w.index) ? "☆ " : ""}{w.word} <small>#{w.index+1}</small></button>)}</div>}
    </section>
    <details className="fr-history"><summary>読書記録（この端末・最大100件）</summary>
      <div className="fr-actions"><button onClick={() => downloadJson(records, "reading-history.json")}>履歴を書き出す</button><button disabled={phase === "reading" || !records.length} onClick={() => { if (confirm("この端末の自由読解の履歴を消去しますか？")) { setRecords([]); save("wpm-free-history", []); } }}>履歴を消去</button></div>
      <div className="fr-table"><table><thead><tr><th>日時</th><th>教材</th><th>語数</th><th>時間</th><th>WPM</th><th>辞書</th><th>上限</th></tr></thead><tbody>{records.map(r => <tr key={r.id}><td>{new Date(r.date).toLocaleString("ja-JP")}</td><td>{r.title}</td><td>{r.words}</td><td>{time(r.seconds)}</td><td>{r.wpm}</td><td>{r.used}回</td><td>{r.percent}%</td></tr>)}</tbody></table></div>
      <p>手書き画像は履歴に蓄積しません。ブラウザのデータを消すと記録も消えます。</p>
    </details>
  </main>;
}
