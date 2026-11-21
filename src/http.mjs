// Small dependency-free HTTP helpers.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.pdf': 'application/pdf',
  '.apk': 'application/vnd.android.package-archive', '.exe': 'application/vnd.microsoft.portable-executable',
  '.msi': 'application/x-msi', '.zip': 'application/zip',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
export const mime = file => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function readBody(req, limit = 30e6) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > limit) throw new HttpError(413, 'Request too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit) {
  const body = await readBody(req, limit);
  if (!body.length) return {};
  try { return JSON.parse(body.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
}

export function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

export function plainText(res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(text);
}

export function redirect(res, target, headers = {}) {
  res.writeHead(302, { Location: target, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

export function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(name, value, { days = 30, secure = false, remove = false } = {}) {
  const parts = [`${name}=${remove ? '' : encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${remove ? 0 : days * 86400}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

const isLocalName = name => name === 'localhost' || name === '127.0.0.1' || name === '[::1]';

/** How the request looks from outside: behind a tunnel or not, which host, https or not. */
export function requestInfo(req) {
  const host = req.headers.host || '';
  let url;
  try { url = new URL(`http://${host}`); } catch { url = new URL('http://invalid'); }
  const proxied = Boolean(req.headers['x-forwarded-for'] || req.headers.forwarded || req.headers['cf-connecting-ip']);
  const remote = req.socket.remoteAddress || '';
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const https = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
    || (proxied && !url.port && !isLocalName(url.hostname));
  return {
    host, hostname: url.hostname, port: url.port, https,
    // "Sitting at this computer": a loopback connection to a localhost name that did not come through a tunnel.
    local: loopback && !proxied && isLocalName(url.hostname),
    client: proxied ? String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']).split(',')[0].trim() : remote,
  };
}

/** Sends a file with Range / ETag / HEAD support. */
export async function sendFile(req, res, file, { download = false, cache = 'no-cache', headers = {} } = {}) {
  let st;
  try { st = await fsp.stat(file); } catch { return plainText(res, 404, 'Not found'); }
  if (!st.isFile()) return plainText(res, 404, 'Not found');
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const common = {
    'Content-Type': mime(file), 'Accept-Ranges': 'bytes', ETag: etag, 'Cache-Control': cache,
    'Last-Modified': st.mtime.toUTCString(), 'X-Content-Type-Options': 'nosniff', ...headers,
  };
  if (download) {
    const name = path.basename(file);
    common['Content-Disposition'] = `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  }
  if (req.headers['if-none-match'] === etag && !req.headers.range) { res.writeHead(304, common); return res.end(); }

  let start = 0, end = st.size - 1, status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && st.size > 0) {
    if (range[1] === '' && range[2] !== '') { start = Math.max(0, st.size - Number(range[2])); }
    else { start = Number(range[1]); if (range[2] !== '') end = Math.min(end, Number(range[2])); }
    if (!(start <= end) || start >= st.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end();
    }
    status = 206;
    common['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  }
  common['Content-Length'] = st.size === 0 ? 0 : end - start + 1;
  res.writeHead(status, common);
  if (req.method === 'HEAD' || st.size === 0) return res.end();
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/** A simple router for patterns like '/api/project/:id/products'. */
export class Router {
  #routes = [];
  add(method, pattern, handler, options = {}) {
    const names = [];
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, name) => { names.push(name); return '([^/]+)'; }) + '$');
    this.#routes.push({ method, regex, names, handler, options });
  }
  find(method, pathname) {
    let pathExists = false;
    for (const r of this.#routes) {
      const m = r.regex.exec(pathname);
      if (!m) continue;
      pathExists = true;
      if (r.method !== method) continue;
      const params = {};
      r.names.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, options: r.options, params };
    }
    return pathExists ? { wrongMethod: true } : null;
  }
}
