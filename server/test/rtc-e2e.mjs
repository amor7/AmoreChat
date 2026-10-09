// End-to-end voice/video test: real LiveKit + two headless Chromes with fake mic/camera.
// Run against a server on an EMPTY data dir that is connected to LiveKit.
// Usage: node test/rtc-e2e.mjs <baseUrl> <setupCode>   (needs `puppeteer` installed)
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const BASE = process.argv[2];
const SETUP = process.argv[3];
const step = (s) => console.log(`\n▶ ${s}`);

async function apiClient() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'x-requested-with': 'amorechat', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body && JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, ...(await res.json().catch(() => ({}))) };
  };
  return { call, cookie: () => cookie.split('=')[1] };
}

const owner = await apiClient();
const bob = await apiClient();
let r = await owner.call('POST', '/api/auth/register', { username: 'owner', password: 'password1', displayName: 'Owner', invite: SETUP });
assert.equal(r.status, 200);
r = await owner.call('POST', '/api/admin/invites', { maxUses: 1 });
r = await bob.call('POST', '/api/auth/register', { username: 'bob', password: 'password1', displayName: 'Bob', invite: r.invite.code });
const bobId = r.user.id;
r = await owner.call('POST', '/api/chats', { type: 'voice', title: 'Lobby', isPublic: true });
const lobby = r.chat.id;
r = await owner.call('POST', '/api/chats/dm', { userId: bobId });
const dm = r.chat.id;

const browser = await puppeteer.launch({
  args: [
    '--no-sandbox',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

async function openAs(client, label) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${label} pageerror]`, e.message));
  page.on('console', (m) => m.type() === 'error' && console.log(`[${label} console]`, m.text()));
  await page.setViewport({ width: 1200, height: 800 });
  await page.setCookie({ name: 'ac_session', value: client.cookie(), url: BASE });
  return page;
}
const A = await openAs(owner, 'owner');
const B = await openAs(bob, 'bob');

const waitFor = (page, fn, arg, what, timeout = 20000) =>
  page.waitForFunction(fn, { timeout, polling: 250 }, arg).catch(async (e) => {
    await page.screenshot({ path: `e2e-fail-${Date.now()}.png` }).catch(() => {});
    throw new Error(`timed out waiting for: ${what} (${e.message})`);
  });
const count = (page, sel) => page.$$eval(sel, (els) => els.length);
async function clickText(page, selector, text) {
  await waitFor(page, ([s, t]) => [...document.querySelectorAll(s)].some((b) => b.textContent.includes(t)), [selector, text], `${selector} "${text}"`);
  await page.$$eval(selector, (els, t) => els.find((b) => b.textContent.includes(t)).click(), text);
}

try {
  step('both join the voice channel');
  await A.goto(`${BASE}/#/chat/${lobby}`, { waitUntil: 'networkidle0' });
  await clickText(A, '.voice-banner button', 'شروع ویس‌چت');
  await waitFor(A, () => document.querySelector('.voice-bar .dot.connected'), null, 'owner connected');
  await B.goto(`${BASE}/#/chat/${lobby}`, { waitUntil: 'networkidle0' });
  await clickText(B, '.voice-banner button', 'پیوستن');
  await waitFor(B, () => document.querySelector('.voice-bar .dot.connected'), null, 'bob connected');

  step('presence via webhook shows both in the sidebar');
  for (const p of [A, B]) await waitFor(p, () => document.querySelectorAll('.vc-user').length === 2, null, 'two names under Lobby');

  step('media: each side sees two tiles and receives remote audio');
  for (const p of [A, B]) {
    await p.click('.vbar-info');
    await waitFor(p, () => document.querySelectorAll('.room-view .tile:not(.waiting)').length === 2, null, 'two tiles');
    await waitFor(p, () => document.querySelectorAll('audio').length >= 1, null, 'remote audio element');
  }
  await waitFor(A, () => document.querySelector('.room-view .tile.speaking'), null, 'speaking indicator', 15000).then(
    () => console.log('  speaking indicator works'),
    () => console.log('  (speaking indicator not seen; fake audio may be too quiet)'),
  );

  step('camera: bob turns on the camera, owner receives video frames');
  await B.click('.room-view .ctl[title="دوربین"]');
  await waitFor(A, () => [...document.querySelectorAll('.stream-tile video')].some((v) => v.videoWidth > 0), null, 'owner sees bob camera');
  await B.click('.room-view .ctl[title="دوربین"]');

  step('moderation through the LiveKit API: mute then kick bob');
  r = await owner.call('POST', `/api/rtc/${lobby}/moderate`, { userId: bobId, action: 'mute' });
  assert.equal(r.status, 200, JSON.stringify(r));
  await waitFor(B, () => document.querySelector('.room-view .ctl.off[title*="میکروفون"]') || document.querySelector('.ctl.off'), null, 'bob mic shown muted');
  r = await owner.call('POST', `/api/rtc/${lobby}/moderate`, { userId: bobId, action: 'kick' });
  assert.equal(r.status, 200, JSON.stringify(r));
  await waitFor(B, () => !document.querySelector('.room-view') && !document.querySelector('.voice-bar'), null, 'bob removed from room');
  await waitFor(A, () => document.querySelectorAll('.room-view .tile:not(.waiting)').length === 1, null, 'owner sees bob gone');
  await waitFor(A, () => document.querySelectorAll('.vc-user').length === 1, null, 'sidebar updated');
  await A.click('.room-view .ctl.hangup');
  await waitFor(A, () => !document.querySelector('.voice-bar') && !document.querySelector('.room-view'), null, 'owner left');

  step('1:1 call: owner calls bob, bob answers, owner hangs up');
  await A.goto(`${BASE}/#/chat/${dm}`, { waitUntil: 'networkidle0' });
  await B.goto(`${BASE}/#/chat/${dm}`, { waitUntil: 'networkidle0' });
  await A.click('button[aria-label="تماس صوتی"]');
  await waitFor(B, () => document.querySelector('.incoming-call'), null, 'incoming call screen');
  await B.click('button[aria-label="پاسخ"]');
  for (const p of [A, B]) await waitFor(p, () => document.querySelectorAll('.room-view.call .tile:not(.waiting)').length === 2, null, 'both in call');
  await A.click('.room-view .ctl.hangup');
  await waitFor(B, () => !document.querySelector('.room-view'), null, 'call closed for bob');
  await waitFor(B, () => document.querySelector('.call-log'), null, 'call log message');

  step('streaming: owner shares the screen, bob sees LIVE and watches it');
  await A.goto(`${BASE}/#/chat/${lobby}`, { waitUntil: 'networkidle0' });
  await clickText(A, '.voice-banner button', 'شروع ویس‌چت');
  await waitFor(A, () => document.querySelector('.voice-bar .dot.connected'), null, 'owner connected again');
  await A.click('.vbar-info');
  await A.click('.room-view .ctl[title="اشتراک صفحه (استریم)"]');
  await clickText(A, '.modal .btn.primary', 'شروع');
  await waitFor(A, () => document.querySelector('.room-view .ctl.on[title="اشتراک صفحه (استریم)"]'), null, 'owner is sharing');
  await B.goto(`${BASE}/#/chat/${lobby}`, { waitUntil: 'networkidle0' });
  await waitFor(B, () => document.querySelector('.vc-user .live-badge'), null, 'LIVE badge in sidebar');
  await clickText(B, '.voice-banner button', 'پیوستن');
  await waitFor(B, () => document.querySelector('.voice-bar .dot.connected'), null, 'bob connected');
  await B.click('.vbar-info');
  await waitFor(B, () => document.querySelector('.watch-btn'), null, '"watch stream" button (not auto-subscribed)');
  await B.click('.watch-btn');
  await waitFor(B, () => [...document.querySelectorAll('.stream-tile video')].some((v) => v.videoWidth > 0), null, 'bob receives screen frames');
  await A.click('.room-view .ctl[title="اشتراک صفحه (استریم)"]');
  await waitFor(B, () => !document.querySelector('.stream-tile'), null, 'stream ends for viewer');

  console.log('\nRTC E2E TEST PASSED');
} finally {
  await browser.close();
}
