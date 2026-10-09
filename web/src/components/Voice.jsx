import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { hasChatPerm, toFa } from '../util';
import Avatar from './Avatar';
import CallView from './CallView';
import {
  joinVoice,
  leave,
  setMic,
  setCamera,
  flipCamera,
  startScreenShare,
  stopScreenShare,
  setDeafened,
  setPtt,
  watchStream,
  setStreamQuality,
  enableAudioPlayback,
  canShareScreen,
  acceptCall,
  declineCall,
  hangUp,
} from '../rtc';

const run = (fn) =>
  Promise.resolve()
    .then(fn)
    .catch((e) => useStore.getState().showToast(e.message));

const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

// Attaches a LiveKit video track to a <video>; detaches on unmount.
function VideoView({ pub, mirror, fit = 'contain' }) {
  const ref = useRef(null);
  const track = pub?.videoTrack;
  useEffect(() => {
    if (!track || !ref.current) return;
    track.attach(ref.current);
    return () => track.detach(ref.current);
  }, [track]);
  if (!track) return null;
  return <video ref={ref} className={`rtc-video ${mirror ? 'mirror' : ''}`} style={{ objectFit: fit }} autoPlay playsInline muted />;
}

// ---------- Sidebar: Discord-style voice channels with who's inside ----------
export function VoiceChannels() {
  const channels = useStore((s) => s.voiceChannels);
  const rtc = useStore((s) => s.rtc);
  const [open, setOpen] = useState(true);
  if (!channels.length) return null;
  return (
    <div className="voice-channels">
      <button className="list-section toggle" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} کانال‌های صوتی
      </button>
      {open &&
        channels.map((c) => (
          <div key={c.id} className={`vc ${rtc?.chatId === c.id ? 'active' : ''}`}>
            <div className="vc-row">
              <a href={`#/chat/${c.id}`} className="vc-name">
                🔊 {c.title}
              </a>
              {rtc?.chatId !== c.id && (
                <button className="btn sm" onClick={() => run(() => joinVoice(c.id))}>
                  ورود
                </button>
              )}
            </div>
            {c.participants?.map((p) => (
              <div key={p.userId} className="vc-user">
                <Avatar id={p.userId} name={p.name} file={p.avatar} size={22} />
                <span>{p.name}</span>
                {p.screen && <span className="live-badge">LIVE</span>}
                {p.camera && <span title="دوربین">📷</span>}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

// ---------- Banner inside a chat: "voice chat in progress — join" ----------
export function VoiceBanner({ chat }) {
  const config = useStore((s) => s.config);
  const participants = useStore((s) => s.voiceRooms[chat.id]) || [];
  const rtc = useStore((s) => s.rtc);
  if (!config.rtc || !['group', 'channel', 'voice'].includes(chat.type)) return null;
  const inside = rtc?.chatId === chat.id;
  if (!participants.length && chat.type !== 'voice' && !inside) return null;
  return (
    <div className={`voice-banner ${inside ? 'inside' : ''}`}>
      <div className="vb-faces">
        {participants.slice(0, 5).map((p) => (
          <Avatar key={p.userId} id={p.userId} name={p.name} file={p.avatar} size={26} />
        ))}
      </div>
      <span className="grow">
        {participants.length ? `🎙 ویس‌چت · ${toFa(participants.length)} نفر` : '🎙 کسی داخل نیست'}
        {participants.some((p) => p.screen) && <span className="live-badge">LIVE</span>}
      </span>
      {inside ? (
        <button className="btn sm" onClick={() => useStore.setState((s) => ({ rtc: { ...s.rtc, expanded: true } }))}>
          نمایش
        </button>
      ) : (
        <button className="btn primary sm" onClick={() => run(() => joinVoice(chat.id))}>
          {participants.length ? 'پیوستن' : 'شروع ویس‌چت'}
        </button>
      )}
    </div>
  );
}

// ---------- Compact bar while connected (bottom of the sidebar / top on mobile) ----------
export function VoiceBar() {
  const rtc = useStore((s) => s.rtc);
  const call = useStore((s) => s.call);
  if (!rtc || rtc.expanded) return null;
  const isCall = rtc.kind === 'call';
  const speaking = rtc.participants.filter((p) => p.speaking && !p.isLocal).map((p) => p.name);
  return (
    <div className="voice-bar">
      <button className="vbar-info" onClick={() => useStore.setState((s) => ({ rtc: { ...s.rtc, expanded: true } }))}>
        <span className={`dot ${rtc.state}`} />
        <span>
          <b>{isCall ? (call?.state === 'ringing' ? 'در حال زنگ زدن…' : 'در تماس') : 'متصل به ویس‌چت'}</b>
          <small>{speaking.length ? `🔊 ${speaking.join('، ')}` : rtc.title}</small>
        </span>
      </button>
      <Controls compact />
    </div>
  );
}

// ---------- Control buttons ----------
function Controls({ compact }) {
  const rtc = useStore((s) => s.rtc);
  const [share, setShare] = useState(false);
  if (!rtc) return null;
  const isCall = rtc.kind === 'call';
  const speak = rtc.canSpeak !== false;
  const stream = speak && rtc.canStream;
  return (
    <div className={`rtc-controls ${compact ? 'compact' : ''}`}>
      {speak && !rtc.ptt && (
        <button className={`ctl ${rtc.micOn ? '' : 'off'}`} onClick={() => run(() => setMic(!rtc.micOn))} title={rtc.micOn ? 'بستن میکروفون' : 'باز کردن میکروفون'}>
          {rtc.micOn ? '🎙' : '🔇'}
        </button>
      )}
      {speak && rtc.ptt && (
        <button
          className={`ctl ptt ${rtc.micOn ? 'on' : ''}`}
          onPointerDown={() => setMic(true)}
          onPointerUp={() => setMic(false)}
          onPointerLeave={() => rtc.micOn && setMic(false)}
          title="برای صحبت نگه دارید (یا کلید Space)"
        >
          {rtc.micOn ? '🎙' : '📻'}
        </button>
      )}
      {!compact && (
        <button className={`ctl ${rtc.deafened ? 'off' : ''}`} onClick={() => setDeafened(!rtc.deafened)} title={rtc.deafened ? 'شنیدن' : 'قطع صدا'}>
          {rtc.deafened ? '🔕' : '🎧'}
        </button>
      )}
      {!compact && (isCall || stream) && (
        <button className={`ctl ${rtc.camOn ? 'on' : ''}`} onClick={() => run(() => setCamera(!rtc.camOn))} title="دوربین">
          📷
        </button>
      )}
      {!compact && rtc.camOn && isTouch && (
        <button className="ctl" onClick={() => run(flipCamera)} title="تعویض دوربین">
          🔄
        </button>
      )}
      {!compact && stream && canShareScreen() && (
        <button className={`ctl ${rtc.screenOn ? 'on' : ''}`} onClick={() => (rtc.screenOn ? run(stopScreenShare) : setShare(true))} title="اشتراک صفحه (استریم)">
          🖥
        </button>
      )}
      {!compact && speak && !isCall && (
        <button className={`ctl ${rtc.ptt ? 'on' : ''}`} onClick={() => setPtt(!rtc.ptt)} title="حالت بی‌سیم (Push-to-talk)">
          📻
        </button>
      )}
      <button className="ctl hangup" onClick={() => run(isCall ? hangUp : leave)} title={isCall ? 'قطع تماس' : 'خروج'}>
        {isCall ? '📵' : '⏏'}
      </button>
      {share && <ShareDialog onClose={() => setShare(false)} />}
    </div>
  );
}

function ShareDialog({ onClose }) {
  const max = useStore((s) => s.rtc?.streamQuality) || 720;
  const [quality, setQuality] = useState(Math.min(max, 720));
  const [fps, setFps] = useState(30);
  const [audio, setAudio] = useState(true);
  const options = [480, 720, 1080].filter((q) => q <= max);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <h3>🖥 شروع استریم</h3>
        <p className="hint">بعد از «شروع»، مرورگر می‌پرسد چه چیزی نمایش داده شود: کل صفحه، یک پنجره یا یک تب.</p>
        <label className="form-label">کیفیت</label>
        <div className="segmented">
          {options.map((q) => (
            <button key={q} className={quality === q ? 'active' : ''} onClick={() => setQuality(q)}>
              {q}p
            </button>
          ))}
        </div>
        <label className="form-label">نرخ فریم</label>
        <div className="segmented">
          {[15, 30].map((f) => (
            <button key={f} className={fps === f ? 'active' : ''} onClick={() => setFps(f)}>
              {toFa(f)} فریم {f === 15 ? '(متن و اسلاید)' : '(بازی و ویدیو)'}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} />
          اشتراک صدای سیستم / تب
        </label>
        <div className="actions">
          <button className="btn" onClick={onClose}>
            انصراف
          </button>
          <button
            className="btn primary"
            onClick={() => {
              onClose();
              run(() => startScreenShare({ quality, fps, audio }));
            }}
          >
            شروع
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Full view: participants, cameras and streams ----------
export function RoomView() {
  const rtc = useStore((s) => s.rtc);
  const me = useStore((s) => s.me);
  const chat = useStore((s) => (rtc?.chatId ? s.chats[rtc.chatId] : null));
  const [focus, setFocus] = useState(null);
  if (!rtc?.expanded) return null;
  // 1:1 calls get their own WhatsApp-style screen.
  if (rtc.kind === 'call') return <CallView />;

  const collapse = () => useStore.setState((s) => ({ rtc: { ...s.rtc, expanded: false } }));
  const canMod = (perm) => chat && hasChatPerm(me, chat, perm);
  const streams = rtc.participants.flatMap((p) => [p.screen && { p, pub: p.screen, kind: 'screen' }, p.camera && { p, pub: p.camera, kind: 'camera' }].filter(Boolean));
  const focused = streams.find((s) => `${s.p.identity}:${s.kind}` === focus);

  return (
    <div className="room-view">
      <header className="room-head">
        <button className="icon-btn" onClick={collapse} aria-label="کوچک کردن">
          ⌄
        </button>
        <div className="grow">
          <b>{rtc.title}</b>
          <small>
            {rtc.state === 'connecting' && 'در حال اتصال…'}
            {rtc.state === 'reconnecting' && 'اتصال قطع شد؛ در حال اتصال دوباره…'}
            {rtc.state === 'connected' && `${toFa(rtc.participants.length)} نفر`}
          </small>
        </div>
        {rtc.canSpeak === false && <span className="tag">فقط شنونده</span>}
      </header>

      {!rtc.canPlayAudio && (
        <button className="btn primary audio-unlock" onClick={() => run(enableAudioPlayback)}>
          🔊 برای شنیدن صدا بزنید
        </button>
      )}

      {focused ? (
        <div className="stage">
          <StreamTile s={focused} big onClose={() => setFocus(null)} />
        </div>
      ) : (
        streams.length > 0 && (
          <div className="streams">
            {streams.map((s) => (
              <StreamTile key={`${s.p.identity}:${s.kind}`} s={s} onFocus={() => setFocus(`${s.p.identity}:${s.kind}`)} />
            ))}
          </div>
        )
      )}

      <div className="tiles">
        {rtc.participants.map((p) => (
          <ParticipantTile key={p.identity} p={p} chatId={rtc.chatId} canMute={canMod('mute_members')} canKick={canMod('ban_members')} />
        ))}
      </div>

      <footer className="room-foot">
        <Controls />
      </footer>
    </div>
  );
}

function StreamTile({ s, big, onFocus, onClose }) {
  const { p, pub, kind } = s;
  const [level, setLevel] = useState('high');
  const needsWatch = kind === 'screen' && !p.isLocal && !p.watching;
  return (
    <div className={`stream-tile ${big ? 'big' : ''}`}>
      {needsWatch ? (
        <button className="watch-btn" onClick={() => watchStream(p.identity, true)}>
          <span className="live-badge">LIVE</span>
          <b>{p.name}</b>
          <span>تماشای استریم</span>
        </button>
      ) : (
        <VideoView pub={pub} mirror={kind === 'camera' && p.isLocal} fit={kind === 'camera' && !big ? 'cover' : 'contain'} />
      )}
      <div className="stream-meta">
        <span>
          {kind === 'screen' ? '🖥' : '📷'} {p.name}
        </span>
        {!needsWatch && !p.isLocal && (
          <select
            value={level}
            onChange={(e) => {
              setLevel(e.target.value);
              setStreamQuality(pub, e.target.value);
            }}
            aria-label="کیفیت دریافت"
          >
            <option value="high">کیفیت بالا</option>
            <option value="medium">متوسط</option>
            <option value="low">کم‌مصرف</option>
          </select>
        )}
        {!needsWatch && (big ? <button onClick={onClose}>✕</button> : <button onClick={onFocus}>⛶</button>)}
        {kind === 'screen' && !p.isLocal && p.watching && <button onClick={() => watchStream(p.identity, false)}>توقف</button>}
      </div>
    </div>
  );
}

function ParticipantTile({ p, chatId, canMute, canKick }) {
  const [menu, setMenu] = useState(false);
  const mod = (action) =>
    run(async () => {
      await api('POST', `/rtc/${chatId}/moderate`, { userId: p.userId, action });
      setMenu(false);
    });
  return (
    <div className={`tile ${p.speaking ? 'speaking' : ''}`}>
      <Avatar id={p.userId} name={p.name} file={p.avatar} size={56} />
      <span className="tile-name">
        {p.name}
        {p.isLocal && ' (شما)'}
      </span>
      <span className="tile-icons">
        {!p.micOn && '🔇'}
        {p.screen && <span className="live-badge">LIVE</span>}
        {p.quality === 'poor' && <span title="اتصال ضعیف">📶</span>}
      </span>
      {!p.isLocal && (canMute || canKick) && (
        <button className="tile-more" onClick={() => setMenu(!menu)} aria-label="مدیریت">
          ⋮
        </button>
      )}
      {menu && (
        <div className="tile-menu">
          {canMute && <button onClick={() => mod('mute')}>🔇 بستن میکروفون</button>}
          {canMute && <button onClick={() => mod('stop_stream')}>⏹ توقف استریم/دوربین</button>}
          {canKick && (
            <button className="danger" onClick={() => mod('kick')}>
              🚪 بیرون کردن
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Incoming call ----------
export function IncomingCall() {
  const call = useStore((s) => s.call);
  if (!call || call.role !== 'callee' || call.state !== 'ringing') return null;
  return (
    <div className="incoming-call" role="alertdialog" aria-label="تماس ورودی">
      <Avatar id={call.peer.id} name={call.peer.displayName} file={call.peer.avatar} size={96} />
      <h2>{call.peer.displayName}</h2>
      <p>{call.video ? '🎥 تماس تصویری' : '📞 تماس صوتی'}</p>
      <div className="call-actions">
        <button className="call-btn decline" onClick={() => run(declineCall)} aria-label="رد تماس">
          📵
        </button>
        <button className="call-btn accept" onClick={() => run(acceptCall)} aria-label="پاسخ">
          {call.video ? '🎥' : '📞'}
        </button>
      </div>
    </div>
  );
}

// Shows the expanded view automatically when a call starts.
export function useAutoExpandCalls() {
  const callId = useStore((s) => s.rtc?.callId);
  useEffect(() => {
    if (callId) useStore.setState((s) => ({ rtc: s.rtc && { ...s.rtc, expanded: true } }));
  }, [callId]);
}
