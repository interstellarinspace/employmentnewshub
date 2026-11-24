const crypto = require('node:crypto');
const config = require('./config');

const COOKIE = 'admin_session';
const MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

function sign(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

function createToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + MAX_AGE_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function checkPassword(input) {
  const a = crypto.createHash('sha256').update(String(input ?? '')).digest();
  const b = crypto.createHash('sha256').update(config.adminPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.https,
    maxAge: token ? MAX_AGE_MS : 0,
    path: '/',
  });
}

const isAdmin = (req) => verifyToken(parseCookies(req.headers.cookie)[COOKIE]);

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.redirect(303, '/admin/login');
}

// Extra CSRF guard on top of SameSite=Strict: reject cross-origin form posts.
function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch { /* fall through */ }
  res.status(403).send('Cross-origin request blocked');
}

module.exports = { createToken, verifyToken, checkPassword, setSessionCookie, requireAdmin, isAdmin, sameOrigin, parseCookies, COOKIE };
