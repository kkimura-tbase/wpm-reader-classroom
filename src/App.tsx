import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type { ReadingLesson } from "./lesson";
import { changeLessonText } from "./sharedLesson";
import NotesBoard from "./NotesBoard";
import type { NotesControls } from "./NotesBoard";
import { clearReadingSession, loadReadingSession, saveReadingSession } from "./readingSession";
import type { PaceTab } from "./readingSession";

const MAX_WORDS = 1000;
const MAX_TEXT_CHARS = 12000;
type LessonPackage = { v: 1; title: string; text: string; wpm: number };
type PaceProgress = { position: number; seconds: number };
const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const base64UrlToBytes = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
};

async function encodeLesson(lesson: LessonPackage) {
  const source = new TextEncoder().encode(JSON.stringify(lesson));
  if ("CompressionStream" in window) {
    const stream = new Blob([source]).stream().pipeThrough(new CompressionStream("gzip"));
    return `g.${bytesToBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()))}`;
  }
  return `j.${bytesToBase64Url(source)}`;
}

export async function decodeLesson(token: string): Promise<LessonPackage> {
  const [format, encoded] = token.split(".", 2);
  if (!encoded || !["g", "j"].includes(format)) throw new Error("共有リンクの形式が正しくありません。");
  let bytes = base64UrlToBytes(encoded);
  if (format === "g") {
    if (!("DecompressionStream" in window)) throw new Error("このブラウザでは圧縮された教材を開けません。");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const lesson = JSON.parse(new TextDecoder().decode(bytes)) as Partial<LessonPackage>;
  if (lesson.v !== 1 || typeof lesson.title !== "string" || typeof lesson.text !== "string" || typeof lesson.wpm !== "number") {
    throw new Error("共有教材の内容が正しくありません。");
  }
  const wordCount = lesson.text.trim().split(/\s+/).filter(Boolean).length;
  if (lesson.text.length > MAX_TEXT_CHARS || wordCount > MAX_WORDS) throw new Error("共有教材が上限を超えています。");
  return { v: 1, title: lesson.title.slice(0, 80), text: lesson.text, wpm: Math.min(500, Math.max(40, lesson.wpm)) };
}

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export default function Home({ lesson, onLessonChange, onBusy, initialWpm }: {
  lesson?: ReadingLesson; onLessonChange?: (lesson: ReadingLesson) => void;
  onBusy?: (busy: boolean) => void; initialWpm?: number;
}) {
  const [restored] = useState(() => lesson ? loadReadingSession("pace", lesson.text) : null);
  const [tab, setTab] = useState<PaceTab>(restored?.tab ?? "setup");
  const [localText, setLocalText] = useState("");
  const text = lesson?.text ?? localText;
  function setText(next: string) {
    if (!lesson || !onLessonChange) { setLocalText(next); return; }
    if (next !== lesson.text && lesson.glosses.length && !confirm("本文を編集すると、両モードで使う教材の解説がすべて解除されます。続けますか？")) return;
    if (next === lesson.text) return;
    restart();
    clearReadingSession("free");
    onLessonChange(changeLessonText(lesson, next));
  }
  const [wpm, setWpm] = useState(restored?.wpm ?? 160);
  const [index, setIndex] = useState(Math.floor(restored?.position ?? 0));
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(!!restored);
  const [elapsed, setElapsed] = useState(restored?.seconds ?? 0);
  const [savingPause, setSavingPause] = useState(false);
  const [pauseMessage, setPauseMessage] = useState("");
  const [speechOn, setSpeechOn] = useState(restored?.speechOn ?? false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState("");
  const [speechRate, setSpeechRate] = useState(1);

  const [shareMessage, setShareMessage] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrError, setQrError] = useState("");
  const [qrOpen, setQrOpen] = useState(false);
  const [teacherOpen, setTeacherOpen] = useState(false);
  const [localTitle, setLocalTitle] = useState("");
  const teacherTitle = lesson?.title ?? localTitle;
  const setTeacherTitle = (title: string) => {
    if (lesson && onLessonChange) onLessonChange({ ...lesson, title });
    else setLocalTitle(title);
  };
  const [hydrated, setHydrated] = useState(false);
  const notesRef = useRef<NotesControls>(null);
  const speechStartedRef = useRef(false);
  const speechSessionRef = useRef(0);
  const speechTimersRef = useRef<Set<number>>(new Set());
  const playingRef = useRef(false);
  const startedRef = useRef(!!restored);
  const paceProgress = useRef<PaceProgress>({ position: restored?.position ?? 0, seconds: restored?.seconds ?? 0 });
  const paceClock = useRef<{ at: number; base: PaceProgress; wpm: number; speech: boolean } | null>(null);

  const words = useMemo(() => text.trim() ? text.trim().split(/\s+/) : [], [text]);
  const readingParagraphs = useMemo(() => {
    let wordIndex = 0;
    return text
      .replace(/\r\n?/g, "\n")
      .split(/\n[ \t]*\n+/)
      .filter(paragraph => paragraph.trim())
      .map((paragraph, paragraphIndex) => ({
        key: paragraphIndex,
        hasSourceIndent: /^[ \t]/.test(paragraph),
        parts: paragraph.split(/(\s+)/).filter(Boolean).map((value, partIndex) => {
          if (/^\s+$/.test(value)) return { key: partIndex, kind: "space" as const, value };
          return { key: partIndex, kind: "word" as const, value, wordIndex: wordIndex++ };
        }),
      }));
  }, [text]);
  const progress = words.length ? Math.min(100, (index / words.length) * 100) : 0;
  const totalSeconds = words.length / Math.max(wpm, 1) * 60;
  const remaining = Math.max(0, (words.length - index) / Math.max(wpm, 1) * 60);
  const usingSpeech = speechOn && speechSupported && voices.length > 0;

  const sampleProgress = useCallback((): PaceProgress => {
    const clock = paceClock.current;
    if (!clock) return paceProgress.current;
    const delta = (performance.now() - clock.at) / 1000;
    return {
      position: Math.min(words.length, clock.speech ? paceProgress.current.position : clock.base.position + delta * clock.wpm / 60),
      seconds: clock.base.seconds + delta,
    };
  }, [words.length]);
  const showProgress = useCallback((value: PaceProgress) => {
    paceProgress.current = value;
    setIndex(Math.floor(value.position));
    setElapsed(value.seconds);
  }, []);
  const showSpokenPosition = useCallback((position: number) => {
    paceProgress.current = { ...paceProgress.current, position };
    setIndex(position);
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("wpm-reader-v1") || "{}");
      if (!lesson && typeof saved.text === "string") setLocalText(saved.text);
      if (!restored && Number.isFinite(saved.wpm)) setWpm(Math.min(500, Math.max(40, saved.wpm)));
      if (typeof saved.voiceURI === "string") setVoiceURI(saved.voiceURI);
      if (typeof saved.speechRate === "number") setSpeechRate(saved.speechRate);
    } catch { /* use defaults */ }
    if (!restored && initialWpm !== undefined) setWpm(initialWpm);
    setSpeechSupported("speechSynthesis" in window);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem("wpm-reader-v1", JSON.stringify({ text, wpm, voiceURI, speechRate })); }
    catch { /* Saving progress reports its own storage errors. */ }
  }, [text, wpm, voiceURI, speechRate, hydrated]);

  useEffect(() => {
    if (!onBusy) return;
    onBusy(playing || savingPause);
    return () => onBusy(false);
  }, [playing, savingPause, onBusy]);

  useEffect(() => {
    if (!restored) return;
    const frame = requestAnimationFrame(() => window.scrollTo({ top: restored.pageTop, behavior: "instant" }));
    return () => cancelAnimationFrame(frame);
  }, [restored]);

  useEffect(() => {
    if (!qrOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setQrOpen(false); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [qrOpen]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices()
        .filter(v => /^en(?:-|_)/i.test(v.lang))
        .sort((a,b) => Number(b.localService) - Number(a.localService) || Number(/^en-US/i.test(b.lang)) - Number(/^en-US/i.test(a.lang)));
      setVoices(list);
      if (!list.some(v => v.voiceURI === voiceURI) && list[0]) setVoiceURI(list[0].voiceURI);
    };
    load(); window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [voiceURI]);

  const stopSpeech = useCallback(() => {
    speechSessionRef.current += 1;
    speechTimersRef.current.forEach(timer => window.clearInterval(timer));
    speechTimersRef.current.clear();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    speechStartedRef.current = false;
  }, []);

  useEffect(() => () => { playingRef.current = false; stopSpeech(); }, [stopSpeech]);

  const completeReading = useCallback(() => {
    const final = sampleProgress();
    paceClock.current = null;
    startedRef.current = false;
    playingRef.current = false;
    stopSpeech();
    showProgress({ ...final, position: words.length });
    setStarted(false);
    setPlaying(false);
    setTab("notes");
    clearReadingSession("pace");
  }, [sampleProgress, showProgress, stopSpeech, words.length]);

  const speakFrom = useCallback((from: number) => {
    if (!speechOn || !speechSupported || !words.length || !voices.length) return;
    stopSpeech();
    const chosen = voices.find(v => v.voiceURI === voiceURI);
    if (!chosen) return;
    const session = speechSessionRef.current;
    speechStartedRef.current = true;
    const speakSentence = (startIndex: number) => {
      if (session !== speechSessionRef.current || !playingRef.current) return;
      if (startIndex >= words.length) {
        completeReading();
        return;
      }
      let endIndex = startIndex;
      while (endIndex < words.length && endIndex - startIndex < 45) {
        endIndex += 1;
        if (endIndex - startIndex >= 3 && /[.!?][\"'”’)]*$/.test(words[endIndex - 1])) break;
      }
      const sentence = words.slice(startIndex, endIndex).join(" ");
      const utter = new SpeechSynthesisUtterance(sentence);
      utter.voice = chosen; utter.lang = chosen.lang;
      utter.rate = Math.min(2, Math.max(.5, (wpm / 180) * speechRate));
      let boundarySeen = false;
      const sentenceStarted = performance.now();
      const smoothFallback = window.setInterval(() => {
        if (boundarySeen || session !== speechSessionRef.current) return;
        const delta = (performance.now() - sentenceStarted) / 1000;
        showSpokenPosition(Math.min(endIndex, startIndex + Math.floor(delta * wpm / 60)));
      }, 80);
      speechTimersRef.current.add(smoothFallback);
      utter.onboundary = event => {
        if (session !== speechSessionRef.current || event.name !== "word") return;
        boundarySeen = true;
        const before = sentence.slice(0, event.charIndex).trim();
        const offset = before ? before.split(/\s+/).length : 0;
        showSpokenPosition(Math.min(endIndex, startIndex + offset + 1));
      };
      utter.onend = () => {
        window.clearInterval(smoothFallback);
        speechTimersRef.current.delete(smoothFallback);
        if (session !== speechSessionRef.current) return;
        showSpokenPosition(endIndex); speakSentence(endIndex);
      };
      utter.onerror = () => {
        window.clearInterval(smoothFallback);
        speechTimersRef.current.delete(smoothFallback);
        if (session !== speechSessionRef.current) return;
        const current = sampleProgress();
        // If a selected voice fails, keep advancing by the configured speed.
        paceClock.current = { at: performance.now(), base: current, wpm, speech: false };
        speechStartedRef.current = false;
      };
      window.speechSynthesis.speak(utter);
    };
    speakSentence(from);
  }, [speechOn, speechSupported, words, voices, voiceURI, wpm, speechRate, stopSpeech, showSpokenPosition, sampleProgress, completeReading]);

  useEffect(() => {
    if (!playing || !words.length) return;
    if (usingSpeech !== paceClock.current?.speech) {
      paceClock.current = { at: performance.now(), base: sampleProgress(), wpm, speech: usingSpeech };
    }
    if (usingSpeech && !speechStartedRef.current) speakFrom(Math.floor(paceProgress.current.position));
    const timer = window.setInterval(() => {
      if (!paceClock.current) return;
      const current = sampleProgress();
      if (current.position >= words.length) completeReading();
      else showProgress(current);
    }, Math.min(100, 30000 / wpm));
    return () => window.clearInterval(timer);
  }, [playing, wpm, words.length, speakFrom, usingSpeech, sampleProgress, showProgress, completeReading]);

  const start = () => {
    if (!words.length || savingPause || playingRef.current) return;
    if (paceProgress.current.position >= words.length) showProgress({ position: 0, seconds: 0 });
    paceClock.current = { at: performance.now(), base: paceProgress.current, wpm, speech: usingSpeech };
    startedRef.current = true;
    playingRef.current = true;
    setStarted(true);
    setPauseMessage("");
    setTab("reader");
    setPlaying(true);
  };
  const saveProgress = (targetTab: PaceTab, current = paceProgress.current) => {
    return saveReadingSession("pace", text, {
      ...current, wpm, tab: targetTab, pageTop: targetTab === tab ? window.scrollY : 0, speechOn,
    });
  };
  const pause = async (targetTab: PaceTab = tab) => {
    if (!playingRef.current) return;
    const current = sampleProgress();
    paceClock.current = null;
    playingRef.current = false;
    stopSpeech();
    showProgress(current);
    setPlaying(false);
    setSavingPause(true);
    const saved = saveProgress(targetTab, current);
    const notesSaved = await notesRef.current?.checkpoint();
    setSavingPause(false);
    setPauseMessage(saved && notesSaved !== false ? "この端末に保存しました。" : "保存できない内容があります。この画面を開いたままにしてください。");
  };
  const openTab = (targetTab: PaceTab) => {
    if (targetTab === "setup" && playingRef.current) void pause(targetTab);
    else if (startedRef.current && !playingRef.current) saveProgress(targetTab);
    setTab(targetTab);
  };
  const restart = () => {
    playingRef.current = false;
    startedRef.current = false;
    paceClock.current = null;
    stopSpeech();
    showProgress({ position: 0, seconds: 0 });
    setPlaying(false);
    setStarted(false);
    setPauseMessage("");
    clearReadingSession("pace");
  };
  const rewind = () => {
    const position = Math.max(0, Math.floor(sampleProgress().position) - Math.round(wpm / 6));
    const next = { position, seconds: position / wpm * 60 };
    stopSpeech();
    showProgress(next);
    if (playingRef.current) {
      paceClock.current = { at: performance.now(), base: next, wpm, speech: usingSpeech };
      if (usingSpeech) speakFrom(position);
    } else if (startedRef.current) saveProgress(tab, next);
  };

  useEffect(() => {
    function checkpoint() {
      if (playingRef.current) void pause();
      else if (startedRef.current) saveProgress(tab);
    }
    const onHide = () => { if (document.visibilityState === "hidden") checkpoint(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", checkpoint);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", checkpoint);
    };
  }, [text, tab, wpm, speechOn, sampleProgress, showProgress, stopSpeech]);

  const createShareLink = async () => {
    const wordCount = words.length;
    if (!teacherTitle.trim()) { setShareMessage("教材名を入力してください。"); return; }
    if (!text.trim()) { setShareMessage("英文を入力してください。"); return; }
    if (wordCount > MAX_WORDS || text.length > MAX_TEXT_CHARS) {
      setShareMessage(`共有できる上限は${MAX_WORDS.toLocaleString()}語・${MAX_TEXT_CHARS.toLocaleString()}文字です。`); return;
    }
    setShareBusy(true); setShareMessage("");
    try {
      const token = await encodeLesson({ v:1, title:teacherTitle.trim().slice(0,80), text:text.trim(), wpm });
      const url = new URL(window.location.href); url.hash = `lesson=${token}`;
      const value = url.toString(); setShareUrl(value);
      let qrCreated = false;
      try {
        const image = await QRCode.toDataURL(value, { errorCorrectionLevel:"L", width:960, margin:3, color:{dark:"#16212b",light:"#ffffff"} });
        setQrDataUrl(image); setQrError(""); qrCreated = true;
      } catch {
        setQrDataUrl(""); setQrError("この教材はQRコードの容量を超えています。コピーした共有リンクをLMSやメッセージで配布してください。");
      }
      setQrOpen(true);
      if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(value); setShareMessage(qrCreated ? "共有リンクをコピーし、QRコードを表示しました。" : "共有リンクをコピーしました。"); }
        catch { setShareMessage("共有リンクを作成しました。下の欄からコピーしてください。"); }
      } else setShareMessage("共有リンクを作成しました。下の欄からコピーしてください。");
    } catch { setShareMessage("共有リンクを作成できませんでした。もう一度お試しください。"); }
    finally { setShareBusy(false); }
  };
  const copyExistingLink = async () => {
    if (!shareUrl) return;
    try { await navigator.clipboard.writeText(shareUrl); setShareMessage("共有リンクをコピーしました。"); }
    catch { setShareMessage("下の共有リンク欄を長押ししてコピーしてください。"); }
  };
  const saveQrImage = () => {
    if (!qrDataUrl) return;
    const anchor = document.createElement("a"); anchor.href = qrDataUrl; anchor.download = `${teacherTitle.trim() || "reading-lesson"}-qr.png`; anchor.click();
  };

  const resetAll = () => {
    if (!confirm("計測・設定・手書きメモをリセットしますか？読み込んだ教材は残ります。")) return;
    localStorage.removeItem("wpm-reader-v1");
    history.replaceState(null,"",location.pathname + location.search);
    setWpm(160); setShareUrl(""); setShareMessage(""); setQrDataUrl(""); setQrOpen(false);
    notesRef.current?.reset(); restart(); setTab("setup");
  };

  return <main>
    <header className="topbar">
      <div className="topbar-inner">
        <nav aria-label="画面切り替え">
          {([ ["setup","教材"], ["reader","読解"], ["notes","メモ"] ] as [PaceTab,string][]).map(([key,label])=><button key={key} className={tab===key?"active":""} aria-current={tab===key?"page":undefined} onClick={()=>openTab(key)}>{label}</button>)}
        </nav>
        <div className="pace-session-actions">
          {started && <button className="pace-checkpoint" disabled={savingPause} onClick={() => playing ? void pause() : start()}>{savingPause ? "保存中…" : playing ? "一時停止" : "再開"}</button>}
          <button className="reset-link" disabled={savingPause} onClick={resetAll}>リセット</button>
        </div>
      </div>
    </header>
    {pauseMessage && <p className="pace-pause-message" role="status">{pauseMessage}</p>}

    {tab === "setup" && <section className="setup shell">
      <div className="setup-heading"><div><h1>ペース読解</h1></div><div className="count-card"><strong>{words.length}</strong><span>語</span><small>約 {formatTime(totalSeconds)}</small></div></div>
      <div className="settings-row">
        <div className="pace-speed"><label className="field-label" htmlFor="pace-speed">目標スピード（WPM）</label>
          <input id="pace-speed" className="wpm-slider" type="range" min="40" max="500" step="10" value={wpm} onChange={e=>{setWpm(Number(e.target.value));setShareUrl("");setQrDataUrl("")}}/>
          <div className="fr-slider-labels" aria-hidden="true">{[40,100,200,300,400,500].map(value=><span key={value} style={{left:((value-40)*100/460)+"%"}}>{value}</span>)}</div>
        </div>
        <label className="number-box"><span>細かく指定</span><div><input aria-label="目標WPM" type="number" min="40" max="500" value={wpm} onChange={e=>{setWpm(Math.min(500,Math.max(40,Number(e.target.value))));setShareUrl("");setQrDataUrl("")}}/><b>WPM</b></div></label>
      </div>
      <button className="primary start-button" onClick={start} disabled={!words.length}>リーディングを始める <span>→</span></button>
      <details className="pace-material"><summary>本文を編集</summary>
        <label className="field-label" htmlFor="material">教材本文</label>
        <textarea id="material" className="material" value={text} onChange={e=>{setText(e.target.value);setShareUrl("");setQrDataUrl("");setQrOpen(false);}} maxLength={MAX_TEXT_CHARS} spellCheck={false}/>
        {(words.length > MAX_WORDS || text.length >= MAX_TEXT_CHARS) && <p role="alert">教材は{MAX_WORDS}語・{MAX_TEXT_CHARS}文字までです。</p>}
      </details>
      <div className="teacher-area"><button className="teacher-toggle" onClick={()=>setTeacherOpen(v=>!v)}>共有リンク・QR {teacherOpen?"−":"＋"}</button>{teacherOpen&&<div className="teacher-form"><label>教材名<input value={teacherTitle} onChange={e=>{setTeacherTitle(e.target.value);setShareUrl("");setQrDataUrl("")}} placeholder="例：Lesson 3 Reading" maxLength={80}/></label><button className="primary" onClick={createShareLink} disabled={shareBusy||!text.trim()}>{shareBusy?"作成中…":"リンク・QRを作成"}</button>{shareUrl&&<><label className="share-result">共有リンク<input value={shareUrl} readOnly onFocus={e=>e.currentTarget.select()}/></label><button className="show-qr" onClick={()=>setQrOpen(true)}>QRコードを大きく表示</button></>}<p>リンクを知っている人は教材を閲覧できます。</p>{shareMessage&&<p className="share-message">{shareMessage}</p>}</div>}</div>

    </section>}

    {tab === "reader" && <section className="reader shell-wide">
      <div className="reader-head"><div><h1>{playing ? "読解中" : started ? "一時停止" : words.length > 0 && index >= words.length ? "読了" : "読解前"}</h1></div><div className="wpm-badge"><strong>{wpm}</strong><span>WPM</span></div></div>
      <div className="progress-track"><i style={{width:`${progress}%`}}/></div>
      <div className="stats"><div><span>進捗</span><strong>{Math.round(progress)}%</strong></div><div><span>経過時間</span><strong>{formatTime(elapsed)}</strong></div><div><span>残り時間</span><strong>約 {formatTime(remaining)}</strong></div><div><span>読了語数</span><strong>{index} <small>/ {words.length}</small></strong></div></div>
      <article className="reading-card" aria-live="off">{readingParagraphs.map(paragraph=><p key={paragraph.key} className={paragraph.hasSourceIndent?"source-indented":""}>{paragraph.parts.map(part=>part.kind==="space"?<span className="reading-space" key={part.key}>{part.value}</span>:<span key={part.key} className={part.wordIndex<index?"read":""}>{part.value}</span>)}</p>)}</article>
      <div className="controls"><button onClick={restart} disabled={savingPause}>↺<span>最初から</span></button><button onClick={rewind} disabled={savingPause}>−10<small>秒</small><span>10秒戻る</span></button>{playing?<button className="play" onClick={() => void pause()}>Ⅱ<span>一時停止</span></button>:<button className="play" onClick={start} disabled={savingPause}>▶<span>{started?"再開":"再生"}</span></button>}<button onClick={()=>openTab("notes")}>✎<span>メモ</span></button></div>
      <div className="speech-panel"><label className="switch"><input type="checkbox" checked={speechOn} disabled={!speechSupported||!voices.length} onChange={e=>{setSpeechOn(e.target.checked); stopSpeech();}}/><i/><span><strong>英語音声読み上げ</strong>{(!speechSupported || !voices.length) && <small>英語音声を利用できません</small>}</span></label><label>英語の声<select value={voiceURI} onChange={e=>{stopSpeech();setVoiceURI(e.target.value)}} disabled={!speechSupported||!voices.length}>{voices.map(v=><option value={v.voiceURI} key={v.voiceURI}>{v.name}（{v.lang}）</option>)}</select></label><label>速度補正<select value={speechRate} onChange={e=>{stopSpeech();setSpeechRate(Number(e.target.value))}}><option value="0.85">ゆっくり</option><option value="1">標準</option><option value="1.15">速め</option></select></label></div>
    </section>}

    <NotesBoard hidden={tab !== "notes"} notesRef={notesRef} />
    {qrOpen && <div className="qr-backdrop" onClick={()=>setQrOpen(false)}><section className="qr-modal" role="dialog" aria-modal="true" aria-labelledby="qr-title" onClick={e=>e.stopPropagation()}><button className="qr-close" onClick={()=>setQrOpen(false)} aria-label="QRコードを閉じる">×</button><h2 id="qr-title">{teacherTitle || "Reading lesson"}</h2>{qrDataUrl?<img src={qrDataUrl} alt={`${teacherTitle || "教材"}の共有QRコード`}/>:<div className="qr-error">{qrError || "QRコードを作成できませんでした。"}</div>}<div className="qr-actions"><button onClick={copyExistingLink}>リンクをコピー</button><button className="primary" onClick={saveQrImage} disabled={!qrDataUrl}>QR画像を保存 ↓</button></div></section></div>}
  </main>;
}
