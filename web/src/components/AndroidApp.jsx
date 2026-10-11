import { useEffect, useState } from 'react';
import { Smartphone, BatteryCharging, Bell, Server, Download, FileText } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { postBlockReason, formatSize, toFa } from '../util';
import { isAndroidApp, isAndroidBrowser, appInfo, setBackgroundConnection, openBatterySettings, openNotificationSettings, changeServer } from '../native';
import { Modal } from './Modals';
import Avatar from './Avatar';

// ---------- "Share to AmoreChat" from the gallery or another app: pick the chat ----------
export function ShareTarget({ files, text, onClose }) {
  const me = useStore((s) => s.me);
  const chats = useStore((s) => s.chats);
  const [q, setQ] = useState('');
  const list = Object.values(chats)
    .filter((c) => !postBlockReason(me, c))
    .filter((c) => !q.trim() || c.title.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (a.type === 'saved' ? -1 : b.type === 'saved' ? 1 : (b.lastMessage?.id || 0) - (a.lastMessage?.id || 0)));

  const pick = (c) => {
    useStore.setState({ pendingShare: { chatId: c.id, files, text } });
    onClose();
    location.hash = `#/chat/${c.id}`;
  };

  return (
    <Modal title="ارسال به…" onClose={onClose}>
      <div className="share-preview">
        {files.map((f, i) => (
          <span key={i} className="share-file">
            <FileText size={16} /> {f.name} <small>{formatSize(f.size)}</small>
          </span>
        ))}
        {!files.length && text && <span className="share-file">{text.slice(0, 120)}</span>}
        {files.length > 1 && <p className="hint">فعلاً فقط فایل اول ارسال می‌شود.</p>}
      </div>
      <input placeholder="جستجوی گفتگو" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="user-list">
        {list.map((c) => (
          <li key={c.id}>
            <button className="row-item" onClick={() => pick(c)}>
              <Avatar id={c.id} name={c.title} file={c.avatar} saved={c.type === 'saved'} size={36} />
              <span className="grow">{c.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

// ---------- Profile section ----------
export function AndroidSettings() {
  const [info, setInfo] = useState(() => appInfo());
  const [server, setServer] = useState(null);
  const refresh = () => setInfo(appInfo());

  useEffect(() => {
    api('GET', '/app/android')
      .then((r) => setServer(r.apk))
      .catch(() => {});
    // Coming back from the system settings screens.
    const onVis = () => !document.hidden && refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  if (isAndroidBrowser) {
    return (
      <>
        <h4>اپ اندروید</h4>
        <a className="btn wide" href="/app">
          <Smartphone size={17} /> دانلود اپ اندروید (اعلان بدون نیاز به گوگل)
        </a>
      </>
    );
  }
  if (!isAndroidApp || !info) return null;
  const outdated = server && server.versionCode > info.versionCode;

  return (
    <>
      <h4>اپ اندروید</h4>
      {outdated && (
        <a className="btn primary wide" href="/app/amorechat.apk">
          <Download size={17} /> نسخه جدید اپ ({server.version}) — دانلود و نصب
        </a>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={info.background}
          onChange={(e) => {
            setBackgroundConnection(e.target.checked);
            setTimeout(refresh, 300);
          }}
        />
        اتصال پس‌زمینه برای اعلان پیام و تماس وقتی برنامه بسته است (بدون سرویس گوگل؛ کمی باتری مصرف می‌کند)
      </label>
      {!info.notifications && (
        <button className="btn wide" onClick={openNotificationSettings}>
          <Bell size={17} /> اعلان‌ها خاموش است؛ روشن کنید
        </button>
      )}
      {info.background && !info.batteryUnrestricted && (
        <button className="btn wide" onClick={openBatterySettings}>
          <BatteryCharging size={17} /> برای اعلان مطمئن: محدودیت باتری را برای اپ بردارید
        </button>
      )}
      <button className="btn wide" onClick={() => confirm('از این سرور خارج شوید و آدرس دیگری وارد کنید؟') && changeServer()}>
        <Server size={17} /> تغییر سرور
      </button>
      <p className="muted tiny" dir="ltr">
        Android app v{info.version} · {info.server}
      </p>
    </>
  );
}

// Small hint on the sidebar of phones using the browser.
export function useAndroidVersionToast() {
  useEffect(() => {
    if (!isAndroidApp) return;
    const info = appInfo();
    api('GET', '/app/android')
      .then((r) => {
        if (r.apk && info && r.apk.versionCode > info.versionCode) {
          useStore.getState().showToast(`نسخه جدید اپ اندروید (${toFa(r.apk.version)}) آماده است؛ از پروفایل نصب کنید`);
        }
      })
      .catch(() => {});
  }, []);
}
