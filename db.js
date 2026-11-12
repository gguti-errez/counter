'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'fondo-fijo.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','colaborador')),
      nombre TEXT NOT NULL DEFAULT '',
      cargo TEXT NOT NULL DEFAULT '',
      fondo_cents INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      must_change INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions(
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS invoices(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      user_nombre TEXT NOT NULL,
      report_key TEXT NOT NULL,
      correlativo TEXT NOT NULL DEFAULT '',
      rtn_emisor TEXT NOT NULL DEFAULT '',
      numero TEXT NOT NULL DEFAULT '',
      cai TEXT NOT NULL DEFAULT '',
      fecha TEXT NOT NULL DEFAULT '',
      total_cents INTEGER NOT NULL DEFAULT 0,
      img_hash TEXT NOT NULL DEFAULT '',
      edited INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_inv_num ON invoices(numero, rtn_emisor);
    CREATE INDEX IF NOT EXISTS ix_inv_img ON invoices(img_hash);
    CREATE INDEX IF NOT EXISTS ix_inv_created ON invoices(created_at);
    CREATE TABLE IF NOT EXISTS audit(
      id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT ''
    );
  `);
  const q = {
    get: (sql, ...a) => db.prepare(sql).get(...a),
    all: (sql, ...a) => db.prepare(sql).all(...a),
    run: (sql, ...a) => db.prepare(sql).run(...a),
  };
  const getSetting = (k, d) => { const r = q.get('SELECT value FROM settings WHERE key=?', k); return r ? r.value : d; };
  const setSetting = (k, v) => q.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
  const audit = (actor, action, detail) => q.run('INSERT INTO audit(at,actor,action,detail) VALUES(?,?,?,?)', Date.now(), actor, action, detail || '');
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  // secreto para firmar lecturas
  const secretFile = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  const secret = fs.readFileSync(secretFile, 'utf8').trim();
  return { db, q, getSetting, setSetting, audit, tx, secret };
}
module.exports = { open };
