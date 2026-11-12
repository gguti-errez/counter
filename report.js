'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { jsPDF } = require('jspdf');
const U = require('./util');
const { cents, money, L, latin, dShort, dLong, parts, addDays, dow } = U;

const LOGO = fs.readFileSync(path.join(__dirname, '..', 'assets', 'logo.png')).toString('base64');
const CATS = [
  { id: 'hosp', name: 'Hospedaje', cuenta: '5651.0000', sub: 1, g: 'Viáticos', n: '1 Hospedaje' },
  { id: 'alim', name: 'Alimentación', cuenta: '5224.0000', sub: 1, g: 'Viáticos', n: '2 Alimentación' },
  { id: 'taxi', name: 'Taxis / Bus / Uber', cuenta: '5224.0000', sub: 1, g: '', n: 'Taxis / Bus / Uber' },
  { id: 'comb', name: 'Combustible', cuenta: '5643.0000', sub: 1, g: '', n: 'Combustible' },
  { id: 'peaj', name: 'Peajes (Ferrys)', cuenta: '5651.0000', sub: 1, g: '', n: 'Peajes (Ferrys)' },
  { id: 'parq', name: 'Parqueo', cuenta: '5642.0000', sub: 1, g: '', n: 'Parqueo' },
  { id: 'recg', name: 'Recarga electrónica', cuenta: '5642.0000', sub: 1, g: '', n: 'Recarga Electrónica' },
  { id: 'repu', name: 'Repuestos', cuenta: '5311.0000', sub: 5, g: '', n: 'Repuestos' },
  { id: 'herr', name: 'Herramienta (Otros)', cuenta: '5311.0000', sub: 5, g: '', n: '2 Herramienta (Otros)' },
];
const MAXD = 10, CC_DEF = '66200', RTN_OK = '05019010314509', RTN_TXT = '0501 9010 314509';
const catRow = (id) => (id === 'otro' ? 'herr' : id);
const catName = (it) => {
  if (it.cat === 'otro') return 'Otro gasto' + (it.otro ? ': ' + it.otro : '');
  const c = CATS.find((x) => x.id === it.cat); return c ? c.name : '';
};
const str = (v, max) => String(v == null ? '' : v).slice(0, max || 500);

/** Arma el modelo del reporte. Nombre, cargo, fondo y tarifa vienen SIEMPRE de la cuenta y la configuración, nunca del cliente. */
function buildModel(body, user, tarifa) {
  const problems = [], warns = [], alerts = [];
  const rate = tarifa > 0 ? tarifa : 5.4;
  const kmOf = (c) => Math.round((c / 100) / rate * 10) / 10;
  const f = {
    nombre: user.nombre, cargo: user.cargo,
    cc: str(body.cc, 20).trim() || CC_DEF,
    fechaRep: str(body.fechaRep, 10), periodo: str(body.periodo, 10), corr: str(body.corr, 30).trim(),
    boletas: str(body.boletas, 6), lugares: str(body.lugares, 400).trim(), especificar: str(body.especificar, 400).trim(), obs: str(body.obs, 600).trim(),
  };
  if (!parts(f.fechaRep)) problems.push('Falta la fecha del reporte.');
  if (!f.periodo) f.periodo = U.autoStart(f.fechaRep);
  if (!f.corr) f.corr = U.autoCorr(f.fechaRep);
  f.periodoFin = f.periodo ? addDays(f.periodo, 7) : '';
  const list = Array.isArray(body.inv) ? body.inv : [];
  if (list.length > 60) problems.push('Demasiadas facturas en un solo reporte (máximo 60).');
  const valid = [];
  list.slice(0, 60).forEach((raw, i) => {
    const it = {
      n: i + 1, seq: Number(raw.seq) || i + 1,
      fecha: str(raw.fecha, 10), cat: str(raw.cat, 8), otro: str(raw.otro, 80).trim(), monto: raw.monto, total: raw.total,
      rtn: str(raw.rtn, 30), desc: str(raw.desc, 400).trim(), data: str(raw.img, 4e6),
      numero: str(raw.numero, 40).trim(), cai: str(raw.cai, 60).trim(), rtn_emisor: str(raw.rtn_emisor, 30).trim(), token: str(raw.token, 4000),
      w: Number(raw.w) || 0, h: Number(raw.h) || 0,
    };
    it.n = it.seq;
    const c = cents(it.monto);
    if (!c && !it.fecha && !it.cat) { warns.push('Factura ' + it.n + ': sin datos, no se incluye.'); return; }
    const d = U.digits(it.rtn);
    if (!d) alerts.push('Factura ' + it.n + ': no se encontró el RTN del cliente. Debe ser ' + RTN_TXT + '.');
    else if (d !== RTN_OK) alerts.push('Factura ' + it.n + ': el RTN de la factura no coincide con ' + RTN_TXT + '.');
    const miss = [];
    if (!parts(it.fecha)) miss.push('la fecha'); if (!it.cat || (it.cat !== 'otro' && !CATS.find((x) => x.id === it.cat))) miss.push('el concepto'); if (c <= 0) miss.push('el monto');
    if (it.cat === 'otro' && !it.otro) miss.push('qué gasto es');
    if (miss.length) { problems.push('Factura ' + it.n + ': falta ' + miss.join(', ') + '.'); return; }
    if (!/^data:image\/jpeg;base64,/.test(it.data) || !it.w || !it.h) { problems.push('Factura ' + it.n + ': falta la imagen.'); return; }
    valid.push({ it, fecha: it.fecha, row: catRow(it.cat), cat: it.cat, c, n: it.n });
  });
  if (!valid.length && !problems.length) problems.push('No hay facturas para liquidar.');
  if (f.periodo && dow(f.periodo) !== 2) warns.push('El período debe empezar en martes (va de martes a martes).');
  if (f.periodo) valid.forEach((v) => { if (v.fecha < f.periodo || v.fecha > f.periodoFin) warns.push('Factura ' + v.n + ': la fecha ' + dShort(v.fecha) + ' queda fuera del período (' + dShort(f.periodo) + ' al ' + dShort(f.periodoFin) + ').'); });
  const dates = Array.from(new Set(valid.map((v) => v.fecha))).sort();
  if (dates.length > MAXD) problems.push('Hay ' + dates.length + ' fechas distintas y el formato admite ' + MAXD + '. Divide el reporte en dos.');
  const mx = {}; CATS.forEach((c) => { mx[c.id] = {}; });
  const dayT = {}, catT = {}; let total = 0;
  valid.forEach((v) => { mx[v.row][v.fecha] = (mx[v.row][v.fecha] || 0) + v.c; dayT[v.fecha] = (dayT[v.fecha] || 0) + v.c; catT[v.row] = (catT[v.row] || 0) + v.c; total += v.c; });
  const fondo = user.fondo_cents, fuel = catT.comb || 0;
  return { valid, dates, mx, dayT, catT, total, fuel, km: kmOf(fuel), kmOf, rate, fondo, saldo: fondo - total,
    ratio: fondo > 0 ? Math.round(((fondo - total) / fondo) * 100) / 100 : null, problems, warns, alerts, f };
}

function fname(m, nowIso) {
  const p = parts(m.f.fechaRep) || parts(nowIso);
  const fecha = String(p.d).padStart(2, '0') + '_' + U.MESES_L[p.m - 1];
  const n = (m.f.nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return 'Fondos_Fijos_' + (n ? n + '_' : '') + fecha + '.pdf';
}

/** dups: Map de factura(n) -> {when, who, corr, fecha, total, sameCai, sameImage} */
function buildPdf(m, dups) {
  dups = dups || new Map();
  const d = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const K = 792 / 1210, P = (v) => v * K, gray = [217, 217, 217];
  d.setDrawColor(0, 0, 0); d.setTextColor(0, 0, 0);
  const ln = (x1, y1, x2, y2, w) => { d.setLineWidth(w || 0.6); d.line(P(x1), P(y1), P(x2), P(y2)); };
  const box = (x, y, w, h, fill) => { d.setLineWidth(0.6); if (fill) { d.setFillColor(fill[0], fill[1], fill[2]); d.rect(P(x), P(y), P(w), P(h), 'FD'); } else d.rect(P(x), P(y), P(w), P(h), 'S'); };
  const tx = (s, x, y, o) => { o = o || {}; d.setFont('helvetica', o.b ? 'bold' : 'normal'); d.setFontSize(o.s || 7); d.text(latin(s), P(x), P(y), { align: o.a || 'left', baseline: 'middle' }); };
  const wrap = (s, w, size) => { d.setFont('helvetica', 'normal'); d.setFontSize(size); return d.splitTextToSize(latin(s), P(w)); };
  const f = m.f;

  box(78, 83, 1054, 189);
  d.addImage('data:image/png;base64,' + LOGO, 'PNG', P(80), P(86), P(66), P(70));
  box(148, 96, 797, 14, gray); tx('REPORTE DE GASTOS PBS HONDURAS', 546, 103, { b: 1, s: 8, a: 'center' });
  box(945, 96, 187, 14, gray); tx('Correlativo N°', 1038, 103, { b: 1, s: 8, a: 'center' }); tx(f.corr, 1038, 117, { b: 1, s: 7.5, a: 'center' });
  ln(945, 124, 1132, 124); ln(945, 83, 945, 148); ln(148, 124, 945, 124); ln(148, 148, 1132, 148); ln(148, 163, 598, 163);
  tx('Monto Fondo Fijo Lps', 208, 136, { b: 1, s: 6.8, a: 'center' }); ln(268, 124, 268, 148); ln(482, 124, 482, 148);
  tx('L', 274, 136, { b: 1 }); tx(money(m.fondo), 440, 136, { b: 1, s: 7.5, a: 'right' });
  tx('Período del:', 673, 136, { b: 1, s: 7.5 }); tx(f.periodo ? dLong(f.periodo) + ' al ' + dLong(f.periodoFin) : '', 840, 136, { b: 1, s: 7.5, a: 'center' }); ln(660, 124, 660, 148);
  tx(dShort(f.fechaRep), 1038, 136, { b: 1, s: 7.5, a: 'center' });
  tx('Centro de Costo N°', 209, 156, { b: 1, s: 7, a: 'center' }); ln(270, 148, 270, 163); ln(538, 148, 538, 163); tx(f.cc, 395, 156, { b: 1, s: 7.5, a: 'center' });
  tx('Lugares', 628, 156, { b: 1, s: 7, a: 'center' }); tx('Visitados:', 628, 177, { b: 1, s: 7, a: 'center' });
  const lug = wrap(f.lugares, 455, 7).slice(0, 3);
  lug.forEach((t, i) => { d.setFont('helvetica', 'normal'); d.setFontSize(7); d.text(t, P(666), P(168 + (i - (lug.length - 1) / 2) * 14), { baseline: 'middle' }); });
  ln(598, 148, 598, 209); ln(660, 148, 660, 187);
  tx('Nombre:', 80, 178, { b: 1, s: 7.5 }); tx(f.nombre, 150, 178, { s: 7 });
  tx('Cargo:', 80, 203, { b: 1, s: 7.5 }); tx(f.cargo, 150, 203, { s: 7 });
  tx('KM. REC', 878, 203, { b: 1, s: 5.5 }); tx(m.fuel ? m.km.toFixed(1) : '0.0', 1038, 203, { s: 8, a: 'center' });
  ln(78, 187, 1132, 187); ln(945, 187, 945, 209); ln(78, 209, 1132, 209); ln(78, 223, 1132, 223);
  tx('N° Boletas:', 629, 216, { b: 1, s: 7, a: 'center' }); tx(f.boletas || '', 666, 216, { s: 7.5 });
  tx('Especificar gastos:', 80, 229, { b: 1, s: 7.5 });
  wrap(f.especificar, 900, 7).slice(0, 2).forEach((t, i) => { d.setFont('helvetica', 'normal'); d.setFontSize(7); d.text(t, P(212), P(229 + i * 13), { baseline: 'middle' }); });
  ln(148, 248, 1132, 248); ln(148, 261, 1132, 261);

  const X0 = 78, XC = 270, XS = 340, XD = 366, XT = 945, XE = 1132, DW = (XT - XD) / MAXD;
  const y0 = 278, yh = 318, RH = 13.5, nR = CATS.length;
  tx('Uso', 305, 284, { b: 1, s: 7, a: 'center' }); tx('Contabilidad', 305, 296, { b: 1, s: 6.2, a: 'center' });
  tx('Cuenta', 305, 312, { b: 1, s: 7, a: 'center' }); tx('Sub', 353, 312, { b: 1, s: 7, a: 'center' });
  box(80, 291, 188, 15, gray); tx('CLASIFICACION DE GASTOS', 174, 298.5, { b: 1, s: 7.5, a: 'center' });
  box(XT, y0, XE - XT, 40, gray); tx('Total de Gastos por Concepto', (XT + XE) / 2, 298, { b: 1, s: 7.5, a: 'center' });
  for (let i = 0; i < MAXD; i++) { const cx = XD + i * DW + DW / 2; tx('Fecha', cx, 284, { b: 1, s: 6.5, a: 'center' }); if (m.dates[i]) tx(dShort(m.dates[i]), cx, 297, { s: 6.5, a: 'center' }); }
  const yEnd = yh + RH * nR, yTot = yEnd + 13.5;
  box(XC, y0, XS - XC, 40); box(XS, y0, XD - XS, 40);
  for (let i = 0; i <= MAXD; i++) ln(XD + i * DW, y0, XD + i * DW, yTot);
  ln(XC, yh, XC, yEnd); ln(XS, yh, XS, yEnd); ln(XT, yh, XT, yTot); ln(XE, y0, XE, yTot);
  ln(X0, yh, XE, yh); ln(X0, yTot, XE, yTot); ln(X0, y0, X0, yTot);
  for (let i = 1; i <= nR; i++) ln(X0, yh + RH * i, XE, yh + RH * i, 0.4);
  CATS.forEach((c, r) => {
    const yy = yh + RH * r + RH / 2;
    if (c.id === 'hosp') tx('Viaticos', 80, yy, { b: 1, s: 7 });
    if (c.id === 'taxi') { tx('Taxis', 108, yy, { b: 1, s: 7, a: 'center' }); tx('Bus', 168, yy, { b: 1, s: 7, a: 'center' }); tx('Uber', 236, yy, { b: 1, s: 7, a: 'center' }); ln(148, yh + RH * r, 148, yh + RH * (r + 1), 0.4); ln(210, yh + RH * r, 210, yh + RH * (r + 1), 0.4); }
    else if (c.g) tx(c.n, c.id === 'hosp' ? 137 : 124, yy, { b: 1, s: 7 });
    else if (c.id === 'repu') tx('Repuestos   1', 80, yy, { b: 1, s: 7 });
    else if (c.id === 'herr') tx(c.n, 124, yy, { b: 1, s: 7 });
    else tx(c.n, 80, yy, { b: 1, s: 7 });
    tx(c.cuenta, 305, yy, { b: 1, s: 7, a: 'center' }); tx(String(c.sub), 353, yy, { b: 1, s: 7, a: 'center' });
    m.dates.forEach((dt, k) => { const v = m.mx[c.id][dt] || 0; if (v) tx(L(v), XD + k * DW + DW / 2, yy, { s: 6.2, a: 'center' }); });
    const t = m.catT[c.id] || 0; tx('L.', XT + 4, yy, { s: 7 }); tx(t ? money(t) : '-', XE - 4, yy, { s: 7, a: 'right' });
  });
  const yy2 = yEnd + 6.75;
  tx('Total de Gastos por Día:', 338, yy2, { b: 1, s: 7.5, a: 'right' });
  for (let i = 0; i < MAXD; i++) tx(L(m.dates[i] ? (m.dayT[m.dates[i]] || 0) : 0), XD + i * DW + DW / 2, yy2, { s: 6.2, a: 'center' });
  tx('L.', XT + 4, yy2, { s: 7 }); tx(money(m.total), XE - 4, yy2, { s: 7, a: 'right' });

  const tb = [['Total de gastos', money(m.total)], ['Monto fondo fijo', money(m.fondo)], ['Saldo (fondo - gastos)', money(m.saldo)], ['Saldo ÷ fondo', m.ratio == null ? '-' : (m.ratio < 0 ? '-' : '') + Math.abs(m.ratio).toFixed(2)]];
  tb.forEach((r, k) => { const by = 467 + k * 15; box(XT, by, XE - XT, 15); tx(r[0], XT - 6, by + 7.5, { s: 6.5, a: 'right' }); tx('L.', XT + 4, by + 7.5, { b: 1, s: 7.5 }); tx(r[1], XE - 4, by + 7.5, { b: 1, s: 8, a: 'right' }); });

  ln(78, 530, 238, 530); tx('Firma Responsable Fondo Fijo', 158, 540, { s: 7, a: 'center' });
  ln(590, 533, 945, 533); tx('Nombre y Firma Jefe de Área/Coordinador Servicio Técnico', 767, 543, { s: 7, a: 'center' });
  ln(596, 586, 945, 586); tx('Nombre y Firma Jefe Area/Gerente', 770, 596, { s: 7, a: 'center' });
  tx('Honduras', 80, 580, { s: 7 }); tx(dShort(f.fechaRep), 172, 580, { s: 7, a: 'center' }); tx('Lugar y Fecha:', 126, 592, { b: 1, s: 7, a: 'center' });
  tx('Nota:', 80, 632, { b: 1, s: 7 }); tx('Todo gasto en el que se incurra deberá declararse por dia', 112, 632, { s: 7 });
  tx('El correlativo corresponde a la semana del mes, el mes y el año.', 80, 645, { s: 7 });
  box(78, 680, 1054, 40); ln(212, 693, 1132, 693, 0.4); ln(212, 706, 1132, 706, 0.4); tx('Observaciones:', 80, 686, { b: 1, s: 7.5 });
  wrap(f.obs, 900, 7).slice(0, 3).forEach((t, k) => { d.setFont('helvetica', 'normal'); d.setFontSize(7); d.text(t, P(212), P(686 + k * 13), { baseline: 'middle' }); });

  const sorted = m.valid.slice().sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.n - b.n));
  sorted.forEach((v, idx) => {
    const it = v.it;
    d.addPage('letter', 'portrait');
    d.setTextColor(90, 90, 90); d.setFont('helvetica', 'normal'); d.setFontSize(8);
    d.text('Reporte de gastos PBS Honduras  ·  Correlativo ' + latin(f.corr) + '  ·  Soporte ' + (idx + 1) + ' de ' + sorted.length, 30, 26);
    d.setTextColor(0, 0, 0);
    const bw = 300, bh = 715, s = Math.min(bw / it.w, bh / it.h), w = it.w * s, h = it.h * s;
    d.addImage(it.data, 'JPEG', 30, 40, w, h, undefined, 'FAST');
    d.setDrawColor(200, 200, 200); d.setLineWidth(0.5); d.rect(30, 40, w, h, 'S'); d.setDrawColor(0, 0, 0);
    const rows = [['RESPONSABLE', f.nombre || '-'], ['CONCEPTO', catName(it)], ['DESCRIPCIÓN', it.desc || '-'], ['VALOR', L(v.c)], ['FECHA', dLong(v.fecha)]];
    const tot = cents(it.total);
    if (tot > 0 && tot !== v.c) rows.splice(4, 0, ['TOTAL FACTURA', L(tot)]);
    if (v.cat === 'comb') rows.push(['KILOMETRAJE', m.kmOf(v.c).toFixed(1) + ' km (L. ' + m.rate.toFixed(2) + ' por km)']);
    const tx0 = 345, tw = 237, lw = 82; let y = 60;
    rows.forEach((r) => {
      d.setFont('helvetica', 'normal'); d.setFontSize(10);
      const lines = d.splitTextToSize(latin(r[1]), tw - lw - 12);
      const rh = Math.max(30, lines.length * 13 + 14);
      d.setLineWidth(0.6); d.setDrawColor(0, 0, 0); d.rect(tx0, y, lw, rh, 'S'); d.rect(tx0 + lw, y, tw - lw, rh, 'S');
      d.setFont('helvetica', 'bold'); d.setFontSize(r[0].length > 11 ? 7.5 : 8.5); d.text(latin(r[0]), tx0 + lw / 2, y + rh / 2, { align: 'center', baseline: 'middle' });
      d.setFont('helvetica', r[0] === 'VALOR' ? 'bold' : 'normal'); d.setFontSize(10);
      d.text(lines, tx0 + lw + (tw - lw) / 2, y + rh / 2 - ((lines.length - 1) * 13) / 2, { align: 'center', baseline: 'middle', lineHeightFactor: 1.3 });
      y += rh;
    });
    const du = dups.get(it.n);
    if (du) {
      // Marca de agua discreta al pie de la página
      d.setDrawColor(190, 190, 190); d.setLineWidth(0.4); d.line(30, 762, 582, 762); d.setDrawColor(0, 0, 0);
      d.setTextColor(150, 150, 150); d.setFont('helvetica', 'bold'); d.setFontSize(7);
      d.text('FACTURA DUPLICADA', 30, 770);
      d.setFont('helvetica', 'normal'); d.setFontSize(6.5);
      const msg = 'Esta factura ya fue utilizada el ' + du.when + ' por ' + du.who + ' (correlativo ' + (du.corr || '-') + ', fecha ' + (dLong(du.fecha) || '-') + ', monto ' + L(du.total) + '). ' +
        'Coincide: ' + du.match.join(', ') + '.';
      d.text(d.splitTextToSize(latin(msg), 552).slice(0, 2), 30, 778);
      d.setTextColor(0, 0, 0);
    }
  });
  return d;
}
module.exports = { buildModel, buildPdf, fname, CATS, CC_DEF, RTN_OK, RTN_TXT };
