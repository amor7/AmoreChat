import { useEffect, useRef, useState } from 'react';
import { api, upload } from '../api';
import { useStore } from '../store';
import { emitTyping } from '../socket';
import { postBlockReason, messagePreview, compressImage, imageSize, formatSize, toFa } from '../util';

const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export default function Composer({ chat, droppedFile, onDroppedHandled }) {
  const me = useStore((s) => s.me);
  const replyTo = useStore((s) => s.replyTo);
  const editing = useStore((s) => s.editing);
  const showToast = useStore((s) => s.showToast);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (editing) {
      setText(editing.text);
      inputRef.current?.focus();
    }
  }, [editing]);
  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);
  useEffect(() => {
    if (droppedFile) {
      setPending(droppedFile);
      onDroppedHandled();
    }
  }, [droppedFile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-grow the textarea.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [text]);

  const blocked = postBlockReason(me, chat);
  if (blocked) return <div className="composer blocked">{blocked}</div>;

  async function send() {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      if (editing) {
        const { message } = await api('PATCH', `/messages/${editing.id}`, { text: t });
        useStore.getState().updateMessage(message);
      } else {
        const { message } = await api('POST', `/chats/${chat.id}/messages`, { text: t, replyTo: replyTo?.id });
        useStore.getState().addMessage(message);
      }
      setText('');
      useStore.setState({ replyTo: null, editing: null });
    } catch (e) {
      showToast(e.message);
    }
    setBusy(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
      e.preventDefault();
      send();
    }
    if (e.key === 'Escape') {
      useStore.setState({ replyTo: null, editing: null });
      if (editing) setText('');
    }
  }

  function onPaste(e) {
    const f = [...(e.clipboardData?.files || [])][0];
    if (f) {
      e.preventDefault();
      setPending(f);
    }
  }

  const bar = editing || replyTo;
  return (
    <div className="composer-wrap">
      {bar && (
        <div className="composer-bar">
          <span className="bar-icon">{editing ? '✏️' : '↩️'}</span>
          <span className="bar-body">
            <b>{editing ? 'ویرایش پیام' : `پاسخ به ${replyTo.sender?.displayName || ''}`}</b>
            <span className="preview">{messagePreview(bar)}</span>
          </span>
          <button
            className="icon-btn"
            aria-label="لغو"
            onClick={() => {
              useStore.setState({ replyTo: null, editing: null });
              if (editing) setText('');
            }}
          >
            ✕
          </button>
        </div>
      )}
      <div className="composer">
        {!editing && (
          <button className="icon-btn" aria-label="پیوست" onClick={() => fileRef.current.click()}>
            📎
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => {
            if (e.target.files[0]) setPending(e.target.files[0]);
            e.target.value = '';
          }}
        />
        <textarea
          ref={inputRef}
          rows={1}
          dir="auto"
          placeholder="پیام…"
          value={text}
          maxLength={4000}
          onChange={(e) => {
            setText(e.target.value);
            if (!editing) emitTyping(chat.id);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <button className="send-btn" aria-label="ارسال" disabled={!text.trim() || busy} onClick={send}>
          ➤
        </button>
      </div>
      {pending && <SendFileDialog file={pending} chat={chat} onClose={() => setPending(null)} />}
    </div>
  );
}

function SendFileDialog({ file, chat, onClose }) {
  const replyTo = useStore((s) => s.replyTo);
  const isImage = /^image\/(jpeg|png|webp|gif|avif)$/.test(file.type);
  const isVideo = file.type.startsWith('video/');
  const [compress, setCompress] = useState(true);
  const [caption, setCaption] = useState('');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [preview] = useState(() => (isImage || isVideo ? URL.createObjectURL(file) : null));

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  async function send() {
    setError('');
    setProgress(0);
    try {
      let blob = file;
      let meta = {};
      let type = 'file';
      if (isImage && compress) {
        const c = await compressImage(file);
        blob = c.blob;
        meta = { w: c.width, h: c.height };
        type = 'image';
      } else if (isImage) {
        meta = await imageSize(file);
        meta = { w: meta.width, h: meta.height };
      } else if (isVideo) {
        type = 'video';
      }
      const name = isImage && compress ? file.name.replace(/\.\w+$/, '') + '.jpg' : file.name;
      const uploaded = await upload(blob, { name, meta, onProgress: setProgress });
      const { message } = await api('POST', `/chats/${chat.id}/messages`, {
        fileId: uploaded.id,
        type,
        text: caption.trim(),
        replyTo: replyTo?.id,
      });
      useStore.getState().addMessage(message);
      useStore.setState({ replyTo: null });
      onClose();
    } catch (e) {
      setError(e.message);
      setProgress(null);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => progress === null && onClose()}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <h3>ارسال {isImage ? 'عکس' : isVideo ? 'ویدیو' : 'فایل'}</h3>
        {isImage && <img className="send-preview" src={preview} alt="" />}
        {isVideo && <video className="send-preview" src={preview} controls muted playsInline />}
        {!isImage && !isVideo && (
          <div className="file-card">
            <span className="file-icon">📄</span>
            <span>
              <span className="file-name">{file.name}</span>
              <small>{formatSize(file.size)}</small>
            </span>
          </div>
        )}
        {isImage && (
          <div className="segmented">
            <button className={compress ? 'active' : ''} onClick={() => setCompress(true)}>
              فشرده (کم‌حجم)
            </button>
            <button className={!compress ? 'active' : ''} onClick={() => setCompress(false)}>
              کیفیت اصلی ({formatSize(file.size)})
            </button>
          </div>
        )}
        {isVideo && <p className="hint">حجم: {formatSize(file.size)} — انتخاب کیفیت ویدیو در نسخه بعد اضافه می‌شود.</p>}
        <input placeholder="توضیح (اختیاری)" value={caption} onChange={(e) => setCaption(e.target.value)} dir="auto" maxLength={4000} />
        {progress !== null && (
          <div className="progress">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
            <span>{toFa(Math.round(progress * 100))}٪</span>
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button className="btn" onClick={onClose} disabled={progress !== null}>
            انصراف
          </button>
          <button className="btn primary" onClick={send} disabled={progress !== null}>
            ارسال
          </button>
        </div>
      </div>
    </div>
  );
}
