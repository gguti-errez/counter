'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const express = require('express');
const DB = require('./lib/db');
const A = require('./lib/auth');
const U = require('./lib/util');
const R = require('./lib/report');
const { readInvoice } = require('./lib/reader');

const ROOT = __dirname;
let cfg = { port: 3000, host: '0.0.0.0', https: { key: '', cert: '' }, dataDir: 'data', retentionDays: 28 };
const cfgFile = process.env.FF_CONFIG || path.join(ROOT, 'config.json');
if (fs.existsSync(cfgFile)) cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(cfgFile, 'utf8').replace(/^﻿/, '')));
if (process.env.PORT) cfg.port = +process.env.PORT;
if (process.env.HOST) cfg.host = process.env.HOST;
const dataDir = path.resolve(ROOT, process.env.FF_DATA || cfg.dataDir);
const useHttps = !!(cfg.https && cfg.https.key && cfg.https.cert);
const DAY = 86400000;

const app = DB.open(dataDir);
const { q } = app;
const logErr = (...a) => console.error(new Date().toISOString(), ...a);

/* ---------- Primer arranque: cuenta de administrador ---------- */
function bootstrapAdmin() {
  if (q.get("SELECT id FROM users WHERE role='admin' LIMIT 1")) return;
  const envPw = process.env.ADMIN_PASSWORD;
  const pw = envPw && envPw.length >= 8 ? envPw : crypto.randomBytes(9).toString('base64url');
  q.run("INSERT INTO users(username,pass_hash,role,nombre,cargo,fondo_cents,must_change,created_at) VALUES('admin',?, 'admin','Administrador','Administrador',0,1,?)", A.hashPassword(pw), Date.now());
  app.audit('sistema', 'crear_admin', 'admin');
  const msg = 'PRIMER ARRANQUE\nUsuario: admin\nClave temporal: ' + pw + '\nEl sistema pedirá cambiarla al ingresar. Borre este archivo después.\n';
  if (envPw && envPw.length >= 8) console.log('Cuenta admin creada con la clave de ADMIN_PASSWORD (se pedirá cambiarla al ingresar).');
  else {
    fs.writeFileSync(path.join(dataDir, 'PRIMERA_CLAVE_ADMIN.txt'), msg);
    console.log('\n==============================\n' + msg + '(también guardado en ' + path.join(dataDir, 'PRIMERA_CLAVE_ADMIN.txt') + ')\n==============================\n');
  }
}
bootstrapAdmin();
function purge() {
  const n = q.run('DELETE FROM invoices WHERE created_at < ?', Date.now() - cfg.retentionDays * DAY).changes;
  q.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  if (n) console.log('Facturas vencidas eliminadas del registro:', n);
}
purge(); setInterval(purge, 6 * 3600 * 1000).unref();

/* ---------- Servidor ---------- */
const web = express();
web.disable('x-powered-by');
if (process.env.TRUST_PROXY || process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME) web.set('trust proxy', 1);
web.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
web.use(express.json({ limit: '60mb' }));
// Defensa CSRF: toda petición que modifica debe venir del mismo origen
web.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const o = req.headers.origin;
  if (o) { try { if (new URL(o).host !== req.headers.host) return res.status(403).json({ error: 'Origen no permitido.' }); } catch { return res.status(403).json({ error: 'Origen no permitido.' }); } }
  next();
});
web.use('/assets', express.static(path.join(ROOT, 'assets'), { maxAge: '1d' }));
web.use(express.static(path.join(ROOT, 'public'), { maxAge: 0, etag: true }));

const sessionUser = (req, res, next) => { req.user = A.userFromReq(app, req); next(); };
const needUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Sesión vencida. Ingresa de nuevo.' }));
const needAdmin = (req, res, next) => (req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Solo un administrador puede hacer esto.' }));
const needFree = (req, res, next) => (req.user.must_change ? res.status(403).json({ error: 'Debes cambiar tu contraseña primero.', must_change: true }) : next());
web.get('/api/health', (req, res) => res.json({ ok: true }));
web.use('/api', sessionUser);

const tarifa = () => { const t = parseFloat(app.getSetting('tarifa', '5.4')); return t > 0 ? t : 5.4; };
const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, nombre: u.nombre, cargo: u.cargo, fondo: (u.fondo_cents / 100).toFixed(2), active: !!u.active, must_change: !!u.must_change });
const cookie = (tok, maxAge, req) => 'sid=' + tok + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + ((useHttps || (req && req.secure)) ? '; Secure' : '');

/* Limitador de intentos fallidos */
const fails = new Map();
function lockedFor(k) { const f = fails.get(k); return f && f.n >= 5 && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0; }
function noteFail(k) { const f = fails.get(k) || { n: 0, until: 0 }; f.n += 1; if (f.n >= 5) f.until = Date.now() + 10 * 60000; fails.set(k, f); }

web.post('/api/login', (req, res) => {
  const username = String((req.body || {}).username || '').trim().slice(0, 60), password = String((req.body || {}).password || '');
  const key = (req.ip || '') + '|' + username.toLowerCase();
  const wait = lockedFor(key); if (wait) return res.status(429).json({ error: 'Demasiados intentos. Espera ' + wait + ' minuto(s).' });
  const u = q.get('SELECT * FROM users WHERE username=?', username);
  const ok = u && u.active && A.verifyPassword(password, u.pass_hash);
  if (!u) A.verifyPassword(password, 'scrypt$00$00'); // tiempo parecido
  if (!ok) { noteFail(key); app.audit(username || '?', 'login_fallido', req.ip || ''); return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' }); }
  fails.delete(key);
  const tok = A.createSession(app, u.id);
  res.setHeader('Set-Cookie', cookie(tok, A.SESSION_MS / 1000, req));
  app.audit(u.username, 'login', '');
  res.json({ user: publicUser(u), tarifa: tarifa() });
});
web.post('/api/logout', (req, res) => {
  const t = A.parseCookies(req).sid; if (t) q.run('DELETE FROM sessions WHERE token_hash=?', A.sha(t));
  res.setHeader('Set-Cookie', cookie('', 0, req)); res.json({ ok: true });
});
web.get('/api/me', needUser, (req, res) => res.json({ user: publicUser(req.user), tarifa: tarifa(), cc: R.CC_DEF, rtn: R.RTN_TXT }));
web.post('/api/password', needUser, (req, res) => {
  const { current, next } = req.body || {};
  if (!A.verifyPassword(String(current || ''), req.user.pass_hash)) return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  const pr = A.passwordProblem(next); if (pr) return res.status(400).json({ error: pr });
  q.run('UPDATE users SET pass_hash=?, must_change=0 WHERE id=?', A.hashPassword(next), req.user.id);
  const keep = A.parseCookies(req).sid; q.run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', req.user.id, A.sha(keep));
  app.audit(req.user.username, 'cambio_clave', ''); res.json({ ok: true });
});

/* ---------- Duplicados ---------- */
const reportKey = (uid, corr, periodo) => uid + '|' + String(corr || '').trim() + '|' + String(periodo || '');
function ids(o) { return { rtn: U.digits(o.rtn_emisor), numero: U.alnum(o.numero), cai: U.alnum(o.cai) }; }
function matchWhy(row, id, extra) {
  const why = [];
  if (id.numero && row.numero === id.numero) {
    if (id.rtn && row.rtn_emisor === id.rtn) why.push('RTN del emisor', 'correlativo');
    else if (id.cai && row.cai === id.cai) why.push('CAI', 'correlativo');
  }
  if (id.numero && row.numero === id.numero && why.length && id.cai && row.cai === id.cai && !why.includes('CAI')) why.push('CAI');
  if (extra.hash && row.img_hash === extra.hash) why.push('imagen idéntica');
  if (!why.length) return null;
  if (extra.fecha && row.fecha === extra.fecha) why.push('fecha');
  if (extra.total && row.total_cents === extra.total) why.push('monto');
  return why;
}
function findDup(id, extra, excludeKey) {
  const since = Date.now() - cfg.retentionDays * DAY;
  const rows = q.all('SELECT * FROM invoices WHERE created_at >= ? AND report_key <> ? AND ((numero<>\'\' AND numero=?) OR (img_hash<>\'\' AND img_hash=?)) ORDER BY created_at ASC', since, excludeKey || '', id.numero || '\u0000', extra.hash || '\u0000');
  for (const r of rows) { const why = matchWhy(r, id, extra); if (why) return { row: r, why }; }
  return null;
}
const dupInfo = (d) => ({ when: U.fmtDateTimeHN(d.row.created_at), who: d.row.user_nombre, corr: d.row.correlativo, fecha: d.row.fecha, total: d.row.total_cents, match: d.why });

/* ---------- Lectura de factura ---------- */
const readLimiter = new Map();
web.post('/api/read', needUser, needFree, async (req, res) => {
  const b = req.body || {};
  const m = /^(?:data:image\/jpeg;base64,)?([A-Za-z0-9+/=]+)$/.exec(String(b.img || ''));
  if (!m || m[1].length > 6e6) return res.status(400).json({ error: 'Imagen no válida.' });
  const buf = Buffer.from(m[1], 'base64');
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return res.status(400).json({ error: 'La imagen debe ser JPEG.' });
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const rl = (readLimiter.get(req.user.id) || []).filter((t) => t > Date.now() - 60000);
  if (rl.length >= 20) return res.status(429).json({ error: 'Demasiadas lecturas en un minuto. Espera un momento.' });
  rl.push(Date.now()); readLimiter.set(req.user.id, rl);
  let r;
  try { r = await readInvoice(app, m[1]); } catch (e) { logErr('lectura', e.message); return res.status(502).json({ error: e.message, code: e.code || 'error' }); }
  r = r || {};
  const out = {
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(r.fecha || '') ? r.fecha : null,
    total: isFinite(parseFloat(r.total)) && parseFloat(r.total) > 0 ? parseFloat(r.total) : null,
    proveedor: r.proveedor ? String(r.proveedor).slice(0, 80) : null, concepto: String(r.concepto || '').toLowerCase().slice(0, 20),
    rtn_cliente: r.rtn_cliente ? String(r.rtn_cliente).slice(0, 30) : null, rtn_emisor: r.rtn_emisor ? U.digits(r.rtn_emisor).slice(0, 14) : '',
    numero: r.numero ? String(r.numero).slice(0, 40) : '', cai: r.cai ? String(r.cai).slice(0, 60) : '', descripcion: r.descripcion ? String(r.descripcion).slice(0, 300) : '',
  };
  const trusted = { rtn_emisor: out.rtn_emisor, numero: out.numero, cai: out.cai };
  out.token = A.sign(app.secret, { h: hash, u: req.user.id, t: trusted, exp: Date.now() + 3 * DAY });
  const key = b.corr || b.periodo ? reportKey(req.user.id, b.corr, b.periodo) : '';
  const d = findDup(ids(trusted), { hash, fecha: out.fecha, total: out.total ? Math.round(out.total * 100) : 0 }, key);
  out.dup = d ? dupInfo(d) : null;
  res.json(out);
});

/* ---------- Generar PDF ---------- */
web.post('/api/pdf', needUser, needFree, (req, res) => {
  let m;
  try {
    m = R.buildModel(req.body || {}, req.user, tarifa());
    if (m.problems.length) return res.status(400).json({ error: m.problems.join(' '), problems: m.problems });
    const key = reportKey(req.user.id, m.f.corr, m.f.periodo);
    const dups = new Map(); const seen = new Map(); const regs = [];
    m.valid.forEach((v) => {
      const it = v.it;
      const buf = Buffer.from(it.data.replace(/^data:image\/jpeg;base64,/, ''), 'base64');
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      const tok = A.unsign(app.secret, it.token);
      const okTok = tok && tok.h === hash && tok.u === req.user.id && tok.exp > Date.now();
      const client = { rtn_emisor: it.rtn_emisor, numero: it.numero, cai: it.cai };
      const sets = []; // identidades a verificar y registrar
      if (okTok) { sets.push({ id: ids(tok.t), edited: 0 }); if (JSON.stringify(ids(client)) !== JSON.stringify(ids(tok.t))) sets.push({ id: ids(client), edited: 1 }); }
      else sets.push({ id: ids(client), edited: 1 });
      const extra = { hash, fecha: it.fecha, total: v.c };
      let found = null;
      for (const s of sets) { const d = findDup(s.id, extra, key); if (d) { found = d; break; } }
      // Duplicada dentro del mismo reporte
      if (!found) for (const s of sets) {
        const k = (s.id.numero && (s.id.rtn || s.id.cai)) ? s.id.numero + '|' + (s.id.rtn || s.id.cai) : '';
        const prev = (k && seen.get(k)) || seen.get('h' + hash);
        if (prev) { found = { row: { created_at: Date.now(), user_nombre: req.user.nombre, correlativo: m.f.corr, fecha: prev.fecha, total_cents: prev.c }, why: ['otra factura de este mismo reporte'] }; break; }
      }
      sets.forEach((s) => { const k = (s.id.numero && (s.id.rtn || s.id.cai)) ? s.id.numero + '|' + (s.id.rtn || s.id.cai) : ''; if (k) seen.set(k, { fecha: it.fecha, c: v.c }); });
      seen.set('h' + hash, { fecha: it.fecha, c: v.c });
      if (found) dups.set(it.n, dupInfo(found));
      sets.forEach((s) => regs.push({ s, hash, v }));
    });
    const doc = R.buildPdf(m, dups);
    const out = Buffer.from(doc.output('arraybuffer'));
    // Se registra solo cuando el PDF ya se generó bien. Descargar de nuevo el mismo reporte reemplaza su registro anterior.
    app.tx(() => {
      q.run('DELETE FROM invoices WHERE report_key=?', key);
      regs.forEach(({ s, hash, v }) => q.run('INSERT INTO invoices(user_id,user_nombre,report_key,correlativo,rtn_emisor,numero,cai,fecha,total_cents,img_hash,edited,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        req.user.id, req.user.nombre, key, m.f.corr, s.id.rtn, s.id.numero, s.id.cai, v.fecha, v.c, hash, s.edited, Date.now()));
    });
    app.audit(req.user.username, 'pdf', m.f.corr + ' · ' + m.valid.length + ' facturas · ' + dups.size + ' duplicadas');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + R.fname(m, U.todayHN()) + '"');
    res.setHeader('X-Duplicadas', String(dups.size));
    res.setHeader('X-Warnings', encodeURIComponent(JSON.stringify(m.warns.concat(m.alerts)).slice(0, 3000)));
    res.send(out);
  } catch (e) { logErr('pdf', e); res.status(500).json({ error: 'No se pudo generar el PDF.' }); }
});

/* ---------- Administración ---------- */
const adm = [needUser, needAdmin, needFree];
const num2c = (v) => { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
web.get('/api/admin/users', adm, (req, res) => res.json({ users: q.all('SELECT * FROM users ORDER BY role, nombre').map(publicUser) }));
web.post('/api/admin/users', adm, (req, res) => {
  const b = req.body || {}; const username = String(b.username || '').trim().slice(0, 40);
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ error: 'Usuario: 3 a 40 letras, números, punto, guion.' });
  const nombre = String(b.nombre || '').trim().slice(0, 80), cargo = String(b.cargo || '').trim().slice(0, 80), role = b.role === 'admin' ? 'admin' : 'colaborador';
  const fondo = num2c(b.fondo); if (!nombre || !cargo) return res.status(400).json({ error: 'Nombre y cargo son obligatorios.' });
  if (fondo == null || (role === 'colaborador' && fondo <= 0)) return res.status(400).json({ error: 'Indica el monto del fondo fijo.' });
  const pr = A.passwordProblem(b.password); if (pr) return res.status(400).json({ error: pr });
  if (q.get('SELECT id FROM users WHERE username=?', username)) return res.status(409).json({ error: 'Ese usuario ya existe.' });
  q.run('INSERT INTO users(username,pass_hash,role,nombre,cargo,fondo_cents,must_change,created_at) VALUES(?,?,?,?,?,?,1,?)', username, A.hashPassword(b.password), role, nombre, cargo, fondo, Date.now());
  app.audit(req.user.username, 'crear_usuario', username + ' (' + role + ') fondo=' + fondo / 100); res.json({ ok: true });
});
web.patch('/api/admin/users/:id', adm, (req, res) => {
  const u = q.get('SELECT * FROM users WHERE id=?', +req.params.id); if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const b = req.body || {}; const set = [], val = [], log = [];
  if (b.nombre != null) { const v = String(b.nombre).trim().slice(0, 80); if (!v) return res.status(400).json({ error: 'Nombre vacío.' }); set.push('nombre=?'); val.push(v); log.push('nombre'); }
  if (b.cargo != null) { const v = String(b.cargo).trim().slice(0, 80); if (!v) return res.status(400).json({ error: 'Cargo vacío.' }); set.push('cargo=?'); val.push(v); log.push('cargo=' + v); }
  if (b.fondo != null) { const v = num2c(b.fondo); if (v == null) return res.status(400).json({ error: 'Fondo no válido.' }); set.push('fondo_cents=?'); val.push(v); log.push('fondo ' + u.fondo_cents / 100 + '→' + v / 100); }
  if (b.role != null) { if (u.id === req.user.id) return res.status(400).json({ error: 'No puedes cambiar tu propio rol.' }); set.push('role=?'); val.push(b.role === 'admin' ? 'admin' : 'colaborador'); log.push('rol'); }
  if (b.active != null) {
    if (u.id === req.user.id && !b.active) return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta.' });
    set.push('active=?'); val.push(b.active ? 1 : 0); log.push(b.active ? 'activar' : 'desactivar');
    if (!b.active) q.run('DELETE FROM sessions WHERE user_id=?', u.id);
  }
  if (b.password) { const pr = A.passwordProblem(b.password); if (pr) return res.status(400).json({ error: pr }); set.push('pass_hash=?', 'must_change=1'); val.push(A.hashPassword(b.password)); log.push('clave restablecida'); q.run('DELETE FROM sessions WHERE user_id=?', u.id); }
  if (!set.length) return res.json({ ok: true });
  q.run('UPDATE users SET ' + set.join(',') + ' WHERE id=?', ...val, u.id);
  if (!q.get("SELECT id FROM users WHERE role='admin' AND active=1")) { q.run('UPDATE users SET role=?, active=1 WHERE id=?', 'admin', req.user.id); }
  app.audit(req.user.username, 'editar_usuario', u.username + ': ' + log.join(', ')); res.json({ ok: true });
});
web.get('/api/admin/settings', adm, (req, res) => {
  const k = app.getSetting('api_key', '');
  res.json({ tarifa: tarifa(), model: app.getSetting('model', 'claude-sonnet-5-5'), api_key_set: !!k, api_key_tail: k ? k.slice(-4) : '', env_key: !!process.env.ANTHROPIC_API_KEY });
});
web.put('/api/admin/settings', adm, (req, res) => {
  const b = req.body || {};
  if (b.tarifa != null) { const t = parseFloat(b.tarifa); if (!(t > 0 && t < 1000)) return res.status(400).json({ error: 'Tarifa no válida.' }); const old = tarifa(); app.setSetting('tarifa', t); app.audit(req.user.username, 'tarifa', old + '→' + t); }
  if (b.model != null && /^[A-Za-z0-9._-]{3,80}$/.test(b.model)) app.setSetting('model', b.model);
  if (b.api_key != null && String(b.api_key).trim()) { app.setSetting('api_key', String(b.api_key).trim()); app.audit(req.user.username, 'api_key', 'actualizada'); }
  if (b.clear_api_key) { app.setSetting('api_key', ''); app.audit(req.user.username, 'api_key', 'borrada'); }
  res.json({ ok: true });
});
web.get('/api/admin/invoices', adm, (req, res) => res.json({ invoices: q.all('SELECT id,user_nombre,correlativo,rtn_emisor,numero,cai,fecha,total_cents,edited,created_at FROM invoices ORDER BY created_at DESC LIMIT 500').map((r) => ({ ...r, total: (r.total_cents / 100).toFixed(2), when: U.fmtDateTimeHN(r.created_at) })) }));
web.delete('/api/admin/invoices/:id', adm, (req, res) => { q.run('DELETE FROM invoices WHERE id=?', +req.params.id); app.audit(req.user.username, 'borrar_registro_factura', req.params.id); res.json({ ok: true }); });
web.get('/api/admin/audit', adm, (req, res) => res.json({ audit: q.all('SELECT * FROM audit ORDER BY id DESC LIMIT 200').map((r) => ({ ...r, when: U.fmtDateTimeHN(r.at) })) }));

web.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado.' }));
web.use((err, req, res, next) => { logErr(err.message); res.status(err.status || 500).json({ error: err.type === 'entity.too.large' ? 'El reporte es demasiado grande.' : 'Error del servidor.' }); });

const server = useHttps ? https.createServer({ key: fs.readFileSync(path.resolve(ROOT, cfg.https.key)), cert: fs.readFileSync(path.resolve(ROOT, cfg.https.cert)) }, web) : http.createServer(web);
server.requestTimeout = 120000;
if (require.main === module) {
  server.listen(cfg.port, cfg.host, () => console.log('Liquidación de gastos PBS en ' + (useHttps ? 'https' : 'http') + '://' + (cfg.host === '0.0.0.0' ? 'localhost' : cfg.host) + ':' + cfg.port));
}
module.exports = { server, app };
