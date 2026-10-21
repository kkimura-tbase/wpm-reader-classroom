import { useState } from "react";
import Home from "./App";
import FreeReader from "./FreeReader";
import "./free-reader.css";

export default function ReaderRoot() {
  const [mode, setMode] = useState<"pace" | "free">("pace");
  const [busy, setBusy] = useState(false);
  return <>
    <div className="mode-bar" role="group" aria-label="読解モード">
      <strong>WPM READER</strong>
      <button aria-pressed={mode === "pace"} disabled={busy} onClick={() => setMode("pace")}>ペース読解</button>
      <button aria-pressed={mode === "free"} onClick={() => setMode("free")}>自由読解</button>
      {busy && <small>モードの変更は読了後にできます</small>}
    </div>
    {mode === "pace" ? <Home /> : <FreeReader onBusy={setBusy} />}
  </>;
}
