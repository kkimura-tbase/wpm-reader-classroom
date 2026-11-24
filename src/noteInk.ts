export type InkPoint = { x: number; y: number };
export type InkBounds = { left: number; top: number; right: number; bottom: number };
export type InkStroke = {
  color: string;
  size: number;
  eraser: boolean;
  points: InkPoint[];
  bounds: InkBounds;
};
export type NoteDocument = {
  strokes: InkStroke[];
  legacy: { source: string; width: number } | null;
};
export const EMPTY_NOTE: NoteDocument = { strokes: [], legacy: null };

export function startStroke(point: InkPoint, color: string, size: number, eraser: boolean): InkStroke {
  const radius = size / 2;
  return {
    color, size, eraser, points: [point],
    bounds: { left: point.x - radius, top: point.y - radius, right: point.x + radius, bottom: point.y + radius },
  };
}

export function extendStroke(stroke: InkStroke, points: InkPoint[]) {
  const radius = stroke.size / 2;
  for (const point of points) {
    const last = stroke.points[stroke.points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) <= 0.05) continue;
    stroke.points.push(point);
    const bounds = stroke.bounds;
    bounds.left = Math.min(bounds.left, point.x - radius);
    bounds.top = Math.min(bounds.top, point.y - radius);
    bounds.right = Math.max(bounds.right, point.x + radius);
    bounds.bottom = Math.max(bounds.bottom, point.y + radius);
  }
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: InkStroke, view: InkBounds) {
  const { bounds, points } = stroke;
  if (bounds.right < view.left || bounds.left > view.right || bounds.bottom < view.top || bounds.top > view.bottom) return;
  ctx.globalCompositeOperation = stroke.eraser ? "destination-out" : "source-over";
  ctx.beginPath();
  if (points.length === 1) {
    ctx.fillStyle = stroke.color;
    ctx.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }
}

export function paintNote(ctx: CanvasRenderingContext2D, note: NoteDocument, legacyImage: HTMLImageElement | null, view: InkBounds) {
  ctx.globalCompositeOperation = "source-over";
  if (note.legacy && legacyImage) {
    const width = note.legacy.width;
    ctx.drawImage(legacyImage, 0, 0, width, width * legacyImage.naturalHeight / legacyImage.naturalWidth);
  }
  for (const stroke of note.strokes) drawStroke(ctx, stroke, view);
}

export function encodeNoteImage(note: NoteDocument, legacyImage: HTMLImageElement | null): Promise<Blob> {
  let left = Infinity, top = Infinity, right = 0, bottom = 0;
  if (note.legacy && legacyImage) {
    left = 0; top = 0;
    right = note.legacy.width;
    bottom = right * legacyImage.naturalHeight / legacyImage.naturalWidth;
  }
  for (const { bounds, eraser } of note.strokes) {
    if (eraser) continue;
    left = Math.min(left, bounds.left);
    top = Math.min(top, bounds.top);
    right = Math.max(right, bounds.right);
    bottom = Math.max(bottom, bounds.bottom);
  }
  if (!Number.isFinite(left)) throw new Error("保存する手書きメモがありません。");
  const margin = 24;
  const width = right - left + margin * 2;
  const height = bottom - top + margin * 2;
  // Keep the export within a small enough bitmap budget for iPad Safari.
  const scale = Math.min(2, 4096 / width, 4096 / height, Math.sqrt(4_000_000 / (width * height)));
  if (Math.min(width, height) * scale < 1) throw new Error("メモが広すぎて1枚の画像にできません。");
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("このブラウザでは画像を作成できません。");
  ctx.setTransform(scale, 0, 0, scale, (margin - left) * scale, (margin - top) * scale);
  paintNote(ctx, note, legacyImage, { left, top, right, bottom });
  ctx.globalCompositeOperation = "destination-over";
  ctx.resetTransform();
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      canvas.width = canvas.height = 0;
      if (blob) resolve(blob);
      else reject(new Error("メモ画像を作成できませんでした。"));
    }, "image/png");
  });
}

let notesDatabase: Promise<IDBDatabase> | undefined;
function openNotesDatabase() {
  notesDatabase ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("reading-studio-notes", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("notes");
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        notesDatabase = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  }).catch(error => {
    notesDatabase = undefined;
    throw error;
  });
  return notesDatabase;
}

export async function loadNote(key: string): Promise<NoteDocument | undefined> {
  const db = await openNotesDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("notes").objectStore("notes").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeNote(key: string, note: NoteDocument): Promise<void> {
  const db = await openNotesDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("notes", "readwrite");
    transaction.objectStore("notes").put(note, key);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}
