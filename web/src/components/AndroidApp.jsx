import { useEffect, useState } from 'react';
import { Smartphone, BatteryCharging, Bell, Server, Download, FileText, PhoneCall, Wifi, WifiOff, Lock, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useStore } from '../store';
import { postBlockReason, formatSize, toFa } from '../util';
import { isAndroidApp, isAndroidBrowser, appInfo, setBackgroundConnection, openBatterySettings, openNotificationSettings, openFullScreenSettings, changeServer, installAppUpdate, multiServer, appServers, addServer, removeServer, appLockSupported, appLockOn, setAppLock } from '../native';
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
  useStore((s) => s.nativeTick);
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
    const t = setInterval(refresh, 3000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(t);
    };
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
        <button className="btn primary wide" onClick={installAppUpdate}>
          <Download size={17} /> نسخه جدید اپ ({server.version}) — دانلود و نصب
        </button>
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
      {info.background && (
        <p className={`app-status ${info.connected ? 'ok' : 'bad'}`}>
          {info.connected ? <Wifi size={16} /> : <WifiOff size={16} />} اتصال اعلان‌ها: {info.status}
        </p>
      )}
      {info.fullScreen === false && (
        <button className="btn wide" onClick={openFullScreenSettings}>
          <PhoneCall size={17} /> اجازه نمایش تماس ورودی روی صفحه را بدهید
        </button>
      )}
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
      {appLockSupported && (
        <label className="check">
          <input type="checkbox" checked={appLockOn()} onChange={(e) => setAppLock(e.target.checked)} />
          <Lock size={15} /> قفل برنامه با اثر انگشت / چهره / رمز گوشی (بعد از ۱ دقیقه بیرون بودن؛ محتوا در لیست برنامه‌های اخیر هم پنهان می‌شود)
        </label>
      )}
      {multiServer ? (
        <>
          <h5>سرورها</h5>
          <p className="muted tiny">روی چند سرور AmoreChat هم‌زمان وارد باشید؛ پیام و تماس همه می‌آید. جابه‌جایی از منوی بالای لیست گفتگوها.</p>
          <ul className="server-list">
            {appServers().map((s) => (
              <li key={s.url}>
                <Server size={16} />
                <span className="grow" dir="ltr">
                  {s.name}
                </span>
                <small className={s.connected ? 'ok' : 'bad'}>{s.connected ? 'متصل' : s.status || '…'}</small>
                <button className="icon-btn" aria-label="حذف" onClick={() => confirm(`از «${s.name}» در این گوشی خارج شوید؟`) && removeServer(s.url)}>
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
          <button className="btn wide" onClick={addServer}>
            <Plus size={17} /> افزودن سرور دیگر
          </button>
        </>
      ) : (
        <button className="btn wide" onClick={() => confirm('از این سرور خارج شوید و آدرس دیگری وارد کنید؟') && changeServer()}>
          <Server size={17} /> تغییر سرور
        </button>
      )}
      <p className="muted tiny">
        اگر بعد از بستن برنامه اعلان نمی‌آید: در تنظیمات گوشی برای AmoreChat «اجرای خودکار / Autostart» را روشن و محدودیت باتری را «بدون محدودیت» کنید (مخصوصاً شیائومی، سامسونگ و هوآوی). «توقف اجباری» (Force stop) برنامه را تا باز کردن دوباره کاملاً متوقف می‌کند.
      </p>
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
