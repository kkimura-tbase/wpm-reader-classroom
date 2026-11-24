import { useEffect, useRef, useState } from "react";

export default function NoteImageDialog({ file, close }: { file: File; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const shareData = { files: [file] };
  const canShare = typeof navigator.share === "function" && !!navigator.canShare?.(shareData);

  useEffect(() => {
    const imageUrl = URL.createObjectURL(file);
    setUrl(imageUrl);
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      URL.revokeObjectURL(imageUrl);
    };
  }, [file]);

  async function saveToPhotos() {
    try {
      setMessage("");
      // Invoke sharing from this button's tap so Safari grants user activation.
      await navigator.share(shareData);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("画像を長押しして、写真に保存してください。");
    }
  }

  return <dialog ref={dialog} className="note-image-dialog" aria-label="手書きメモの画像保存" onCancel={close}>
    <header><h2>メモ画像</h2><button type="button" onClick={close} aria-label="閉じる">×</button></header>
    {url && <>
      <img src={url} alt="手書きメモの保存用画像" />
      <div className="note-image-actions">
        {canShare && <button type="button" className="primary" onClick={() => void saveToPhotos()}>写真に保存</button>}
        <a href={url} download={file.name}>PNGをダウンロード</a>
      </div>
      <p>{message || (canShare ? "共有メニューで「画像を保存」を選びます。" : "iPadでは、画像を長押しして写真に保存できます。")}</p>
    </>}
  </dialog>;
}
