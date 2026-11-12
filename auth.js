'use strict';
const crypto = require('node:crypto');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return 'scrypt$' + salt.toString('hex') + '$' + h.toString('hex');
}
function verifyPassword(pw, stored) {
  try {
    const [alg, s, h] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const calc = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    const exp = Buffer.from(h, 'hex');
    return exp.length === calc.length && crypto.timingSafeEqual(exp, calc);
  } catch { return false; }
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SESSION_MS = 12 * 3600 * 1000;

function createSession(app, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  app.q.run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', sha(token), userId, Date.now() + SESSION_MS);
  return token;
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function userFromReq(app, req) {
  const t = parseCookies(req).sid; if (!t) return null;
  const row = app.q.get('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?', sha(t));
  if (!row || row.expires_at < Date.now() || !row.active) return null;
  return row;
}
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (pw.length > 200) return 'La contraseña es demasiado larga.';
  return '';
}
function sign(secret, obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
}
function unsign(secret, tok) {
  const [body, mac] = String(tok || '').split('.'); if (!body || !mac) return null;
  const exp = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}
module.exports = { hashPassword, verifyPassword, createSession, userFromReq, parseCookies, passwordProblem, sha, sign, unsign, SESSION_MS };
