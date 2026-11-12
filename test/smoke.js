'use strict';
// Prueba de humo: arranca el servidor en un directorio temporal y recorre permisos, duplicados y PDF.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-'));
process.env.FF_DATA = tmp; process.env.PORT = '0';
process.env.MOCK_READER = JSON.stringify({ fecha: '2026-11-03', total: 245, proveedor: 'Restaurante El Buen Sabor', concepto: 'alimentacion', rtn_cliente: '05019010314509', rtn_emisor: '08011990123456', numero: '000-001-01-00012345', cai: 'A1B2C3-D4E5F6', descripcion: 'Almuerzo en Puerto Cortés' });
const { server, app } = require('../server.js');
const img = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'factura.jpg')).toString('base64');
let base;
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: Object.assign({ 'content-type': 'application/json', origin: base }, cookie ? { cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
}
const pdfBody = (r, corr) => ({ cc: '', fechaRep: '2026-11-10', periodo: '2026-11-03', corr, boletas: '1', lugares: 'Puerto Cortés, San Pedro Sula', especificar: '', obs: '',
  nombre: 'HACKER', cargo: 'HACKER', fondo: '999999', tarifa: 1,
  inv: [{ seq: 1, fecha: '2026-11-03', cat: 'alimentacion' === 'x' ? '' : 'alim', otro: '', monto: '245.00', total: '245.00', rtn: '0501 9010 314509', desc: 'Almuerzo', img, w: 600, h: 900, numero: r.numero, cai: r.cai, rtn_emisor: r.rtn_emisor, token: r.token }] });
(async () => {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); base = 'http://127.0.0.1:' + server.address().port;
  const tempPw = /Clave temporal: (\S+)/.exec(fs.readFileSync(path.join(tmp, 'PRIMERA_CLAVE_ADMIN.txt'), 'utf8'))[1];
  const adm = client(), c1 = client(), c2 = client();
  assert.equal((await adm('POST', '/api/login', { username: 'admin', password: 'mala' })).status, 401);
  assert.equal((await adm('GET', '/api/admin/users')).status, 401);
  assert.equal((await adm('POST', '/api/login', { username: 'admin', password: tempPw })).status, 200);
  assert.equal((await adm('GET', '/api/admin/users')).status, 403, 'debe exigir cambio de clave');
  assert.equal((await adm('POST', '/api/password', { current: tempPw, next: 'corta' })).status, 400);
  assert.equal((await adm('POST', '/api/password', { current: tempPw, next: 'ClaveAdmin2026' })).status, 200);
  assert.equal((await adm('POST', '/api/admin/users', { username: 'ana', nombre: 'Ana López', cargo: 'Técnico de Servicio', fondo: '1500', password: 'temporal123' })).status, 200);
  assert.equal((await adm('POST', '/api/admin/users', { username: 'luis', nombre: 'Luis Pérez', cargo: 'Coordinador', fondo: '3000', password: 'temporal456' })).status, 200);
  // colaboradores
  for (const [c, u, p] of [[c1, 'ana', 'temporal123'], [c2, 'luis', 'temporal456']]) {
    assert.equal((await c('POST', '/api/login', { username: u, password: p })).status, 200);
    assert.equal((await c('POST', '/api/read', { img })).status, 403, 'bloqueado hasta cambiar clave');
    assert.equal((await c('POST', '/api/password', { current: p, next: p + 'X' })).status, 200);
  }
  const me = (await c1('GET', '/api/me')).body; assert.equal(me.user.nombre, 'Ana López'); assert.equal(me.user.fondo, '1500.00'); assert.equal(me.tarifa, 5.4);
  // permisos
  for (const [m, u, b] of [['GET', '/api/admin/users'], ['POST', '/api/admin/users', { username: 'x1x', nombre: 'a', cargo: 'b', fondo: 1, password: '12345678' }], ['PATCH', '/api/admin/users/2', { fondo: 99999 }], ['PUT', '/api/admin/settings', { tarifa: 1 }], ['GET', '/api/admin/settings'], ['GET', '/api/admin/invoices']])
    assert.equal((await c1(m, u, b)).status, 403, m + ' ' + u);
  assert.equal((await c1('POST', '/api/login', { username: 'ana', password: 'x' })).status, 401);
  // origen cruzado
  const bad = await fetch(base + '/api/logout', { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{}' }); assert.equal(bad.status, 403);
  // admin cambia fondo, cargo, tarifa
  assert.equal((await adm('PATCH', '/api/admin/users/2', { fondo: '1800', cargo: 'Técnico Senior' })).status, 200);
  assert.equal((await adm('PUT', '/api/admin/settings', { tarifa: '6' })).status, 200);
  const me2 = (await c1('GET', '/api/me')).body; assert.equal(me2.user.fondo, '1800.00'); assert.equal(me2.user.cargo, 'Técnico Senior'); assert.equal(me2.tarifa, 6);
  await adm('PUT', '/api/admin/settings', { tarifa: '5.4' });
  // lectura + primera descarga (Ana): sin duplicado
  const r1 = (await c1('POST', '/api/read', { img })).body; assert.equal(r1.numero, '000-001-01-00012345'); assert.equal(r1.dup, null);
  const p1 = await c1('POST', '/api/pdf', pdfBody(r1, '2/11/2026')); assert.equal(p1.status, 200, JSON.stringify(p1.body)); assert.equal(p1.headers.get('x-duplicadas'), '0');
  assert.match(p1.headers.get('content-disposition'), /Fondos_Fijos_Ana_Lopez_10_noviembre\.pdf/);
  fs.writeFileSync(path.join(tmp, 'ana.pdf'), p1.body);
  // Ana descarga otra vez el mismo reporte: reemplaza, no es duplicado
  const p1b = await c1('POST', '/api/pdf', pdfBody(r1, '2/11/2026')); assert.equal(p1b.headers.get('x-duplicadas'), '0');
  assert.equal(app.q.all('SELECT * FROM invoices').length, 1);
  // Luis usa la misma factura: aviso previo y marca en PDF
  const r2 = (await c2('POST', '/api/read', { img })).body; assert.ok(r2.dup, 'debe avisar duplicado'); assert.equal(r2.dup.who, 'Ana López'); assert.ok(r2.dup.match.includes('correlativo'));
  const p2 = await c2('POST', '/api/pdf', pdfBody(r2, '2/11/2026')); assert.equal(p2.status, 200); assert.equal(p2.headers.get('x-duplicadas'), '1');
  fs.writeFileSync(path.join(tmp, 'luis.pdf'), p2.body);
  // Luis intenta evadir editando correlativo/CAI/RTN: la imagen firmada lo delata igual
  const ev = pdfBody(r2, '3/11/2026'); ev.inv[0].numero = '999'; ev.inv[0].cai = 'ZZZ'; ev.inv[0].rtn_emisor = '1';
  const p3 = await c2('POST', '/api/pdf', ev); assert.equal(p3.headers.get('x-duplicadas'), '1', 'evasión detectada');
  // Sin token y con otro número pero misma imagen: también
  const ev2 = pdfBody({ numero: '555', cai: '', rtn_emisor: '', token: '' }, '4/11/2026'); const p4 = await c2('POST', '/api/pdf', ev2); assert.equal(p4.headers.get('x-duplicadas'), '1');
  // Vencimiento a 4 semanas
  app.q.run('UPDATE invoices SET created_at = ?', Date.now() - 29 * 86400000);
  const r5 = (await c2('POST', '/api/read', { img, corr: '9/9/2026' })).body; assert.equal(r5.dup, null, 'vencida a las 4 semanas');
  // Validaciones
  const bad2 = pdfBody(r1, '5/11/2026'); bad2.inv[0].monto = ''; assert.equal((await c1('POST', '/api/pdf', bad2)).status, 400);
  console.log('OK: todas las pruebas pasaron. PDFs en ' + tmp);
  server.close(); setTimeout(() => process.exit(0), 100);
})().catch((e) => { console.error('FALLÓ:', e); process.exit(1); });
