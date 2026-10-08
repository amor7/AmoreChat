import { Server } from 'socket.io';
import { all, run, now } from './db.js';
import { userFromToken, SESSION_COOKIE } from './auth.js';
import { setIO, online } from './realtime.js';

export function setupSocket(app) {
  const io = new Server(app.server, {
    serveClient: false,
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 20000,
    pingTimeout: 25000,
  });
  setIO(io);

  io.use((socket, next) => {
    // Cookies ride along on cross-site websocket handshakes, so reject foreign origins.
    const { origin, host, cookie } = socket.handshake.headers;
    if (origin) {
      try {
        if (new URL(origin).host !== host) return next(new Error('bad origin'));
      } catch {
        return next(new Error('bad origin'));
      }
    }
    const user = userFromToken(app.parseCookie(cookie || '')[SESSION_COOKIE]);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = { id: user.id, name: user.display_name };
    next();
  });

  io.on('connection', (socket) => {
    const uid = socket.data.user.id;
    socket.join(`user:${uid}`);
    for (const r of all('SELECT chat_id FROM chat_members WHERE user_id = ?', uid)) socket.join(`chat:${r.chat_id}`);

    const count = (online.get(uid) || 0) + 1;
    online.set(uid, count);
    if (count === 1) io.emit('presence', { userId: uid, online: true });

    socket.on('typing', (data) => {
      const chatId = Number(data?.chatId);
      if (socket.rooms.has(`chat:${chatId}`)) {
        socket.to(`chat:${chatId}`).emit('typing', { chatId, userId: uid, name: socket.data.user.name });
      }
    });

    socket.on('disconnect', () => {
      const left = (online.get(uid) || 1) - 1;
      if (left > 0) {
        online.set(uid, left);
        return;
      }
      online.delete(uid);
      const t = now();
      run('UPDATE users SET last_seen = ? WHERE id = ?', t, uid);
      io.emit('presence', { userId: uid, online: false, lastSeen: t });
    });
  });

  return io;
}
