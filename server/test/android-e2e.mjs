// Android app end-to-end test on an emulator (run by .github/workflows/android.yml).
// Needs: adb with a booted emulator, the debug APK, and an AmoreChat server on the host at
// port 3100 with an empty data dir (the emulator reaches the host as 10.0.2.2).
// Usage: node test/android-e2e.mjs <setupCode> <path-to-debug.apk>
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const SETUP = process.argv[2];
const APK = process.argv[3];
const HOST = 'http://127.0.0.1:3100';
const PKG = 'chat.amore.app.debug';
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const adb = (cmd) => execSync(`adb ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const step = (s) => console.log(`\n▶ ${s}`);
let shot = 0;
const screenshot = (name) => execSync(`adb exec-out screencap -p > android-${++shot}-${name}.png`);

async function waitUntil(fn, what, timeout = 30000) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* retry */
    }
    if (Date.now() > end) {
      try {
        screenshot('fail');
      } catch {
        /* ignore */
      }
      throw new Error(`timed out: ${what}`);
    }
    await sleep(500);
  }
}

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(HOST + url, {
      method,
      headers: { 'x-requested-with': 'amorechat', ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body && JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
  };
}

// Minimal Chrome DevTools Protocol client for the app's WebView (debug builds enable it).
async function devtools() {
  const sock = await waitUntil(() => adb('shell cat /proc/net/unix').match(/@(webview_devtools_remote_\d+)/)?.[1], 'WebView devtools socket');
  adb(`forward tcp:9333 localabstract:${sock}`);
  // The visible page (an activity recreated by Android leaves an old, hidden one behind).
  const ws = await waitUntil(async () => {
    const pages = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).filter((t) => t.type === 'page' && t.url.startsWith('http'));
    for (const p of pages.reverse()) {
      const attached = JSON.parse(p.description || '{}');
      if (attached.attached === false || attached.visible === false) continue;
      const w = new WebSocket(p.webSocketDebuggerUrl);
      await new Promise((ok, bad) => ((w.onopen = ok), (w.onerror = bad)));
      return w;
    }
    return null;
  }, 'visible WebView page');
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) {
      waiting.get(d.id)(d);
      waiting.delete(d.id);
    }
  };
  const evaluate = (expression) =>
    new Promise((ok, bad) => {
      const n = ++id;
      // A page that's reloading may never answer: give up after a while so callers retry.
      const t = setTimeout(() => (waiting.delete(n), bad(new Error('devtools timeout'))), 8000);
      waiting.set(n, (d) => {
        clearTimeout(t);
        if (d.result?.exceptionDetails) bad(new Error(d.result.exceptionDetails.text + ' ' + JSON.stringify(d.result.exceptionDetails.exception?.description)));
        else ok(d.result?.result?.value);
      });
      ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  return { evaluate, close: () => ws.close() };
}

// Active notifications only: dumpsys also lists recently removed ones (archive / history).
const notifications = () => {
  const all = adb('shell dumpsys notification --noredact');
  const cut = all.search(/\n\s*(mArchive|Archive|Notification History|mHistory)/i);
  return cut > 0 ? all.slice(0, cut) : all;
};

// ---------- Accounts ----------
const owner = client();
const bob = client();
let r = await owner('POST', '/api/auth/register', { username: 'owner', password: 'Str0ng-Pass-77', displayName: 'Owner', invite: SETUP });
assert.equal(r.status, 200, JSON.stringify(r));
r = await owner('POST', '/api/admin/invites', { maxUses: 1 });
r = await bob('POST', '/api/auth/register', { username: 'bob', password: 'Str0ng-Pass-77', displayName: 'Bob', invite: r.invite.code });
const bobId = r.user.id;
const dm = (await owner('POST', '/api/chats/dm', { userId: bobId })).chat.id;

try {
  step('install and open the app pointed at the test server');
  adb(`install -r -g ${APK}`);
  adb(`shell pm grant ${PKG} android.permission.POST_NOTIFICATIONS`);
  adb(`shell am start -n ${PKG}/chat.amore.app.MainActivity --es server http://10.0.2.2:3100`);
  let dt = await devtools();
  await waitUntil(() => dt.evaluate("!!document.querySelector('.auth-card')"), 'login screen inside the app');
  assert.equal(await dt.evaluate('typeof window.AmoreAndroid'), 'object', 'native bridge available');
  screenshot('login');

  step('sign in (as bob) through the page');
  await dt.evaluate(`fetch('/api/auth/login', { method: 'POST', headers: { 'x-requested-with': 'amorechat', 'content-type': 'application/json' }, body: JSON.stringify({ username: 'bob', password: 'Str0ng-Pass-77' }) }).then((r) => r.status)`);
  await dt.evaluate('location.reload(), true');
  dt.close();
  dt = await devtools();
  await waitUntil(() => dt.evaluate("!!document.querySelector('.sidebar .chat-item')"), 'chat list loaded');
  const info = JSON.parse(await dt.evaluate('AmoreAndroid.info()'));
  console.log('app info', info);
  assert.equal(info.background, true);
  assert.equal(info.server, 'http://10.0.2.2:3100');
  assert.ok(await dt.evaluate("document.documentElement.classList.contains('android-app')"));
  const pages = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).filter((t) => t.type === 'page');
  console.log('webview pages:', pages.map((p) => `${p.url} ${p.description}`));
  assert.equal(pages.length, 1, 'exactly one WebView page');
  await sleep(3000); // software-rendered emulator: let it paint
  assert.equal(await dt.evaluate("!!document.querySelector('.splash')"), false, 'not stuck on the loading screen');
  // Regression: the long "new login" preview used to make the chat list wider than the phone.
  assert.equal(await dt.evaluate("document.querySelector('.sidebar').getBoundingClientRect().width <= innerWidth + 1"), true, 'chat list fits the screen');
  screenshot('chats');

  step('background connection: the service is running');
  await waitUntil(() => /NotifyService/.test(adb(`shell dumpsys activity services ${PKG}`)), 'NotifyService running');
  await waitUntil(() => notifications().includes('متصل'), '"connected" status notification');

  step('app in the background: a new message shows a system notification');
  adb('shell input keyevent KEYCODE_HOME');
  await sleep(1500);
  await owner('POST', `/api/chats/${dm}/messages`, { text: 'پیام آزمایشی از اپ' });
  await waitUntil(() => notifications().includes('پیام آزمایشی از اپ'), 'message notification posted');
  screenshot('message-notification');

  step('incoming call rings with a full-screen call notification; ends when cancelled');
  r = await owner('POST', '/api/calls', { userId: bobId, video: false });
  assert.equal(r.status, 200, JSON.stringify(r));
  await waitUntil(() => notifications().includes('تماس صوتی ورودی'), 'call notification posted');
  screenshot('call-notification');
  await owner('POST', `/api/calls/${r.call.id}/end`);
  await waitUntil(() => !notifications().includes('تماس صوتی ورودی'), 'call notification removed');

  step('opening the app clears message notifications');
  adb(`shell am start -n ${PKG}/chat.amore.app.MainActivity`);
  await waitUntil(() => !notifications().includes('پیام آزمایشی از اپ'), 'notification cleared');

  step('reboot-free restart: service survives the activity being closed');
  adb(`shell am force-stop ${PKG}`);
  adb(`shell am start -n ${PKG}/chat.amore.app.MainActivity`);
  await waitUntil(() => /NotifyService/.test(adb(`shell dumpsys activity services ${PKG}`)), 'service restarted with the app');

  console.log('\nANDROID E2E TEST PASSED');
} catch (e) {
  console.error(e);
  try {
    // Section headers of dumpsys, to see where things are listed
    const lines = adb('shell dumpsys notification --noredact').split('\n');
    console.log(lines.filter((l) => /^ {0,4}\S/.test(l)).slice(0, 80).join('\n'));
  } catch {
    /* ignore */
  }
  try {
    console.log(adb('logcat -d -t 300 AndroidRuntime:E chromium:W *:S'));
  } catch {
    /* ignore */
  }
  process.exit(1);
}
process.exit(0);
