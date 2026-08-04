import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

const SAMPLE = `A small change in the way we read can make a big difference. When readers try to understand every single word, they often lose the main idea. Skilled readers move forward at a steady pace. They notice key words, connect ideas, and adjust their speed when the text becomes difficult.\n\nReading faster does not mean rushing. It means using your attention wisely. Start with a comfortable goal, follow the highlighted words, and keep moving. After reading, pause and write the most important idea in your own words. This short reflection helps turn speed into real understanding.`;
const WPM_PRESETS = [80, 100, 120, 140, 160, 200, 250, 300];
const COLORS = [
  { value: "#17212b", label: "黒" },
  { value: "#3157d5", label: "青" },
  { value: "#d84f45", label: "赤" },
  { value: "#2d8a62", label: "緑" },
  { value: "#7c4dcc", label: "紫" },
  { value: "#e47a28", label: "オレンジ" },
  { value: "#a8742a", label: "茶" },
  { value: "#6f7b84", label: "グレー" },
] as const;
const MAX_ERASER_SIZE = 48;
const MAX_WORDS = 1000;
const MAX_TEXT_CHARS = 12000;
type Tab = "setup" | "reader" | "notes";
type SourceMode = "paste" | "shared";
type DrawingInputMode = "stylus" | "all";
type LessonPackage = { v: 1; title: string; text: string; wpm: number };

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

async function decodeLesson(token: string): Promise<LessonPackage> {
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

export default function Home() {
  const [tab, setTab] = useState<Tab>("setup");
  const [text, setText] = useState(SAMPLE);
  const [wpm, setWpm] = useState(160);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [speechOn, setSpeechOn] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState("");
  const [speechRate, setSpeechRate] = useState(1);
  const [sourceMode, setSourceMode] = useState<SourceMode>("paste");
  const [sharedLesson, setSharedLesson] = useState<LessonPackage | null>(null);
  const [shareMessage, setShareMessage] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrError, setQrError] = useState("");
  const [qrOpen, setQrOpen] = useState(false);
  const [teacherOpen, setTeacherOpen] = useState(false);
  const [teacherTitle, setTeacherTitle] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [penColor, setPenColor] = useState<string>(COLORS[0].value);
  const [penSize, setPenSize] = useState(4);
  const [eraserSize, setEraserSize] = useState(MAX_ERASER_SIZE);
  const [eraser, setEraser] = useState(false);
  const [inputMode, setInputMode] = useState<DrawingInputMode>("stylus");
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const drawingPointerRef = useRef<number | null>(null);
  const scrollPointerRef = useRef<number | null>(null);
  const scrollLastYRef = useRef(0);
  const lastRef = useRef({ x: 0, y: 0 });
  const speechStartedRef = useRef(false);
  const speechSessionRef = useRef(0);
  const speechTimersRef = useRef<Set<number>>(new Set());
  const playingRef = useRef(false);

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

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("wpm-reader-v1") || "{}");
      if (typeof saved.text === "string") setText(saved.text);
      if (typeof saved.wpm === "number") setWpm(saved.wpm);
      if (typeof saved.voiceURI === "string") setVoiceURI(saved.voiceURI);
      if (typeof saved.speechRate === "number") setSpeechRate(saved.speechRate);
      if (saved.inputMode === "stylus" || saved.inputMode === "all") setInputMode(saved.inputMode);
    } catch { /* use defaults */ }
    const token = window.location.hash.match(/^#lesson=(.+)$/)?.[1];
    if (token) {
      decodeLesson(token).then(lesson => {
        const lessonWords = lesson.text.trim().split(/\s+/).filter(Boolean).length;
        if (lesson.text.length > MAX_TEXT_CHARS || lessonWords > MAX_WORDS) throw new Error("共有教材が上限を超えています。");
        setSharedLesson(lesson); setTeacherTitle(lesson.title); setText(lesson.text); setWpm(lesson.wpm); setSourceMode("shared");
        setShareMessage("共有教材を読み込みました。");
      }).catch(error => { setSourceMode("shared"); setShareMessage(error instanceof Error ? error.message : "共有教材を開けませんでした。"); });
    }
    setSpeechSupported("speechSynthesis" in window);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem("wpm-reader-v1", JSON.stringify({ text, wpm, voiceURI, speechRate, inputMode }));
  }, [text, wpm, voiceURI, speechRate, inputMode, hydrated]);

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
        setIndex(words.length); setPlaying(false); playingRef.current = false; setTab("notes"); speechStartedRef.current = false; return;
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
        setIndex(Math.min(endIndex, startIndex + Math.floor(delta * wpm / 60)));
      }, 80);
      speechTimersRef.current.add(smoothFallback);
      utter.onboundary = event => {
        if (session !== speechSessionRef.current || event.name !== "word") return;
        boundarySeen = true;
        const before = sentence.slice(0, event.charIndex).trim();
        const offset = before ? before.split(/\s+/).length : 0;
        setIndex(Math.min(endIndex, startIndex + offset + 1));
      };
      utter.onend = () => {
        window.clearInterval(smoothFallback);
        speechTimersRef.current.delete(smoothFallback);
        if (session !== speechSessionRef.current) return;
        setIndex(endIndex); speakSentence(endIndex);
      };
      utter.onerror = () => { window.clearInterval(smoothFallback); speechTimersRef.current.delete(smoothFallback); if (session === speechSessionRef.current) { setPlaying(false); playingRef.current = false; speechStartedRef.current = false; } };
      window.speechSynthesis.speak(utter);
    };
    speakSentence(from);
  }, [speechOn, speechSupported, words, voices, voiceURI, wpm, speechRate, stopSpeech]);

  useEffect(() => {
    if (!playing || !words.length) return;
    const interval = 60000 / wpm;
    const started = performance.now();
    const baseIndex = index;
    const baseElapsed = elapsed;
    if (speechOn && !speechStartedRef.current) speakFrom(index);
    const timer = window.setInterval(() => {
      const delta = (performance.now() - started) / 1000;
      setElapsed(baseElapsed + delta);
      if (!speechOn) {
        const next = Math.min(words.length, baseIndex + Math.floor(delta * wpm / 60));
        setIndex(next);
        if (next >= words.length) { setPlaying(false); playingRef.current = false; stopSpeech(); setTab("notes"); }
      }
    }, Math.min(100, interval / 2));
    return () => window.clearInterval(timer);
  }, [playing, wpm, words.length, speakFrom, speechOn, stopSpeech]); // intentional session snapshot

  const start = () => {
    if (!words.length) return;
    if (index >= words.length) { setIndex(0); setElapsed(0); }
    playingRef.current = true; setTab("reader"); setPlaying(true);
  };
  const pause = () => { playingRef.current = false; setPlaying(false); stopSpeech(); };
  const resume = () => { playingRef.current = true; setPlaying(true); };
  const restart = () => { playingRef.current = false; stopSpeech(); setIndex(0); setElapsed(0); setPlaying(false); };
  const rewind = () => { const n = Math.max(0, index - Math.round(wpm / 6)); const wasPlaying=playing; stopSpeech(); setIndex(n); setElapsed(n / wpm * 60); if (wasPlaying) { playingRef.current=true; setTimeout(()=>speakFrom(n),0); } };

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

  const restoreCanvas = useCallback((data?: string | null) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!data) return;
    const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height); img.src = data;
  }, []);
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current, wrap = canvasWrapRef.current; if (!canvas || !wrap) return;
    const old = canvas.width ? canvas.toDataURL() : localStorage.getItem("wpm-reader-drawing");
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = wrap.clientWidth * ratio; canvas.height = wrap.clientHeight * ratio;
    canvas.style.width = `${wrap.clientWidth}px`; canvas.style.height = `${wrap.clientHeight}px`;
    restoreCanvas(old);
  }, [restoreCanvas]);
  useEffect(() => {
    if (tab !== "notes") return;
    const id = requestAnimationFrame(resizeCanvas);
    window.addEventListener("resize", resizeCanvas);
    return () => { cancelAnimationFrame(id); window.removeEventListener("resize", resizeCanvas); };
  }, [tab, resizeCanvas]);

  const canvasSnapshot = () => canvasRef.current?.toDataURL("image/png") || "";
  const canvasPoint = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX-rect.left) * canvas.width/rect.width, y: (clientY-rect.top) * canvas.height/rect.height };
  };
  const drawStart = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (inputMode === "stylus" && e.pointerType === "touch") {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      scrollPointerRef.current = e.pointerId;
      scrollLastYRef.current = e.clientY;
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId); drawingRef.current = true; drawingPointerRef.current = e.pointerId; lastRef.current = canvasPoint(e.currentTarget, e.clientX, e.clientY);
    setUndoStack(s => [...s.slice(-19), canvasSnapshot()]); setRedoStack([]);
  };
  const drawMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (scrollPointerRef.current === e.pointerId) {
      e.preventDefault();
      window.scrollBy(0, scrollLastYRef.current - e.clientY);
      scrollLastYRef.current = e.clientY;
      return;
    }
    if (!drawingRef.current || drawingPointerRef.current !== e.pointerId) return; e.preventDefault(); const c = e.currentTarget, ctx = c.getContext("2d"); if (!ctx) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const event of events) {
      const p = canvasPoint(c, event.clientX, event.clientY); ctx.beginPath(); ctx.moveTo(lastRef.current.x, lastRef.current.y); ctx.lineTo(p.x,p.y);
      ctx.lineCap="round"; ctx.lineJoin="round"; ctx.lineWidth=(eraser ? eraserSize : penSize)*(c.width/c.clientWidth);
      ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over"; ctx.strokeStyle=penColor; ctx.stroke(); lastRef.current=p;
    }
  };
  const drawEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (scrollPointerRef.current === e.pointerId) { scrollPointerRef.current=null; return; }
    if (drawingPointerRef.current !== e.pointerId) return; drawingRef.current=false; drawingPointerRef.current=null; const shot=canvasSnapshot(); if (shot) localStorage.setItem("wpm-reader-drawing",shot);
  };
  const undo = () => { const prev=undoStack.at(-1); if (!prev) return; setRedoStack(s=>[...s,canvasSnapshot()]); setUndoStack(s=>s.slice(0,-1)); restoreCanvas(prev); localStorage.setItem("wpm-reader-drawing",prev); };
  const redo = () => { const next=redoStack.at(-1); if (!next) return; setUndoStack(s=>[...s,canvasSnapshot()]); setRedoStack(s=>s.slice(0,-1)); restoreCanvas(next); localStorage.setItem("wpm-reader-drawing",next); };
  const clearCanvas = () => { const snap=canvasSnapshot(); if (snap) setUndoStack(s=>[...s,snap]); restoreCanvas(null); localStorage.removeItem("wpm-reader-drawing"); };
  const saveImage = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width; exportCanvas.height = canvas.height;
    const ctx = exportCanvas.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    ctx.drawImage(canvas, 0, 0);
    const anchor = document.createElement("a"); anchor.href=exportCanvas.toDataURL("image/png"); anchor.download="reading-note.png"; anchor.click();
  };
  const resetAll = () => { if (!confirm("教材・設定・メモをすべてリセットしますか？")) return; localStorage.removeItem("wpm-reader-v1"); localStorage.removeItem("wpm-reader-drawing"); history.replaceState(null,"",`${location.pathname}${location.search}`); setText(SAMPLE); setWpm(160); setSharedLesson(null); setShareUrl(""); setShareMessage(""); setQrDataUrl(""); setQrOpen(false); setSourceMode("paste"); setPenColor(COLORS[0].value); setPenSize(4); setEraserSize(MAX_ERASER_SIZE); setEraser(false); setInputMode("stylus"); restart(); restoreCanvas(null); setTab("setup"); };

  return <main>
    <header className="topbar">
      <button className="brand" onClick={() => setTab("setup")} aria-label="ホームへ"><span>W</span><div><strong>WPM Reader</strong></div></button>
      <nav aria-label="画面切り替え">
        {([ ["setup","1  教材"], ["reader","2  リーディング"], ["notes","3  まとめ"] ] as [Tab,string][]).map(([key,label])=><button key={key} className={tab===key?"active":""} onClick={()=>setTab(key)}>{label}</button>)}
      </nav>
      <button className="reset-link" onClick={resetAll}>リセット</button>
    </header>

    {tab === "setup" && <section className="setup shell">
      <div className="eyebrow">LESSON SETUP <span>自動保存中</span></div>
      <div className="setup-heading"><div><h1>Choose what you’ll<br/>read today.</h1><p>Paste your own text, or choose one shared by your teacher.</p></div><div className="count-card"><strong>{words.length}</strong><span>WORDS</span><small>約 {formatTime(totalSeconds)}</small></div></div>
      <div className="source-tabs" role="tablist" aria-label="教材の選び方"><button className={sourceMode==="paste"?"active":""} onClick={()=>setSourceMode("paste")}>自分で貼り付け</button><button className={sourceMode==="shared"?"active":""} onClick={()=>setSourceMode("shared")}>共有教材</button></div>
      {sourceMode === "paste" ? <>
        <label className="field-label" htmlFor="material">教材本文 <span>ENGLISH TEXT</span></label>
        <textarea id="material" className="material" value={text} onChange={e=>{setText(e.target.value);restart();setSharedLesson(null);setShareUrl("");setQrDataUrl("");setQrOpen(false);}} maxLength={MAX_TEXT_CHARS} spellCheck={false}/>
        <small className="text-limit">{words.length.toLocaleString()} / {MAX_WORDS.toLocaleString()}語　·　{text.length.toLocaleString()} / {MAX_TEXT_CHARS.toLocaleString()}文字</small>
      </> : <div className="class-library shared-library">
        {sharedLesson ? <div className="shared-material-card"><span><strong>{sharedLesson.title}</strong><small>{sharedLesson.text.trim().split(/\s+/).length.toLocaleString()} words　·　推奨 {sharedLesson.wpm} WPM</small></span><b>読み込み済み</b></div> : <div className="shared-empty"><strong>共有リンクから教材を受け取れます</strong><p>先生から届いたリンクを開くと、教材とWPMが自動的に読み込まれます。</p></div>}
        {shareMessage && <p className="library-message">{shareMessage}</p>}
      </div>}
      <div className="teacher-area"><button className="teacher-toggle" onClick={()=>setTeacherOpen(v=>!v)}>先生用：この教材の共有リンクを作成 {teacherOpen?"−":"＋"}</button>{teacherOpen&&<div className="teacher-form"><label>教材名<input value={teacherTitle} onChange={e=>{setTeacherTitle(e.target.value);setShareUrl("");setQrDataUrl("")}} placeholder="例：Lesson 3 Reading" maxLength={80}/></label><button className="primary" onClick={createShareLink} disabled={shareBusy||!text.trim()}>{shareBusy?"作成中…":"リンク・QRを作成"}</button>{shareUrl&&<><label className="share-result">共有リンク<input value={shareUrl} readOnly onFocus={e=>e.currentTarget.select()}/></label><button className="show-qr" onClick={()=>setQrOpen(true)}>QRコードを大きく表示</button></>}<p>教材本文はサーバーへ保存されません。リンクを知っている人は教材を開けます。上限は{MAX_WORDS.toLocaleString()}語・{MAX_TEXT_CHARS.toLocaleString()}文字です。</p>{shareMessage&&<p className="share-message">{shareMessage}</p>}</div>}</div>
      <div className="settings-row">
        <div><label className="field-label">目標スピード <span>WORDS PER MINUTE</span></label><div className="presets">{WPM_PRESETS.map(v=><button key={v} className={wpm===v?"selected":""} onClick={()=>{setWpm(v);setShareUrl("");setQrDataUrl("")}}>{v}</button>)}</div></div>
        <label className="number-box"><span>細かく指定</span><div><input type="number" min="40" max="500" value={wpm} onChange={e=>{setWpm(Math.min(500,Math.max(40,Number(e.target.value))));setShareUrl("");setQrDataUrl("")}}/><b>WPM</b></div></label>
      </div>
      <button className="primary start-button" onClick={start} disabled={!words.length}>リーディングを始める <span>→</span></button>
    </section>}

    {tab === "reader" && <section className="reader shell-wide">
      <div className="reader-head"><div><div className="eyebrow">READING SESSION</div><h1>{playing ? "Keep the rhythm. Keep moving." : index ? "Paused." : "Ready when you are."}</h1></div><div className="wpm-badge"><strong>{wpm}</strong><span>WPM</span></div></div>
      <div className="progress-track"><i style={{width:`${progress}%`}}/></div>
      <div className="stats"><div><span>進捗</span><strong>{Math.round(progress)}%</strong></div><div><span>経過時間</span><strong>{formatTime(elapsed)}</strong></div><div><span>残り時間</span><strong>約 {formatTime(remaining)}</strong></div><div><span>読了語数</span><strong>{index} <small>/ {words.length}</small></strong></div></div>
      <article className="reading-card" aria-live="off">{readingParagraphs.map(paragraph=><p key={paragraph.key} className={paragraph.hasSourceIndent?"source-indented":""}>{paragraph.parts.map(part=>part.kind==="space"?<span className="reading-space" key={part.key}>{part.value}</span>:<span key={part.key} className={part.wordIndex<index?"read":""}>{part.value}</span>)}</p>)}</article>
      <div className="controls"><button onClick={restart}>↺<span>最初から</span></button><button onClick={rewind}>−10<small>秒</small><span>10秒戻る</span></button>{playing?<button className="play" onClick={pause}>Ⅱ<span>一時停止</span></button>:<button className="play" onClick={index?resume:start}>▶<span>{index?"再開":"再生"}</span></button>}<button onClick={()=>setTab("notes")}>✎<span>まとめへ</span></button></div>
      <div className="speech-panel"><label className="switch"><input type="checkbox" checked={speechOn} disabled={!speechSupported||!voices.length} onChange={e=>{setSpeechOn(e.target.checked); stopSpeech();}}/><i/><span><strong>英語音声読み上げ</strong><small>{!speechSupported?"このブラウザは音声に対応していません":!voices.length?"利用できる英語音声がありません":"音声の位置に本文を同期します"}</small></span></label><label>英語の声<select value={voiceURI} onChange={e=>{stopSpeech();setVoiceURI(e.target.value)}} disabled={!speechSupported||!voices.length}>{voices.map(v=><option value={v.voiceURI} key={v.voiceURI}>{v.name}（{v.lang}）</option>)}</select></label><label>速度補正<select value={speechRate} onChange={e=>{stopSpeech();setSpeechRate(Number(e.target.value))}}><option value="0.85">ゆっくり</option><option value="1">標準</option><option value="1.15">速め</option></select></label></div>
    </section>}

    {tab === "notes" && <section className="notes shell-wide">
      <div className="notes-head"><div><div className="eyebrow">QUICK REFLECTION</div><h1>Capture what<br/>stayed with you.</h1></div><p>It doesn’t have to be perfect.<br/>Start with the words, ideas, or images you remember.</p></div>
      <div className="notes-grid"><div className="paper"><div className="toolrow"><div className="tools"><button className={!eraser?"on":""} onClick={()=>setEraser(false)}>✎ <span>ペン</span></button><button className={eraser?"on":""} onClick={()=>setEraser(true)}>▱ <span>消しゴム</span></button>{COLORS.map(color=><button key={color.value} className={`color ${penColor===color.value?"chosen":""}`} style={{background:color.value}} onClick={()=>{setPenColor(color.value);setEraser(false)}} aria-label={`${color.label}のペン`}/>) }<label className="size">細<input type="range" min="2" max={eraser?MAX_ERASER_SIZE:18} value={eraser?eraserSize:penSize} onChange={e=>eraser?setEraserSize(Number(e.target.value)):setPenSize(Number(e.target.value))}/>太 <b>{eraser?eraserSize:penSize}</b></label><div className="input-modes" role="group" aria-label="手書き入力方法"><span>入力</span><button className={inputMode==="stylus"?"on":""} onClick={()=>setInputMode("stylus")} aria-pressed={inputMode==="stylus"}>Apple Pencil</button><button className={inputMode==="all"?"on":""} onClick={()=>setInputMode("all")} aria-pressed={inputMode==="all"}>指＋Pencil</button></div></div><div className="history"><button onClick={undo} disabled={!undoStack.length}>↶</button><button onClick={redo} disabled={!redoStack.length}>↷</button><button onClick={clearCanvas}>全消去</button><button className="save-note" onClick={saveImage}>画像保存 ↓</button></div></div><div className="canvas-wrap" ref={canvasWrapRef}><canvas className={inputMode==="all"?"finger-input":"stylus-input"} ref={canvasRef} onPointerDown={drawStart} onPointerMove={drawMove} onPointerUp={drawEnd} onPointerCancel={drawEnd} onLostPointerCapture={drawEnd} aria-label="手書きメモ用キャンバス"/><span>{inputMode==="stylus"?"APPLE PENCIL / 指はスクロール":"FINGER + PENCIL / 指でも筆記"}</span></div></div></div>
    </section>}
    {qrOpen && <div className="qr-backdrop" onClick={()=>setQrOpen(false)}><section className="qr-modal" role="dialog" aria-modal="true" aria-labelledby="qr-title" onClick={e=>e.stopPropagation()}><button className="qr-close" onClick={()=>setQrOpen(false)} aria-label="QRコードを閉じる">×</button><div className="eyebrow">SHARE WITH CLASS</div><h2 id="qr-title">{teacherTitle || "Reading lesson"}</h2><p>生徒はカメラでQRコードを読み取ってください。</p>{qrDataUrl?<img src={qrDataUrl} alt={`${teacherTitle || "教材"}の共有QRコード`}/>:<div className="qr-error">{qrError || "QRコードを作成できませんでした。"}</div>}<div className="qr-actions"><button onClick={copyExistingLink}>リンクをコピー</button><button className="primary" onClick={saveQrImage} disabled={!qrDataUrl}>QR画像を保存 ↓</button></div></section></div>}
  </main>;
}
