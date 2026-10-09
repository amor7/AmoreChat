import { useEffect, useState } from 'react';
import { api } from './api';
import { useStore } from './store';
import { connectSocket } from './socket';
import { ensureLatest } from './update';
import { Megaphone, X } from 'lucide-react';
import { loadEmoji } from './components/Emoji';
import Auth from './components/Auth';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import Modals from './components/Modals';
import { VoiceBar, RoomView, IncomingCall, useAutoExpandCalls } from './components/Voice';

function parseHash() {
  const [, kind, value] = location.hash.match(/^#\/(\w+)\/(.+)$/) || [];
  return { kind, value };
}

export default function App() {
  const me = useStore((s) => s.me);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const config = await api('GET', '/config');
        document.title = config.siteName;
        useStore.setState({ config });
        // Server was updated but this device still runs the cached old app: update first.
        if (ensureLatest(config.version)) {
          setError('');
          setUpdating(true);
          return;
        }
        try {
          const { user } = await api('GET', '/auth/me');
          useStore.setState({ me: user });
        } catch (e) {
          if (e.status !== 401) throw e;
        }
      } catch (e) {
        setError(e.message);
      }
      setLoading(false);
    })();
  }, []);

  if (updating) return <div className="splash">در حال به‌روزرسانی برنامه به نسخه جدید…</div>;
  if (loading) return <div className="splash">در حال بارگذاری…</div>;
  if (error)
    return (
      <div className="splash">
        <p>{error}</p>
        <button className="btn" onClick={() => location.reload()}>
          تلاش دوباره
        </button>
      </div>
    );
  if (!me) return <Auth invite={parseHash().kind === 'invite' ? parseHash().value : ''} />;
  return <Main />;
}

function Main() {
  const activeChatId = useStore((s) => s.activeChatId);
  const connected = useStore((s) => s.connected);
  const [ready, setReady] = useState(false);
  useAutoExpandCalls();

  useEffect(() => {
    useStore
      .getState()
      .loadChats()
      .finally(() => setReady(true));
    connectSocket();
    loadEmoji();

    const onHash = () => {
      const { kind, value } = parseHash();
      const st = useStore.getState();
      if (kind === 'chat') {
        useStore.setState({ activeChatId: Number(value), replyTo: null, editing: null });
      } else {
        useStore.setState({ activeChatId: null });
        if (kind === 'join') st.openModal('join', { code: value });
      }
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!ready) return <div className="splash">در حال بارگذاری…</div>;

  return (
    <div className={`layout ${activeChatId ? 'has-chat' : ''}`}>
      {!connected && <div className="offline-bar">اتصال قطع است؛ در حال تلاش برای اتصال دوباره…</div>}
      <EmergencyBanner />
      <div className="voice-area">
        <VoiceBar />
      </div>
      <Sidebar />
      <main className="chat-pane">{activeChatId ? <ChatView key={activeChatId} chatId={activeChatId} /> : <Empty />}</main>
      <Modals />
      <RoomView />
      <IncomingCall />
      <Toast />
    </div>
  );
}

function Empty() {
  const siteName = useStore((s) => s.config?.siteName);
  return (
    <div className="empty-pane">
      <img src="/icon.svg" alt="" width="72" height="72" />
      <h2>{siteName}</h2>
      <p>یک گفتگو را انتخاب کنید یا گفتگوی جدیدی شروع کنید.</p>
    </div>
  );
}

function EmergencyBanner() {
  const m = useStore((s) => s.emergency);
  if (!m) return null;
  return (
    <div className="emergency-banner" role="alert">
      <button
        className="emergency-text"
        onClick={() => {
          location.hash = `#/chat/${m.chatId}`;
          useStore.setState({ emergency: null });
        }}
      >
        <Megaphone size={18} /> {m.text || 'اطلاعیه جدید'}
      </button>
      <button className="icon-btn" aria-label="بستن" onClick={() => useStore.setState({ emergency: null })}>
        <X size={18} />
      </button>
    </div>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  return toast ? <div className="toast">{toast.text}</div> : null;
}
