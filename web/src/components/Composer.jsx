import { useEffect, useRef, useState } from 'react';
import { api, upload } from '../api';
import { useStore } from '../store';
import { emitTyping } from '../socket';
import { postBlockReason, messagePreview, compressImage, imageSize, formatSize, formatClock, toFa, computeWaveform } from '../util';

const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export default function Composer({ chat, droppedFile, onDroppedHandled }) {
  const me = useStore((s) => s.me);
  const replyTo = useStore((s) => s.replyTo);
  const editing = useStore((s) => s.editing);
  const showToast = useStore((s) => s.showToast);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [recording, setRecording] = useState(false);
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
    el.style.overflowY = el.scrollHeight > 160 ? 'auto' : 'hidden';
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
        {text.trim() || editing ? (
          <button className="send-btn" aria-label="ارسال" disabled={!text.trim() || busy} onClick={send}>
            ➤
          </button>
        ) : (
          <button className="send-btn mic" aria-label="ضبط پیام صوتی" onClick={() => setRecording(true)}>
            🎤
          </button>
        )}
      </div>
      {recording && <VoiceRecorder chat={chat} onDone={() => setRecording(false)} />}
      {pending && <SendFileDialog file={pending} chat={chat} onClose={() => setPending(null)} />}
    </div>
  );
}

function pickAudioMime() {
  const options = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];
  return options.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}

const MAX_VOICE_SECONDS = 15 * 60;

function VoiceRecorder({ chat, onDone }) {
  const replyTo = useStore((s) => s.replyTo);
  const showToast = useStore((s) => s.showToast);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [sending, setSending] = useState(false);
  const rec = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let stream;
    let timer;
    let raf;
    let audioCtx;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('ضبط صدا فقط روی HTTPS ممکن است');
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const mimeType = pickAudioMime();
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
        const chunks = [];
        recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        rec.current = { recorder, chunks, stream };
        recorder.start(250);
        const start = Date.now();
        timer = setInterval(() => {
          const s = Math.floor((Date.now() - start) / 1000);
          setSeconds(s);
          if (s >= MAX_VOICE_SECONDS) finish(true);
        }, 250);
        // Live input level meter.
        audioCtx = new AudioContext();
        const analyser = audioCtx.createAnalyser();
        audioCtx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let max = 0;
          for (const v of buf) max = Math.max(max, Math.abs(v - 128));
          setLevel(max / 128);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        showToast(e.name === 'NotAllowedError' ? 'اجازه دسترسی به میکروفون داده نشد' : e.message);
        onDone();
      }
    })();
    return () => {
      cancelled = true;
      clearInterval(timer);
      cancelAnimationFrame(raf);
      audioCtx?.close();
      rec.current?.stream.getTracks().forEach((t) => t.stop());
      if (rec.current?.recorder.state === 'recording') rec.current.recorder.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function finish(send) {
    const r = rec.current;
    if (!r) return onDone();
    if (!send) {
      r.recorder.stop();
      return onDone();
    }
    setSending(true);
    await new Promise((ok) => {
      r.recorder.onstop = ok;
      r.recorder.stop();
    });
    r.stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(r.chunks, { type: r.recorder.mimeType || 'audio/webm' });
    if (blob.size < 1000) {
      onDone();
      return;
    }
    try {
      const { waveform, duration } = await computeWaveform(blob);
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      const file = await upload(blob, { name: `voice.${ext}`, meta: { voice: 1, wave: waveform, dur: duration?.toFixed(2) } });
      const { message } = await api('POST', `/chats/${chat.id}/messages`, { fileId: file.id, type: 'voice', replyTo: replyTo?.id });
      useStore.getState().addMessage(message);
      useStore.setState({ replyTo: null });
    } catch (e) {
      showToast(e.message);
    }
    onDone();
  }

  return (
    <div className="recorder">
      <button className="btn danger" onClick={() => finish(false)} disabled={sending}>
        لغو
      </button>
      <div className="rec-status">
        <span className="rec-dot" style={{ transform: `scale(${1 + level * 1.5})` }} />
        <span>{sending ? 'در حال ارسال…' : formatClock(seconds)}</span>
      </div>
      <button className="send-btn" aria-label="ارسال پیام صوتی" onClick={() => finish(true)} disabled={sending}>
        ➤
      </button>
    </div>
  );
}

function SendFileDialog({ file, chat, onClose }) {
  const replyTo = useStore((s) => s.replyTo);
  const isImage = /^image\/(jpeg|png|webp|gif|avif)$/.test(file.type);
  const isVideo = file.type.startsWith('video/');
  const [compress, setCompress] = useState(true);
  const videoProcessing = useStore((s) => s.config.videoProcessing);
  const [videoQ, setVideoQ] = useState(() => (useStore.getState().prefs.dataSaver ? '360' : '720'));
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
        meta = { q: videoQ };
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
        {isVideo && videoProcessing && (
          <>
            <div className="segmented">
              {[
                ['360', 'کم‌حجم (360p)'],
                ['720', 'متوسط (720p)'],
                ['original', 'اصلی'],
              ].map(([q, label]) => (
                <button key={q} className={videoQ === q ? 'active' : ''} onClick={() => setVideoQ(q)}>
                  {label}
                </button>
              ))}
            </div>
            <p className="hint">
              حجم فایل: {formatSize(file.size)}. سرور نسخه‌های کم‌حجم‌تر را می‌سازد تا گیرنده هم بتواند کیفیت را انتخاب کند.
              {videoQ !== 'original' && ' نسخه اصلی نگه داشته نمی‌شود.'}
            </p>
          </>
        )}
        {isVideo && !videoProcessing && <p className="hint">حجم: {formatSize(file.size)}</p>}
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
