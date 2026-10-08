// End-to-end smoke test against a freshly started server with an empty DATA_DIR.
// Usage: node test/smoke.mjs <baseUrl> <setupCode>
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

const BASE = process.argv[2] || 'http://localhost:3000';
const SETUP = process.argv[3];

function client() {
  let cookie = '';
  async function call(method, url, body, { raw = false, form } = {}) {
    const headers = { 'x-requested-with': 'amorechat' };
    if (cookie) headers.cookie = cookie;
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + url, { method, headers, body: form || (body && JSON.stringify(body)) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    if (raw) return res;
    const data = await res.json();
    return { status: res.status, ...data };
  }
  return { call, cookie: () => cookie };
}

const owner = client();
const bob = client();
const eve = client();

// Registration requires the setup code first.
let r = await owner.call('POST', '/api/auth/register', { username: 'owner', password: 'password1', displayName: 'Owner' });
assert.equal(r.status, 403);
r = await owner.call('POST', '/api/auth/register', { username: 'owner', password: 'password1', displayName: 'مدیر', invite: SETUP });
assert.equal(r.status, 200, JSON.stringify(r));
assert.equal(r.user.role, 'owner');

// CSRF guard
const noHeader = await fetch(BASE + '/api/auth/logout', { method: 'POST' });
assert.equal(noHeader.status, 403);

// Invite-only signup
r = await owner.call('POST', '/api/admin/invites', { maxUses: 2, note: 'test' });
const code = r.invite.code;
r = await bob.call('POST', '/api/auth/register', { username: 'bob', password: 'password1', displayName: 'Bob' });
assert.equal(r.status, 403);
r = await bob.call('POST', '/api/auth/register', { username: 'bob', password: 'password1', displayName: 'باب', invite: code });
assert.equal(r.status, 200);
const bobId = r.user.id;
r = await eve.call('POST', '/api/auth/register', { username: 'eve', password: 'password1', displayName: 'Eve', invite: code });
const eveId = r.user.id;

// Everyone has saved messages + emergency channel
r = await bob.call('GET', '/api/chats');
assert.equal(r.chats.length, 2);
const emergency = r.chats.find((c) => c.isEmergency);
assert.ok(emergency);
r = await bob.call('POST', `/api/chats/${emergency.id}/messages`, { text: 'hi' });
assert.equal(r.status, 403);

// Realtime: bob listens
const sock = io(BASE, { extraHeaders: { cookie: bob.cookie() }, transports: ['websocket'] });
await new Promise((ok, bad) => {
  sock.on('connect', ok);
  sock.on('connect_error', bad);
});
const received = [];
sock.on('message:new', (m) => received.push(m));
sock.on('emergency', (m) => received.push({ emergency: true, ...m }));

// Owner creates a group with bob
r = await owner.call('POST', '/api/chats', { type: 'group', title: 'گروه تست', memberIds: [bobId] });
assert.equal(r.status, 200);
const groupId = r.chat.id;
r = await owner.call('POST', `/api/chats/${groupId}/messages`, { text: 'سلام بچه‌ها' });
const firstMsg = r.message;
await new Promise((ok) => setTimeout(ok, 200));
assert.ok(received.some((m) => m.text === 'سلام بچه‌ها'), 'bob got message via socket');

// Eve isn't a member
r = await eve.call('GET', `/api/chats/${groupId}/messages`);
assert.equal(r.status, 403);

// Bob replies; unread for owner
r = await bob.call('POST', `/api/chats/${groupId}/messages`, { text: 'سلام', replyTo: firstMsg.id });
assert.equal(r.message.replyTo.id, firstMsg.id);
r = await owner.call('GET', '/api/chats');
assert.equal(r.chats.find((c) => c.id === groupId).unread, 1);

// Make bob a limited admin who can only delete messages
r = await owner.call('PATCH', `/api/chats/${groupId}/members/${bobId}`, { role: 'admin', perms: ['delete_messages'] });
assert.equal(r.status, 200);
r = await bob.call('POST', `/api/chats/${groupId}/members`, { userIds: [eveId] });
assert.equal(r.status, 403, 'bob lacks add_members');
r = await owner.call('POST', `/api/chats/${groupId}/members`, { userIds: [eveId] });
assert.equal(r.added, 1);
r = await eve.call('POST', `/api/chats/${groupId}/messages`, { text: 'spam' });
const spamId = r.message.id;
r = await bob.call('DELETE', `/api/messages/${spamId}`);
assert.equal(r.status, 200);
r = await bob.call('PATCH', `/api/chats/${groupId}/members/${eveId}`, { mutedUntil: Date.now() + 60000 });
assert.equal(r.status, 403, 'bob lacks mute_members');

// Owner mutes eve
r = await owner.call('PATCH', `/api/chats/${groupId}/members/${eveId}`, { mutedUntil: Date.now() + 60000 });
r = await eve.call('POST', `/api/chats/${groupId}/messages`, { text: 'x' });
assert.equal(r.status, 403);

// DM + file upload + access control
r = await bob.call('POST', '/api/chats/dm', { userId: eveId });
const dmId = r.chat.id;
assert.equal(r.chat.title, 'Eve');
const form = new FormData();
form.append('file', new Blob([Buffer.from('<script>alert(1)</script>')], { type: 'text/html' }), 'x.html');
r = await bob.call('POST', '/api/upload', null, { form });
assert.equal(r.status, 201);
const fileId = r.file.id;
r = await bob.call('POST', `/api/chats/${dmId}/messages`, { fileId, type: 'image' });
assert.equal(r.message.type, 'file', 'html cannot pose as image');
let res = await eve.call('GET', `/api/files/${fileId}`, null, { raw: true });
assert.equal(res.status, 200);
assert.equal(res.headers.get('content-type'), 'application/octet-stream');
assert.match(res.headers.get('content-disposition'), /^attachment/);
res = await owner.call('GET', `/api/files/${fileId}`, null, { raw: true });
assert.equal(res.status, 403);

// Emergency broadcast
r = await owner.call('POST', `/api/chats/${emergency.id}/messages`, { text: 'اطلاعیه مهم' });
await new Promise((ok) => setTimeout(ok, 200));
assert.ok(received.some((m) => m.emergency));

// Site admin with limited perms
r = await owner.call('PATCH', `/api/admin/users/${bobId}`, { role: 'admin', adminPerms: ['manage_invites'] });
r = await bob.call('GET', '/api/admin/invites');
assert.equal(r.status, 200);
r = await bob.call('GET', '/api/admin/users');
assert.equal(r.status, 403);

// Ban kicks the session
r = await owner.call('POST', `/api/admin/users/${eveId}/ban`, { banned: true });
r = await eve.call('GET', '/api/auth/me');
assert.equal(r.status, 401);

r = await owner.call('GET', '/api/admin/stats');
assert.equal(r.users, 3);
r = await owner.call('GET', '/api/admin/audit');
assert.ok(r.entries.length > 5);

sock.close();
console.log('SMOKE TEST PASSED');
