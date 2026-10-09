import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import Avatar from './Avatar';

// Per-user overrides; empty = site default.
export function LimitsEditor({ u, run }) {
  const [o, setO] = useState(u.overrides || {});
  const tri = (key) => (o[key] === true ? 'yes' : o[key] === false ? 'no' : '');
  const setTri = (key, v) => setO({ ...o, [key]: v === 'yes' ? true : v === 'no' ? false : undefined });
  const num = (key) => (e) => setO({ ...o, [key]: e.target.value === '' ? undefined : Number(e.target.value) });
  const L = u.limits || {};
  const save = (body, ok) => run(() => api('PATCH', `/admin/users/${u.id}/limits`, body), ok);
  return (
    <div className="perm-box">
      <b>محدودیت‌ها و دسترسی‌های این کاربر</b>
      <small className="muted">خالی یا «پیش‌فرض سرور» یعنی همان تنظیم کلی سرور</small>
      <small>
        الان: فایل تا {L.uploadMb} مگابایت · تماس {L.canCall ? '✅' : '⛔'} · استریم {L.canStream ? `✅ تا ${L.streamQuality}p` : '⛔'}
      </small>
      <label>
        حداکثر حجم هر فایل (مگابایت)
        <input type="number" min="1" placeholder="پیش‌فرض سرور" value={o.upload_mb ?? ''} onChange={num('upload_mb')} />
      </label>
      <label>
        سهمیه کل فضا (مگابایت، ۰ = نامحدود)
        <input type="number" min="0" placeholder="پیش‌فرض" value={o.quota_mb ?? ''} onChange={num('quota_mb')} />
      </label>
      <label>
        تماس صوتی/تصویری
        <select value={tri('can_call')} onChange={(e) => setTri('can_call', e.target.value)}>
          <option value="">پیش‌فرض سرور</option>
          <option value="yes">مجاز</option>
          <option value="no">ممنوع</option>
        </select>
      </label>
      <label>
        استریم (اشتراک صفحه و دوربین)
        <select value={tri('can_stream')} onChange={(e) => setTri('can_stream', e.target.value)}>
          <option value="">پیش‌فرض سرور</option>
          <option value="yes">مجاز</option>
          <option value="no">ممنوع</option>
        </select>
      </label>
      <label>
        حداکثر کیفیت استریم
        <select value={o.stream_quality ?? ''} onChange={num('stream_quality')}>
          <option value="">پیش‌فرض</option>
          <option value="480">480p</option>
          <option value="720">720p</option>
          <option value="1080">1080p</option>
        </select>
      </label>
      <div className="actions">
        <button className="btn sm" onClick={() => save({}, 'به پیش‌فرض برگشت').then(() => setO({}))}>
          بازگشت به پیش‌فرض
        </button>
        <button className="btn primary sm" onClick={() => save(o, 'ذخیره شد')}>
          ذخیره محدودیت‌ها
        </button>
      </div>
    </div>
  );
}

// Everything happening right now: voice rooms and calls, with moderation.
export function Live() {
  const showToast = useStore((s) => s.showToast);
  const [data, setData] = useState(null);
  const alive = useRef(true);
  const load = () =>
    api('GET', '/admin/live')
      .then((d) => alive.current && setData(d))
      .catch((e) => showToast(e.message));

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (fn, ok) =>
    fn()
      .then(() => {
        showToast(ok);
        load();
      })
      .catch((e) => showToast(e.message));
  const moderate = (chatId, userId, action, ok) => act(() => api('POST', `/rtc/${chatId}/moderate`, { userId, action }), ok);

  if (!data) return <p className="muted">…</p>;
  if (!data.enabled) return <p className="muted pad">تماس و ویس‌چت روی این سرور فعال نیست (LiveKit تنظیم نشده).</p>;
  return (
    <>
      <h4>🎙 ویس‌چت‌های فعال</h4>
      {!data.rooms.length && <p className="muted">هیچ ویس‌چتی فعال نیست.</p>}
      {data.rooms.map((r) => (
        <div key={r.chatId} className="boxed">
          <div className="row-item">
            <b className="grow">{r.title}</b>
            <button
              className="btn sm danger"
              onClick={() => confirm('ویس‌چت برای همه بسته شود؟') && act(() => api('POST', '/admin/live/end', { chatId: r.chatId }), 'بسته شد')}
            >
              پایان برای همه
            </button>
          </div>
          {r.participants.map((p) => (
            <div key={p.userId} className="row-item">
              <Avatar id={p.userId} name={p.name} file={p.avatar} size={28} />
              <span className="grow">
                {p.name} {p.screen && <span className="live-badge">LIVE</span>} {p.camera && '📷'}
              </span>
              <button className="btn sm" title="بستن میکروفون" onClick={() => moderate(r.chatId, p.userId, 'mute', 'میکروفون بسته شد')}>
                🔇
              </button>
              <button className="btn sm" title="توقف استریم" onClick={() => moderate(r.chatId, p.userId, 'stop_stream', 'استریم متوقف شد')}>
                ⏹
              </button>
              <button className="btn sm danger" title="بیرون کردن" onClick={() => moderate(r.chatId, p.userId, 'kick', 'بیرون شد')}>
                🚪
              </button>
            </div>
          ))}
        </div>
      ))}
      <h4>📞 تماس‌های در جریان</h4>
      {!data.calls.length && <p className="muted">تماسی در جریان نیست.</p>}
      {data.calls.map((c) => (
        <div key={c.id} className="row-item boxed">
          <span className="grow">
            {c.video ? '🎥' : '📞'} {c.caller.displayName} ← {c.callee.displayName} · {c.state === 'ringing' ? 'در حال زنگ' : 'در حال مکالمه'}
          </span>
          <button className="btn sm danger" onClick={() => act(() => api('POST', '/admin/live/end', { callId: c.id }), 'تماس قطع شد')}>
            قطع
          </button>
        </div>
      ))}
    </>
  );
}

export function RtcSettings({ f, setF }) {
  return (
    <>
      <h4>تماس و ویس‌چت</h4>
      <p className="hint">پیش‌فرض برای همه کاربران؛ برای هر کاربر جداگانه از تب «کاربران» قابل تغییر است.</p>
      <label className="check">
        <input type="checkbox" checked={f.default_can_call === '1'} onChange={(e) => setF({ ...f, default_can_call: e.target.checked ? '1' : '0' })} />
        همه کاربران بتوانند تماس صوتی/تصویری بگیرند
      </label>
      <label className="check">
        <input type="checkbox" checked={f.default_can_stream === '1'} onChange={(e) => setF({ ...f, default_can_stream: e.target.checked ? '1' : '0' })} />
        همه کاربران بتوانند استریم کنند (اشتراک صفحه و دوربین در ویس‌چت)
      </label>
      <label>
        حداکثر کیفیت استریم
        <select value={f.max_stream_quality} onChange={(e) => setF({ ...f, max_stream_quality: e.target.value })}>
          <option value="480">480p (کم‌مصرف)</option>
          <option value="720">720p</option>
          <option value="1080">1080p (پهنای باند زیاد)</option>
        </select>
      </label>
      <label>
        حداکثر استریم همزمان در هر اتاق (۰ = نامحدود)
        <input type="number" min="0" value={f.max_streams_per_room} onChange={(e) => setF({ ...f, max_streams_per_room: e.target.value })} />
      </label>
    </>
  );
}
