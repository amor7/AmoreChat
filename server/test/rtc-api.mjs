// Phase 3 API test: voice tokens, per-user limits, call signaling and webhooks.
// Needs a server started on an EMPTY data dir with LIVEKIT_API_KEY=amorechat and
// LIVEKIT_API_SECRET=$LK_SECRET (LiveKit itself does not have to be running).
// Usage: LK_SECRET=... node test/rtc-api.mjs <baseUrl> <setupCode>
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { io } from 'socket.io-client';

const BASE = process.argv[2];
const SETUP = process.argv[3];
const SECRET = process.env.LK_SECRET;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

function client() {
  let cookie = '';
  async function call(method, url, body, { form, headers = {} } = {}) {
    const h = { 'x-requested-with': 'amorechat', ...headers };
    if (cookie) h.cookie = cookie;
    if (body && !form) h['content-type'] = h['content-type'] || 'application/json';
    const res = await fetch(BASE + url, { method, headers: h, body: form || (body && (typeof body === 'string' ? body : JSON.stringify(body))) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ...data };
  }
  const events = [];
  let sock;
  return {
    call,
    events,
    async connect() {
      sock = io(BASE, { extraHeaders: { cookie }, transports: ['websocket'] });
      sock.onAny((name, data) => events.push({ name, data }));
      await new Promise((ok, bad) => (sock.on('connect', ok), sock.on('connect_error', bad)));
    },
    close: () => sock?.close(),
    last: (name) => events.filter((e) => e.name === name).at(-1)?.data,
  };
}

const claims = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
function webhook(evt) {
  const body = JSON.stringify(evt);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ iss: 'amorechat', nbf: now - 5, exp: now + 60, sha256: crypto.createHash('sha256').update(body).digest('base64') });
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${payload}`).digest('base64url');
  return { body, auth: `${head}.${payload}.${sig}` };
}
async function sendWebhook(evt, auth) {
  const w = webhook(evt);
  const res = await fetch(BASE + '/api/livekit/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/webhook+json', authorization: auth ?? w.auth },
    body: w.body,
  });
  return res.status;
}

const owner = client();
const bob = client();
const carol = client();

let r = await owner.call('POST', '/api/auth/register', { username: 'owner', password: 'password1', displayName: 'Owner', invite: SETUP });
assert.equal(r.status, 200);
assert.equal(r.user.limits.canStream, true);
r = await owner.call('POST', '/api/admin/invites', { maxUses: 2 });
r = await bob.call('POST', '/api/auth/register', { username: 'bob', password: 'password1', displayName: 'Bob', invite: r.invite.code });
const bobId = r.user.id;
r = await owner.call('GET', '/api/admin/invites');
r = await carol.call('POST', '/api/auth/register', { username: 'carol', password: 'password1', displayName: 'Carol', invite: r.invites[0].code });
const carolId = r.user.id;
await bob.connect();
await carol.connect();

// ---- Voice channels ----
r = await owner.call('POST', '/api/chats', { type: 'voice', title: 'لابی', isPublic: true });
assert.equal(r.status, 200, JSON.stringify(r));
const lobby = r.chat.id;
r = await bob.call('GET', '/api/rtc/voice-channels');
assert.deepEqual(r.channels.map((c) => [c.id, c.isMember]), [[lobby, false]]);
r = await bob.call('POST', '/api/rtc/join', { chatId: lobby });
assert.equal(r.status, 200, JSON.stringify(r));
let c = claims(r.token);
assert.equal(c.video.room, `chat-${lobby}`);
assert.equal(c.sub, `u${bobId}`);
assert.ok(c.video.canPublishSources.includes('screen_share'), 'streaming allowed by default');
r = await bob.call('GET', '/api/chats');
assert.ok(r.chats.some((x) => x.id === lobby), 'joining a public voice channel makes you a member');

// Admin turns streaming off for everyone, then allows it for bob only
await owner.call('PATCH', '/api/admin/settings', { default_can_stream: '0' });
c = claims((await carol.call('POST', '/api/rtc/join', { chatId: lobby })).token);
assert.deepEqual(c.video.canPublishSources, ['microphone']);
r = await owner.call('PATCH', `/api/admin/users/${bobId}/limits`, { can_stream: true, stream_quality: 1080 });
assert.equal(r.limits.canStream, true);
r = await bob.call('POST', '/api/rtc/join', { chatId: lobby });
assert.ok(claims(r.token).video.canPublishSources.includes('screen_share'));
assert.equal(r.streamQuality, 1080);
r = await carol.call('PATCH', `/api/admin/users/${bobId}/limits`, { can_stream: false });
assert.equal(r.status, 403, 'regular users cannot change limits');

// Per-user upload limit
await owner.call('PATCH', '/api/admin/settings', { max_upload_mb: 1 });
const twoMb = () => {
  const f = new FormData();
  f.append('file', new Blob([new Uint8Array(2 * 1024 * 1024)]), 'x.bin');
  return f;
};
r = await carol.call('POST', '/api/upload', null, { form: twoMb() });
assert.equal(r.status, 413);
await owner.call('PATCH', `/api/admin/users/${carolId}/limits`, { upload_mb: 5 });
r = await carol.call('POST', '/api/upload', null, { form: twoMb() });
assert.equal(r.status, 201, 'override raises the limit for carol only');
r = await bob.call('POST', '/api/upload', null, { form: twoMb() });
assert.equal(r.status, 413);
r = await owner.call('POST', '/api/upload', null, { form: twoMb() });
assert.equal(r.status, 201, 'owner is never limited');
await owner.call('PATCH', '/api/admin/settings', { max_upload_mb: 100 });

// Listen-only: channel members who may not post, and muted group members
r = await owner.call('POST', '/api/chats', { type: 'channel', title: 'رادیو', memberIds: [bobId] });
c = claims((await bob.call('POST', '/api/rtc/join', { chatId: r.chat.id })).token);
assert.equal(c.video.canPublish, false);
r = await owner.call('POST', '/api/chats', { type: 'group', title: 'جمع', memberIds: [bobId] });
const group = r.chat.id;
await owner.call('PATCH', `/api/chats/${group}/members/${bobId}`, { mutedUntil: Date.now() + 60000 });
c = claims((await bob.call('POST', '/api/rtc/join', { chatId: group })).token);
assert.equal(c.video.canPublish, false);
r = await carol.call('POST', '/api/rtc/join', { chatId: group });
assert.equal(r.status, 403, 'non-members cannot join a private group room');

// ---- Webhooks drive "who is in the room" ----
assert.equal(await sendWebhook({ event: 'participant_joined', room: { name: `chat-${lobby}` }, participant: { identity: `u${bobId}`, name: 'Bob' } }, 'Bearer bad.token.here'), 401);
assert.equal(await sendWebhook({ event: 'participant_joined', room: { name: `chat-${lobby}` }, participant: { identity: `u${bobId}`, name: 'Bob' } }), 200);
await sleep(200);
assert.deepEqual(carol.last('voice:state')?.participants.map((p) => p.userId), [bobId], 'everyone sees public voice channel presence');
await sendWebhook({ event: 'track_published', room: { name: `chat-${lobby}` }, participant: { identity: `u${bobId}` }, track: { source: 'SCREEN_SHARE' } });
await sleep(200);
assert.equal(carol.last('voice:state').participants[0].screen, true, 'LIVE badge');
r = await carol.call('GET', '/api/rtc/state');
assert.equal(r.rooms.find((x) => x.chatId === lobby).participants.length, 1);
r = await owner.call('GET', '/api/admin/live');
assert.equal(r.rooms[0].title, 'لابی');
await sendWebhook({ event: 'participant_left', room: { name: `chat-${lobby}` }, participant: { identity: `u${bobId}` } });
await sleep(200);
assert.deepEqual(carol.last('voice:state').participants, []);

// ---- One-to-one calls ----
r = await bob.call('POST', '/api/calls', { userId: carolId, video: true });
assert.equal(r.status, 200, JSON.stringify(r));
const call1 = r.call;
assert.ok(call1.token, 'caller joins the room right away');
await sleep(200);
assert.equal(carol.last('call:incoming')?.id, call1.id);
r = await owner.call('POST', '/api/calls', { userId: carolId });
assert.equal(r.status, 409, 'busy');
r = await carol.call('GET', '/api/rtc/state');
assert.equal(r.call.token, null, 'callee gets no token before answering');
r = await carol.call('POST', `/api/calls/${call1.id}/accept`);
assert.ok(r.call.token);
assert.equal(claims(r.call.token).video.room, `call-${call1.id}`);
await sleep(200);
assert.equal(bob.last('call:accepted')?.id, call1.id);
// Callee closes the tab -> LiveKit reports the participant left -> call ends for both
await sendWebhook({ event: 'participant_left', room: { name: `call-${call1.id}` }, participant: { identity: `u${carolId}` } });
await sleep(300);
assert.equal(bob.last('call:ended')?.reason, 'ended');
let dm = (await bob.call('GET', '/api/chats')).chats.find((x) => x.type === 'dm' && x.peer?.id === carolId);
let msgs = (await bob.call('GET', `/api/chats/${dm.id}/messages`)).messages;
assert.equal(JSON.parse(msgs.at(-1).text).status, 'ended');
assert.equal(msgs.at(-1).type, 'call');

r = await bob.call('POST', '/api/calls', { userId: carolId });
await carol.call('POST', `/api/calls/${r.call.id}/decline`);
msgs = (await bob.call('GET', `/api/chats/${dm.id}/messages`)).messages;
assert.equal(JSON.parse(msgs.at(-1).text).status, 'declined');

r = await bob.call('POST', '/api/calls', { userId: carolId });
await bob.call('POST', `/api/calls/${r.call.id}/end`);
msgs = (await bob.call('GET', `/api/chats/${dm.id}/messages`)).messages;
assert.equal(JSON.parse(msgs.at(-1).text).status, 'cancelled');

await owner.call('PATCH', `/api/admin/users/${carolId}/limits`, { can_call: false });
r = await bob.call('POST', '/api/calls', { userId: carolId });
assert.equal(r.status, 403, 'admin disabled calls for carol');

bob.close();
carol.close();
console.log('RTC API TEST PASSED');
