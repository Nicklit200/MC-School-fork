import crypto from 'node:crypto';

const SESSION_COOKIE = 'tsubera_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function equal(a, b) {
  const aa = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
export function createOnlineAuth({ password, captureToken = '', publicBaseUrl = '' }) {
  if (!password || password.length < 12) throw new Error('Online Tsubera requires SITE_PASSWORD of at least 12 characters.');
  const salt = crypto.randomBytes(16);
  const expected = crypto.scryptSync(password, salt, 32);
  const sessions = new Map(), failures = new Map();
  const trustedOrigin = publicBaseUrl ? new URL(publicBaseUrl).origin : '';
  const captureRoutes = new Set(['/api/trans/freights/import', '/api/trans/freights/detail/import', '/api/trans/active/import', '/api/trans/orders/import']);
  function secure(req) { return !!req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'; }
  function originAllowed(req) {
    const incoming = req.headers.origin;
    if (!incoming) return req.headers['sec-fetch-site'] !== 'cross-site';
    try {
      const parsed = new URL(incoming);
      const expectedOrigin = trustedOrigin || new URL((secure(req) ? 'https://' : 'http://') + req.headers.host).origin;
      return parsed.origin === expectedOrigin;
    } catch { return false; }
  }
  function sessionKey(req) {
    const value = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(SESSION_COOKIE + '='));
    if (!value) return '';
    const token = value.slice(SESSION_COOKIE.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? hash(token) : '';
  }
  function hasSession(req) {
    const key = sessionKey(req), expiry = sessions.get(key);
    if (!expiry) return false;
    if (expiry <= Date.now()) { sessions.delete(key); return false; }
    return true;
  }
  function headerAuthorized(req) {
    return equal(req.headers['x-app-password'], password) || equal(req.headers.authorization, 'Bearer ' + password);
  }
  function authorized(req) { return hasSession(req) || headerAuthorized(req); }
  function captureAuthorized(req) {
    return !!captureToken && equal(req.headers['x-tsubera-capture-token'] || req.headers['x-app-password'], captureToken);
  }
  function reply(res, status, value, extra = {}) {
    const bytes = JSON.stringify(value);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(bytes), ...extra });
    res.end(bytes);
  }
  function cookie(req, token, maxAge) {
    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` + (secure(req) ? '; Secure' : '');
  }
  function prune() {
    const now = Date.now();
    for (const [key, expiry] of sessions) if (expiry <= now) sessions.delete(key);
    for (const [key, value] of failures) if (value.until <= now) failures.delete(key);
    if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value);
    if (failures.size >= 10000) failures.delete(failures.keys().next().value);
  }
  function securityHeaders(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    if (secure(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  async function handle(req, res, pathname) {
    securityHeaders(req, res);
    if (pathname === '/health') { reply(res, 200, { ok: true }); return true; }
    if (pathname === '/auth/login' && req.method === 'POST') {
      if (!originAllowed(req)) { reply(res, 403, { error: 'Откройте форму входа на сайте Tsubera.' }); return true; }
      if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') { reply(res, 415, { error: 'Нужен Content-Type application/json' }); return true; }
      prune();
      // The rightmost forwarded address is supplied by the nearest platform proxy.
      const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
      const address = forwarded.at(-1) || req.socket.remoteAddress || 'unknown';
      const blocked = failures.get(address);
      if (blocked && blocked.count >= 8 && blocked.until > Date.now()) { reply(res, 429, { error: 'Слишком много попыток. Попробуйте через 15 минут.' }, { 'retry-after': '900' }); return true; }
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) { reply(res, 413, { error: 'Запрос слишком большой' }); return true; }
        chunks.push(chunk);
      }
      let supplied;
      try { supplied = JSON.parse(Buffer.concat(chunks).toString('utf8')).password; } catch { reply(res, 400, { error: 'Некорректный запрос' }); return true; }
      if (typeof supplied !== 'string' || supplied.length > 1024) { reply(res, 400, { error: 'Введите пароль' }); return true; }
      if (!crypto.timingSafeEqual(crypto.scryptSync(supplied, salt, 32), expected)) {
        failures.set(address, { count: (blocked?.count || 0) + 1, until: Date.now() + 15 * 60 * 1000 });
        reply(res, 401, { error: 'Неверный пароль' }); return true;
      }
      failures.delete(address);
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(hash(token), Date.now() + SESSION_SECONDS * 1000);
      reply(res, 200, { ok: true }, { 'set-cookie': cookie(req, token, SESSION_SECONDS) }); return true;
    }
    if (pathname === '/auth/logout' && req.method === 'POST') {
      if (!originAllowed(req)) { reply(res, 403, { error: 'Недопустимый источник запроса' }); return true; }
      sessions.delete(sessionKey(req));
      reply(res, 200, { ok: true }, { 'set-cookie': cookie(req, '', 0) }); return true;
    }
    if (pathname === '/login' && req.method === 'GET') return false;
    // Optional external integrations are unavailable unless their separate secrets are configured.
    if (pathname.startsWith('/mcp/')) return false;
    if (captureRoutes.has(pathname) && (req.method === 'OPTIONS' || (req.method === 'POST' && captureAuthorized(req)))) return false;
    if (!authorized(req)) {
      if (pathname.startsWith('/api/') || pathname.startsWith('/file/') || pathname === '/direct-upload' || pathname.startsWith('/fakturownia/')) reply(res, 401, { error: 'Войдите в Tsubera' });
      else { res.writeHead(303, { location: '/login', 'cache-control': 'no-store' }); res.end(); }
      return true;
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !originAllowed(req)) { reply(res, 403, { error: 'Недопустимый источник запроса' }); return true; }
    return false;
  }
  return { handle, authorized };
}
