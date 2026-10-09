import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { get, run, now, UPLOAD_DIR } from '../db.js';
import { effectiveLimits } from '../limits.js';
import { fail } from '../chats.js';
import { mediaReady, processVoice, queueVideo, fileVariants } from '../media.js';

// Only these types are ever served inline; everything else is a forced
// download, so an uploaded HTML/SVG file can never run script on our origin.
const INLINE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'audio/mpeg',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
  'audio/x-m4a',
]);

function kindOf(mime) {
  if (/^image\/(jpeg|png|gif|webp|avif)$/.test(mime)) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

export default async function fileRoutes(app) {
  app.post('/api/upload', async (req, reply) => {
    const limits = effectiveLimits(req.user);
    const maxBytes = limits.uploadMb * 1024 * 1024;
    const quotaMb = limits.quotaMb;
    if (quotaMb > 0) {
      const used = get('SELECT IFNULL(SUM(size), 0) AS s FROM files WHERE owner_id = ?', req.user.id).s;
      if (used >= quotaMb * 1024 * 1024) fail(413, 'سهمیه فضای شما پر شده است');
    }

    const part = await req.file({ limits: { fileSize: maxBytes, files: 1 } });
    if (!part) fail(400, 'فایلی ارسال نشده');

    const month = new Date().toISOString().slice(0, 7);
    const rel = path.posix.join(month, crypto.randomBytes(16).toString('hex'));
    const abs = path.join(UPLOAD_DIR, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    try {
      await pipeline(part.file, fs.createWriteStream(abs));
    } catch (e) {
      // Client cancelled or the connection dropped mid-upload: don't leave partial files behind.
      fs.rmSync(abs, { force: true });
      throw e;
    }
    if (part.file.truncated) {
      fs.rmSync(abs, { force: true });
      fail(413, `حداکثر حجم فایل برای شما ${limits.uploadMb} مگابایت است`);
    }

    const size = fs.statSync(abs).size;
    const mime = String(part.mimetype || 'application/octet-stream').toLowerCase().split(';')[0];
    const kind = kindOf(mime);
    const q = req.query || {};
    // Voice waveform: up to 128 bars, each a base-32 digit (0-v).
    const waveform = /^[0-9a-v]{1,128}$/.test(q.wave || '') ? q.wave : null;
    const maxQuality = ['360', '720', 'original'].includes(q.q) ? q.q : '720';
    const processVideo = kind === 'video' && (await mediaReady);
    const r = run(
      `INSERT INTO files (owner_id, path, mime, size, name, kind, width, height, duration, waveform, status, max_quality, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req.user.id,
      rel,
      mime,
      size,
      String(part.filename || 'file').slice(0, 200),
      kind,
      num(q.w),
      num(q.h),
      num(q.dur),
      waveform,
      processVideo ? 'processing' : 'ready',
      kind === 'video' ? maxQuality : null,
      now(),
    );
    const id = Number(r.lastInsertRowid);
    if (kind === 'audio' && q.voice === '1') await processVoice(id);
    if (processVideo) queueVideo(id, maxQuality);
    const f = get('SELECT * FROM files WHERE id = ?', id);
    reply.code(201);
    return { file: { id, mime: f.mime, size: f.size, kind, name: f.name, status: f.status } };
  });

  app.get('/api/me/usage', async (req) => ({
    usedBytes: get('SELECT IFNULL(SUM(size), 0) AS s FROM files WHERE owner_id = ?', req.user.id).s,
    quotaMb: effectiveLimits(req.user).quotaMb,
  }));

  app.get('/api/files/:id', async (req, reply) => {
    const f = get('SELECT * FROM files WHERE id = ?', Number(req.params.id));
    if (!f) fail(404, 'فایل پیدا نشد');
    const uid = req.user.id;
    const allowed =
      f.owner_id === uid ||
      get(
        `SELECT 1 AS ok WHERE
           EXISTS (SELECT 1 FROM users WHERE avatar_file_id = ?1)
           OR EXISTS (SELECT 1 FROM chats WHERE avatar_file_id = ?1)
           OR EXISTS (SELECT 1 FROM messages m JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?2
                      WHERE m.file_id = ?1 AND m.deleted = 0)`,
        f.id,
        uid,
      );
    if (!allowed) fail(403, 'دسترسی ندارید');
    if (f.purged) fail(410, 'این فایل منقضی و حذف شده است');

    let rel = f.path;
    let mime = f.mime;
    if (req.query.thumb === '1') {
      if (!f.thumb) fail(404, 'پیش‌نمایش ندارد');
      rel = f.thumb;
      mime = 'image/jpeg';
    } else if (req.query.v) {
      const v = fileVariants(f).find((x) => String(x.q) === String(req.query.v));
      if (v) {
        rel = v.path;
        mime = 'video/mp4';
      }
    }

    const inline = INLINE_TYPES.has(mime) && req.query.download !== '1';
    reply.header('Content-Type', inline ? mime : 'application/octet-stream');
    reply.header(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name || 'file')}`,
    );
    // Not immutable: a video's main file is replaced once processing finishes.
    reply.header('Cache-Control', f.status === 'ready' ? 'private, max-age=86400' : 'no-store');
    return reply.sendFile(rel, UPLOAD_DIR, { contentType: false });
  });
}
