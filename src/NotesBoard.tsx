import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";
import { canDrawPointer, isStylusTouch } from "./canvasInput";
import { drawStroke, EMPTY_NOTE, encodeNoteImage, extendStroke, loadNote, paintNote, startStroke, storeNote } from "./noteInk";
import type { InkPoint, InkStroke, NoteDocument } from "./noteInk";
import NoteImageDialog from "./NoteImageDialog";

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
const MIN_CANVAS_ZOOM = 0.25;
const MAX_CANVAS_ZOOM = 3;
const CANVAS_ZOOM_STEP = 0.25;
type DrawingInputMode = "stylus" | "all";
type CanvasPinch = {
  distance: number;
  zoom: number;
  contentX: number;
  contentY: number;
};

export type NotesControls = { reset: () => void; checkpoint: () => Promise<boolean> };
type NoteView = { left: number; top: number; zoom: number; input: DrawingInputMode };

const DEFAULT_VIEW: NoteView = { left: 0, top: 0, zoom: 1, input: "stylus" };
const clampCanvasZoom = (value: number) => Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, value));

function loadView(key: string, embedded: boolean): NoteView {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (!saved) {
      const oldInput = !embedded && JSON.parse(localStorage.getItem("wpm-reader-v1") || "{}").inputMode;
      return { ...DEFAULT_VIEW, input: oldInput === "all" ? "all" : "stylus" };
    }
    return {
      left: Number.isFinite(saved.left) ? Math.max(0, saved.left) : 0,
      top: Number.isFinite(saved.top) ? Math.max(0, saved.top) : 0,
      zoom: Number.isFinite(saved.zoom) ? clampCanvasZoom(saved.zoom) : 1,
      input: saved.input === "all" ? "all" : "stylus",
    };
  } catch { return { ...DEFAULT_VIEW }; }
}

export default function NotesBoard({ embedded = false, hidden = false, notesRef }: {
  embedded?: boolean; hidden?: boolean; notesRef?: Ref<NotesControls>;
}) {
  const drawingKey = embedded ? "wpm-free-drawing" : "wpm-reader-drawing";
  const viewKey = drawingKey + "-view";
  const [initialView] = useState(() => loadView(viewKey, embedded));
  const viewRef = useRef({ ...initialView });
  const [ready, setReady] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [imageError, setImageError] = useState("");
  const [preparingImage, setPreparingImage] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const pagePosition = useRef({ left: 0, top: 0 });
  const headingId = useId();
  const [penColor, setPenColor] = useState<string>(COLORS[0].value);
  const [penSize, setPenSize] = useState(4);
  const [eraserSize, setEraserSize] = useState(MAX_ERASER_SIZE);
  const [eraser, setEraser] = useState(false);
  const [inputMode, setInputMode] = useState<DrawingInputMode>(initialView.input);
  const [panMode, setPanMode] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState(initialView.zoom);
  const [undoStack, setUndoStack] = useState<NoteDocument[]>([]);
  const [redoStack, setRedoStack] = useState<NoteDocument[]>([]);
  const documentRef = useRef<NoteDocument>(EMPTY_NOTE);
  const activeStroke = useRef<InkStroke | null>(null);
  const pendingSave = useRef<Promise<boolean>>(Promise.resolve(true));
  const unsaved = useRef(false);
  const edited = useRef(false);
  const legacyImage = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const canvasStageRef = useRef<HTMLDivElement>(null);
  const extent = useRef({ width: 0, height: 0 });
  const canvasZoomRef = useRef(initialView.zoom);
  const drawingPointerRef = useRef<number | null>(null);
  const scrollPointerRef = useRef<number | null>(null);
  const scrollLastXRef = useRef(0);
  const scrollLastYRef = useRef(0);
  const stylusTouchRef = useRef<number | null>(null);
  const pinchRef = useRef<CanvasPinch | null>(null);
  const frame = useRef(0);
  const viewTimer = useRef(0);

  const paint = useCallback(() => {
    const wrap = canvasWrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas || !wrap.clientWidth || !wrap.clientHeight) return;
    const zoom = canvasZoomRef.current;
    const width = wrap.clientWidth, height = wrap.clientHeight;
    const density = Math.min(window.devicePixelRatio || 1, 3, 4096 / width, 4096 / height, Math.sqrt(4_000_000 / (width * height)));
    const pixelsWide = Math.floor(width * density), pixelsHigh = Math.floor(height * density);
    if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
    if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.resetTransform();
    ctx.clearRect(0, 0, pixelsWide, pixelsHigh);
    const ratioX = pixelsWide / width, ratioY = pixelsHigh / height;
    const left = wrap.scrollLeft, top = wrap.scrollTop;
    ctx.setTransform(ratioX * zoom, 0, 0, ratioY * zoom, -left * ratioX, -top * ratioY);
    const view = { left: left / zoom, top: top / zoom, right: (left + width) / zoom, bottom: (top + height) / zoom };
    paintNote(ctx, documentRef.current, legacyImage.current, view);
    if (activeStroke.current) drawStroke(ctx, activeStroke.current, view);
  }, []);

  const requestPaint = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      paint();
    });
  }, [paint]);

  const growPaper = useCallback((left: number, top: number) => {
    const wrap = canvasWrapRef.current, stage = canvasStageRef.current, canvas = canvasRef.current;
    if (!wrap || !stage || !canvas || !wrap.clientWidth || !wrap.clientHeight) return;
    const width = wrap.clientWidth, height = wrap.clientHeight, zoom = canvasZoomRef.current;
    const paper = extent.current;
    const addSpace = (edge: number, viewport: number, current: number) =>
      edge + viewport * 1.25 > current * zoom ? Math.ceil((edge + viewport * 2.5) / zoom) : current;
    paper.width = addSpace(left, width, paper.width);
    paper.height = addSpace(top, height, paper.height);
    stage.style.width = Math.ceil(paper.width * zoom) + "px";
    stage.style.height = Math.ceil(paper.height * zoom) + "px";
    stage.style.backgroundSize = "100% " + 34 * zoom + "px";
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
  }, []);

  const readPosition = useCallback(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap?.clientWidth || !wrap.clientHeight) return;
    viewRef.current.left = wrap.scrollLeft / canvasZoomRef.current;
    viewRef.current.top = wrap.scrollTop / canvasZoomRef.current;
  }, []);

  const storeView = useCallback(() => {
    try { localStorage.setItem(viewKey, JSON.stringify(viewRef.current)); }
    catch { /* Ink can still be saved in IndexedDB. */ }
  }, [viewKey]);

  const removeOldImage = useCallback(() => {
    try { localStorage.removeItem(drawingKey); }
    catch { /* The new document has already been saved. */ }
  }, [drawingKey]);

  const scrollCanvasTo = useCallback((left: number, top: number) => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    growPaper(left, top);
    wrap.scrollLeft = left;
    wrap.scrollTop = top;
    readPosition();
    requestPaint();
  }, [growPaper, readPosition, requestPaint]);

  const applyCanvasZoom = useCallback((value: number) => {
    const next = Math.round(clampCanvasZoom(value) * 100) / 100;
    canvasZoomRef.current = next;
    viewRef.current.zoom = next;
    setCanvasZoom(next);
    return next;
  }, []);

  const zoomCanvasTo = (value: number) => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const x = wrap.clientWidth / 2, y = wrap.clientHeight / 2;
    const previous = canvasZoomRef.current;
    const next = applyCanvasZoom(value);
    scrollCanvasTo((wrap.scrollLeft + x) / previous * next - x, (wrap.scrollTop + y) / previous * next - y);
    storeView();
  };

  const onCanvasScroll = () => {
    const wrap = canvasWrapRef.current;
    if (!wrap?.clientWidth) return;
    growPaper(wrap.scrollLeft, wrap.scrollTop);
    readPosition();
    requestPaint();
    window.clearTimeout(viewTimer.current);
    viewTimer.current = window.setTimeout(storeView, 250);
  };

  useEffect(() => {
    if (hidden) return;
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const resize = () => {
      const view = viewRef.current;
      scrollCanvasTo(view.left * view.zoom, view.top * view.zoom);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [hidden, scrollCanvasTo]);

  useEffect(() => {
    viewRef.current.input = inputMode;
    storeView();
  }, [inputMode, storeView]);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      let saved: NoteDocument | undefined;
      let readFailed = false;
      try { saved = await loadNote(drawingKey); }
      catch { readFailed = true; }
      if (cancelled || edited.current) return;
      try {
        const source = saved ? saved.legacy?.source : localStorage.getItem(drawingKey);
        if (source) {
          const image = new Image();
          image.src = source;
          await image.decode();
          if (cancelled || edited.current) return;
          legacyImage.current = image;
          if (!saved) {
            saved = { strokes: [], legacy: { source, width: image.naturalWidth / Math.min(window.devicePixelRatio || 1, 2) } };
            if (!readFailed) {
              await storeNote(drawingKey, saved);
              removeOldImage();
            }
          }
        }
      } catch { readFailed = true; }
      if (cancelled || edited.current) return;
      documentRef.current = saved ?? EMPTY_NOTE;
      if (readFailed) setNoteError("保存したメモを完全に読み込めませんでした。");
      setReady(true);
      requestPaint();
    }
    void restore();
    return () => { cancelled = true; };
  }, [drawingKey, removeOldImage, requestPaint]);

  const saveDocument = (next: NoteDocument) => {
    edited.current = true;
    documentRef.current = next;
    unsaved.current = true;
    requestPaint();
    const pending = storeNote(drawingKey, next).then(() => {
      if (pendingSave.current === pending) {
        unsaved.current = false;
        if (next.legacy || next === EMPTY_NOTE) removeOldImage();
        setNoteError("");
      }
      return true;
    }).catch(() => {
      if (pendingSave.current === pending) setNoteError("メモをこの端末に保存できません。必要なメモは画像で保存してください。");
      return false;
    });
    pendingSave.current = pending;
    return pending;
  };

  const canvasPoint = (canvas: HTMLCanvasElement, clientX: number, clientY: number): InkPoint => {
    const rect = canvas.getBoundingClientRect();
    const wrap = canvasWrapRef.current!;
    const zoom = canvasZoomRef.current;
    // Quantize below a screen pixel so saved coordinates stay compact.
    return {
      x: Math.round((wrap.scrollLeft + Math.max(0, Math.min(rect.width, clientX - rect.left))) / zoom * 16) / 16,
      y: Math.round((wrap.scrollTop + Math.max(0, Math.min(rect.height, clientY - rect.top))) / zoom * 16) / 16,
    };
  };

  const addPoints = (points: InkPoint[]) => {
    if (!activeStroke.current) return;
    extendStroke(activeStroke.current, points);
    requestPaint();
  };

  const commitStroke = () => {
    const stroke = activeStroke.current;
    activeStroke.current = null;
    drawingPointerRef.current = null;
    if (!stroke) return;
    const before = documentRef.current;
    setUndoStack(old => [...old.slice(-19), before]);
    setRedoStack([]);
    void saveDocument({ ...before, strokes: [...before.strokes, stroke] });
  };

  const checkpoint = () => {
    if (activeStroke.current) commitStroke();
    storeView();
    if (unsaved.current) return pendingSave.current.then(ok => ok || saveDocument(documentRef.current));
    return pendingSave.current;
  };

  useEffect(() => {
    return () => {
      window.clearTimeout(viewTimer.current);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
      storeView();
    };
  }, [storeView]);
  const releaseCapturedPointer = (canvas: HTMLCanvasElement, pointerId: number) => {
    try { if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId); }
    catch { /* The browser may have already released this pointer. */ }
  };
  const beginPanningAt = (canvas: HTMLCanvasElement, pointerId: number, clientX: number, clientY: number, capturePointer = false) => {
    if (drawingPointerRef.current !== null || scrollPointerRef.current !== null) return;
    if (capturePointer) {
      try { canvas.setPointerCapture(pointerId); }
      catch { /* Direct hit testing can continue the pan. */ }
    }
    scrollPointerRef.current = pointerId;
    scrollLastXRef.current = clientX; scrollLastYRef.current = clientY;
  };
  const movePanningAt = (clientX: number, clientY: number) => {
    const wrap = canvasWrapRef.current; if (!wrap) return;
    scrollCanvasTo(wrap.scrollLeft + scrollLastXRef.current - clientX, wrap.scrollTop + scrollLastYRef.current - clientY);
    scrollLastXRef.current = clientX; scrollLastYRef.current = clientY;
  };
  const beginDrawingAt = (canvas: HTMLCanvasElement, pointerId: number, clientX: number, clientY: number, capturePointer = false) => {
    if (scrollPointerRef.current !== null) {
      const scrollingPointer = scrollPointerRef.current;
      scrollPointerRef.current = null;
      releaseCapturedPointer(canvas, scrollingPointer);
    }
    if (!ready) return;
    if (capturePointer) {
      try { canvas.setPointerCapture(pointerId); }
      catch { /* Implicit capture or normal hit testing can continue the stroke. */ }
    }
    drawingPointerRef.current = pointerId;
    activeStroke.current = startStroke(canvasPoint(canvas, clientX, clientY), penColor, eraser ? eraserSize : penSize, eraser);
    requestPaint();
  };
  const beginDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    beginDrawingAt(e.currentTarget, e.pointerId, e.clientX, e.clientY, true);
  };
  const finishDrawing = (pointerId: number, endPoint?: InkPoint) => {
    if (drawingPointerRef.current !== pointerId) return;
    if (endPoint) addPoints([endPoint]);
    commitStroke();
  };
  const drawStart = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pinchRef.current) { e.preventDefault(); return; }
    const looksLikePen = e.pointerType === "pen";
    if (stylusTouchRef.current !== null && looksLikePen) return;
    if (panMode || (inputMode === "stylus" && e.pointerType === "touch")) {
      e.preventDefault();
      beginPanningAt(e.currentTarget, e.pointerId, e.clientX, e.clientY, true);
      return;
    }
    if (drawingPointerRef.current !== null) return;
    if (!canDrawPointer(inputMode, e.pointerType)) return;
    beginDrawing(e);
  };
  const drawMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pinchRef.current) { e.preventDefault(); return; }
    const looksLikePen = e.pointerType === "pen";
    if (stylusTouchRef.current !== null && looksLikePen) { e.preventDefault(); return; }
    let recoveredFromMove = false;
    if (scrollPointerRef.current === e.pointerId) {
      e.preventDefault();
      movePanningAt(e.clientX, e.clientY);
      return;
    }
    if (drawingPointerRef.current !== e.pointerId) {
      const pointerCanDraw = !panMode && canDrawPointer(inputMode, e.pointerType);
      const pointerIsInContact = e.buttons !== 0 || e.pressure > 0;
      if (drawingPointerRef.current === null && pointerCanDraw && pointerIsInContact) { beginDrawing(e); recoveredFromMove = true; }
      else return;
    }
    e.preventDefault(); const canvas = e.currentTarget;
    const coalescedEvents = e.nativeEvent.getCoalescedEvents?.();
    const events = coalescedEvents?.length ? coalescedEvents : [e.nativeEvent];
    addPoints(events.slice(recoveredFromMove ? 1 : 0).map(event => canvasPoint(canvas, event.clientX, event.clientY)));
  };
  const drawEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (scrollPointerRef.current === e.pointerId) { scrollPointerRef.current=null; releaseCapturedPointer(e.currentTarget, e.pointerId); return; }
    if (drawingPointerRef.current !== e.pointerId) return;
    if (stylusTouchRef.current !== null && e.pointerType === "pen") { e.preventDefault(); return; }
    e.preventDefault();
    finishDrawing(e.pointerId, e.type === "pointerup" ? canvasPoint(e.currentTarget, e.clientX, e.clientY) : undefined);
  };
  useEffect(() => {
    if (hidden) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const wrap = canvasWrapRef.current; if (!wrap) return;
    const isApplePencilTouch = (touch: Touch) => isStylusTouch(touch as Touch & { touchType?: string });
    const fingerTouches = (touches: TouchList) => Array.from(touches).filter(touch => !isApplePencilTouch(touch));
    const touchDistance = (first: Touch, second: Touch) => Math.hypot(second.clientX-first.clientX, second.clientY-first.clientY);
    const touchCenter = (first: Touch, second: Touch) => ({ x:(first.clientX+second.clientX)/2, y:(first.clientY+second.clientY)/2 });
    const touchPointerId = (identifier: number) => -(identifier+1);
    const findActiveTouch = (touches: TouchList) => Array.from(touches).find(touch => touch.identifier === stylusTouchRef.current);
    const handleStylusTouchStart = (event: TouchEvent) => {
      const fingers = fingerTouches(event.touches);
      if (inputMode === "stylus" && fingers.length >= 2) {
        event.preventDefault();
        if (scrollPointerRef.current !== null) {
          releaseCapturedPointer(canvas, scrollPointerRef.current);
          scrollPointerRef.current=null;
        }
        const center = touchCenter(fingers[0], fingers[1]);
        const rect = wrap.getBoundingClientRect();
        const localX = center.x-rect.left, localY = center.y-rect.top;
        const zoom = canvasZoomRef.current;
        pinchRef.current = {
          distance:Math.max(1,touchDistance(fingers[0],fingers[1])), zoom,
          contentX:(wrap.scrollLeft+localX)/zoom, contentY:(wrap.scrollTop+localY)/zoom,
        };
        return;
      }
      const touch = Array.from(event.changedTouches).find(isApplePencilTouch); if (!touch) return;
      event.preventDefault();
      stylusTouchRef.current=touch.identifier;
      const pointerId = touchPointerId(touch.identifier);
      if (panMode) beginPanningAt(canvas, pointerId, touch.clientX, touch.clientY);
      else if (drawingPointerRef.current === null) beginDrawingAt(canvas, pointerId, touch.clientX, touch.clientY);
    };
    const handleStylusTouchMove = (event: TouchEvent) => {
      if (pinchRef.current) {
        const fingers = fingerTouches(event.touches); if (fingers.length < 2) return;
        event.preventDefault();
        const pinch = pinchRef.current;
        const center = touchCenter(fingers[0],fingers[1]);
        const rect = wrap.getBoundingClientRect();
        const localX = center.x-rect.left, localY = center.y-rect.top;
        const next = applyCanvasZoom(pinch.zoom*touchDistance(fingers[0],fingers[1])/pinch.distance);
        scrollCanvasTo(pinch.contentX * next - localX, pinch.contentY * next - localY);
        return;
      }
      if (stylusTouchRef.current === null) return;
      const touch = findActiveTouch(event.touches) ?? findActiveTouch(event.changedTouches); if (!touch) return;
      event.preventDefault();
      const pointerId = touchPointerId(touch.identifier);
      if (panMode) {
        if (scrollPointerRef.current === null) beginPanningAt(canvas, pointerId, touch.clientX, touch.clientY);
        if (scrollPointerRef.current === pointerId) movePanningAt(touch.clientX,touch.clientY);
      } else {
        if (drawingPointerRef.current === null) beginDrawingAt(canvas, pointerId, touch.clientX, touch.clientY);
        addPoints([canvasPoint(canvas, touch.clientX, touch.clientY)]);
      }
    };
    const handleStylusTouchEnd = (event: TouchEvent) => {
      const touch = stylusTouchRef.current === null ? undefined : findActiveTouch(event.changedTouches);
      if (touch) {
        event.preventDefault();
        const pointerId = touchPointerId(touch.identifier);
        if (panMode) {
          if (scrollPointerRef.current === pointerId) scrollPointerRef.current=null;
        } else if (drawingPointerRef.current !== null) {
          finishDrawing(drawingPointerRef.current, event.type === "touchend" ? canvasPoint(canvas, touch.clientX, touch.clientY) : undefined);
        }
        stylusTouchRef.current=null;
      }
      if (pinchRef.current && fingerTouches(event.touches).length < 2) {
        event.preventDefault(); pinchRef.current=null;
      }
    };
    canvas.addEventListener("touchstart", handleStylusTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleStylusTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleStylusTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", handleStylusTouchEnd, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", handleStylusTouchStart);
      canvas.removeEventListener("touchmove", handleStylusTouchMove);
      canvas.removeEventListener("touchend", handleStylusTouchEnd);
      canvas.removeEventListener("touchcancel", handleStylusTouchEnd);
      stylusTouchRef.current=null; pinchRef.current=null;
      if (scrollPointerRef.current !== null && scrollPointerRef.current < 0) scrollPointerRef.current=null;
    };
  }, [hidden, ready, inputMode, panMode, eraser, eraserSize, penSize, penColor, applyCanvasZoom]);
  const undo = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    const current = documentRef.current;
    setRedoStack(old => [...old.slice(-19), current]);
    setUndoStack(old => old.slice(0, -1));
    void saveDocument(previous);
  };

  const redo = () => {
    const next = redoStack.at(-1);
    if (!next) return;
    const current = documentRef.current;
    setUndoStack(old => [...old.slice(-19), current]);
    setRedoStack(old => old.slice(0, -1));
    void saveDocument(next);
  };

  const clearCanvas = () => {
    if (!ready) return;
    const previous = documentRef.current;
    setUndoStack(old => [...old.slice(-19), previous]);
    setRedoStack([]);
    activeStroke.current = null;
    drawingPointerRef.current = null;
    void saveDocument(EMPTY_NOTE);
  };

  const prepareImage = async () => {
    setPreparingImage(true);
    setImageError("");
    try {
      const blob = await encodeNoteImage(documentRef.current, legacyImage.current);
      setImageFile(new File([blob], "reading-note.png", { type: "image/png" }));
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "画像を作成できませんでした。");
    } finally { setPreparingImage(false); }
  };

  const resetNotes = () => {
    setReady(true);
    activeStroke.current = null;
    drawingPointerRef.current = null;
    scrollPointerRef.current = null;
    stylusTouchRef.current = null;
    pinchRef.current = null;
    extent.current = { width: 0, height: 0 };
    viewRef.current = { ...DEFAULT_VIEW };
    applyCanvasZoom(1);
    scrollCanvasTo(0, 0);
    storeView();
    setPenColor(COLORS[0].value);
    setPenSize(4);
    setEraserSize(MAX_ERASER_SIZE);
    setEraser(false);
    setInputMode("stylus");
    setPanMode(false);
    setUndoStack([]);
    setRedoStack([]);
    setImageError("");
    void saveDocument(EMPTY_NOTE);
  };

  useImperativeHandle(notesRef, () => ({ reset: resetNotes, checkpoint }));
  const pageCheckpoint = useRef(checkpoint);
  useEffect(() => { pageCheckpoint.current = checkpoint; });
  useEffect(() => {
    const save = () => { void pageCheckpoint.current(); };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, []);

  useEffect(() => {
    if (!fullscreen || !boardRef.current) return;
    const board = boardRef.current;
    fullscreenButton.current?.focus({ preventScroll: true });
    // Leave the same canvas mounted and suspend interaction with the surrounding page.
    const suspended: HTMLElement[] = [];
    for (let branch: HTMLElement | null = board; branch && branch !== document.body; branch = branch.parentElement) {
      for (const sibling of branch.parentElement?.children ?? []) {
        if (sibling !== branch && sibling instanceof HTMLElement && !sibling.inert) {
          sibling.inert = true;
          suspended.push(sibling);
        }
      }
    }
    const overflow = document.body.style.overflow;
    const previousPagePosition = pagePosition.current;
    document.body.style.overflow = "hidden";

    function handleKeyboard(event: KeyboardEvent) {
      if (board.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setFullscreen(false);
      } else if (event.key === "Tab") {
        const controls = [...board.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href]")];
        const boundary = event.shiftKey ? controls.at(0) : controls.at(-1);
        if (document.activeElement === boundary) {
          event.preventDefault();
          (event.shiftKey ? controls.at(-1) : controls.at(0))?.focus();
        }
      }
    }
    window.addEventListener("keydown", handleKeyboard);
    return () => {
      window.removeEventListener("keydown", handleKeyboard);
      suspended.forEach(element => { element.inert = false; });
      document.body.style.overflow = overflow;
      window.scrollTo({ ...previousPagePosition, behavior: "instant" });
      fullscreenButton.current?.focus({ preventScroll: true });
    };
  }, [fullscreen]);

  function toggleFullscreen() {
    if (!fullscreen) pagePosition.current = { left: window.scrollX, top: window.scrollY };
    setFullscreen(!fullscreen);
  }

  const Heading = embedded ? "h2" : "h1";
  return <div ref={boardRef} className={[embedded && "embedded-notes", fullscreen && "notes-overlay"].filter(Boolean).join(" ")} hidden={hidden}
    role={fullscreen ? "dialog" : undefined} aria-modal={fullscreen || undefined} aria-labelledby={fullscreen ? headingId : undefined}>
    <section className="notes shell-wide">
      <div className="notes-head">
        <Heading id={headingId}>手書きメモ</Heading>
        <button ref={fullscreenButton} className="notes-fullscreen-button" type="button" onClick={toggleFullscreen}>
          {fullscreen ? "全画面を終了" : "全画面表示"}
        </button>
      </div>
      <div className="notes-grid"><div className="paper">
        <div className="toolrow">
          <div className="tools">
            <button className={!panMode&&!eraser?"on":""} onClick={()=>{setPanMode(false);setEraser(false)}} aria-pressed={!panMode&&!eraser}>✎ <span>ペン</span></button>
            <button className={!panMode&&eraser?"on":""} onClick={()=>{setPanMode(false);setEraser(true)}} aria-pressed={!panMode&&eraser}>▱ <span>消しゴム</span></button>
            <button className={panMode?"on":""} onClick={()=>setPanMode(value=>!value)} aria-pressed={panMode}>✥ <span>移動</span></button>
            {COLORS.map(color=><button key={color.value} className={`color ${penColor===color.value?"chosen":""}`} style={{background:color.value}} onClick={()=>{setPenColor(color.value);setEraser(false);setPanMode(false)}} aria-label={`${color.label}のペン`} aria-pressed={penColor===color.value}/>) }
            <label className="size">細<input aria-label={eraser?"消しゴムの太さ":"ペンの太さ"} type="range" min="2" max={eraser?MAX_ERASER_SIZE:18} value={eraser?eraserSize:penSize} onChange={e=>eraser?setEraserSize(Number(e.target.value)):setPenSize(Number(e.target.value))}/>太 <b>{eraser?eraserSize:penSize}</b></label>
            <div className="input-modes" role="group" aria-label="手書き入力方法"><span>入力</span><button className={inputMode==="stylus"?"on":""} onClick={()=>{setInputMode("stylus");setPanMode(false)}} aria-pressed={inputMode==="stylus"} aria-label="画面用ペンまたはマウスで書く。指はキャンバスの移動とピンチ拡大に使用">ペン・マウス</button><button className={inputMode==="all"?"on":""} onClick={()=>{setInputMode("all");setPanMode(false)}} aria-pressed={inputMode==="all"} aria-label="指、画面用ペン、マウスで書く。拡大はボタンを使用">指も使う</button></div>
          </div>
          <div className="history">
            <div className="zoom-controls" role="group" aria-label="キャンバスの拡大率"><button onClick={()=>zoomCanvasTo(canvasZoomRef.current-CANVAS_ZOOM_STEP)} disabled={canvasZoom<=MIN_CANVAS_ZOOM} aria-label="キャンバスを縮小">−</button><button className="zoom-value" onClick={()=>zoomCanvasTo(1)} aria-label="キャンバスを100パーセントに戻す">{Math.round(canvasZoom*100)}%</button><button onClick={()=>zoomCanvasTo(canvasZoomRef.current+CANVAS_ZOOM_STEP)} disabled={canvasZoom>=MAX_CANVAS_ZOOM} aria-label="キャンバスを拡大">＋</button></div>
            <button aria-label="元に戻す" title="元に戻す" onClick={undo} disabled={!undoStack.length}>↶</button><button aria-label="やり直す" title="やり直す" onClick={redo} disabled={!redoStack.length}>↷</button><button onClick={clearCanvas}>全消去</button><button className="save-note" onClick={() => void prepareImage()} disabled={!ready || preparingImage}>画像保存</button>
          </div>
        </div>
        <div className="canvas-wrap" ref={canvasWrapRef} onScroll={onCanvasScroll}>
          <div className="canvas-stage" ref={canvasStageRef}><canvas className={`${inputMode==="all"?"finger-input":"stylus-input"} ${panMode?"pan-input":""}`} ref={canvasRef} onPointerDown={drawStart} onPointerMove={drawMove} onPointerUp={drawEnd} onPointerCancel={drawEnd} aria-label="手書きメモ用キャンバス"/></div>
        </div>
      </div></div>
      {noteError && <p className="note-message" role="alert">{noteError}</p>}
      {imageError && <p className="note-message" role="status">{imageError}</p>}
      {imageFile && <NoteImageDialog file={imageFile} close={() => setImageFile(null)} />}
    </section>
  </div>;
}
