import { useEffect, useState } from "react";
import Home, { decodeLesson as decodePaceLesson } from "./App";
import FreeReader from "./FreeReader";
import { validateLesson } from "./lesson";
import { LESSON_KEY, restoreLesson } from "./sharedLesson";
import { decodeLesson, payloadFromHash } from "./share";
import { fetchLesson, srcFromSearch, SRC_PARAM } from "./sharesrc";

export default function ReaderRoot() {
  const [mode, setMode] = useState<"pace" | "free">("free");
  const [lesson, setLesson] = useState(() => restoreLesson(localStorage));
  const [paceWpm, setPaceWpm] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    try { localStorage.setItem(LESSON_KEY, JSON.stringify(lesson)); setSaveError(""); }
    catch { setSaveError("教材を端末に保存できませんでした。必要な教材はファイルで保存してください。"); }
  }, [lesson]);

  useEffect(() => {
    let cancelled = false;
    let request = 0;
    const load = async () => {
      const hash = location.hash;
      const payload = payloadFromHash(hash);
      const src = srcFromSearch(location.search);
      const pace = hash.match(/^#lesson=(.+)$/)?.[1];
      if (payload === null && src === null && !pace) return;
      const id = ++request;
      setLoading(true);
      try {
        const legacy = pace ? await decodePaceLesson(pace) : null;
        const next = legacy ? validateLesson({ version: 1, title: legacy.title || "共有教材", text: legacy.text, glosses: [] })
          : payload !== null ? await decodeLesson(payload) : await fetchLesson(src!, location.href);
        if (cancelled || id !== request) return;
        setMode("free"); setLesson(next); setPaceWpm(legacy?.wpm); setRevision(n => n + 1);
        setMessage("");
        const url = new URL(location.href);
        url.hash = ""; url.searchParams.delete(SRC_PARAM);
        history.replaceState(null, "", url);
      } catch (error) {
        if (!cancelled && id === request) setMessage(error instanceof Error ? error.message : "教材を読み込めませんでした。");
      } finally { if (!cancelled && id === request) setLoading(false); }
    };
    void load();
    window.addEventListener("hashchange", load);
    return () => { cancelled = true; window.removeEventListener("hashchange", load); };
  }, []);

  async function importFile(file?: File) {
    if (!file) return;
    setLoading(true);
    try {
      if (file.size > 2_000_000) throw new Error("教材ファイルは2MB以下にしてください。");
      const next = validateLesson(JSON.parse(await file.text()));
      if (lesson && !confirm("教材を切り替えます。手書きメモは残ります。必要なら先に画像保存してください。")) return;
      setLesson(next); setPaceWpm(undefined); setRevision(n => n + 1);
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "教材を読み込めませんでした。"); }
    finally { setLoading(false); }
  }

  return <>
    <div className="mode-bar" role="group" aria-label="読解モード">
      <strong>WPM READER</strong>
      <button aria-pressed={mode === "free"} disabled={busy || loading} onClick={() => { if (mode === "pace") setPaceWpm(undefined); setMode("free"); }}>自由読解</button>
      <button aria-pressed={mode === "pace"} disabled={busy || loading} onClick={() => setMode("pace")}>ペース読解</button>
      {busy && <small>計測中</small>}
    </div>
    <section className="shared-material" aria-label="共通の教材">
      <div><strong>{lesson?.title || "教材未読み込み"}</strong></div>
      <label className={`fr-file fr-file-button${busy || loading ? " is-disabled" : ""}`}>＋ 教材ファイルを開く<input className="visually-hidden" type="file" accept=".json,application/json" disabled={busy || loading} onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ""; }} /></label>
      {loading && <p role="status">教材を読み込み中…</p>}
      {message && <p role="status">{message}</p>}
      {saveError && <p role="alert">{saveError}</p>}
    </section>
    {!lesson ? <main className="fr-empty"><h1>教材が読み込まれていません</h1><p>「教材ファイルを開く」から選んでください。</p></main> : mode === "pace" ? <Home key={revision} lesson={lesson} onLessonChange={setLesson} onBusy={setBusy} initialWpm={paceWpm} />
      : <FreeReader key={revision} lesson={lesson} setLesson={setLesson} onBusy={setBusy} />}
  </>;
}
