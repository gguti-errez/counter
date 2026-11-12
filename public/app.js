(function () {
  var MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  var CATS = [
    { id: "hosp", name: "Hospedaje",           cuenta: "5651.0000", sub: 1, g: "Viáticos", n: "1 Hospedaje" },
    { id: "alim", name: "Alimentación",        cuenta: "5224.0000", sub: 1, g: "Viáticos", n: "2 Alimentación" },
    { id: "taxi", name: "Taxis / Bus / Uber",  cuenta: "5224.0000", sub: 1, g: "", n: "Taxis / Bus / Uber" },
    { id: "comb", name: "Combustible",         cuenta: "5643.0000", sub: 1, g: "", n: "Combustible" },
    { id: "peaj", name: "Peajes (Ferrys)",     cuenta: "5651.0000", sub: 1, g: "", n: "Peajes (Ferrys)" },
    { id: "parq", name: "Parqueo",             cuenta: "5642.0000", sub: 1, g: "", n: "Parqueo" },
    { id: "recg", name: "Recarga electrónica", cuenta: "5642.0000", sub: 1, g: "", n: "Recarga Electrónica" },
    { id: "repu", name: "Repuestos",           cuenta: "5311.0000", sub: 5, g: "", n: "Repuestos" },
    { id: "herr", name: "Herramienta (Otros)", cuenta: "5311.0000", sub: 5, g: "", n: "2 Herramienta (Otros)" }
  ];
  var READ_MAP = { alimentacion: "alim", combustible: "comb", hospedaje: "hosp", transporte: "taxi", peajes: "peaj", parqueo: "parq", recarga: "recg", repuestos: "repu", herramienta: "herr", otro: "otro" };
  var MAXD = 10;
  var $ = function (id) { return document.getElementById(id); };
  var uid = 0;
  var state = { inv: [], seq: 0, periodoTouched: false, corrTouched: false, boletasTouched: false };
  var queue = [], running = 0, me = null;

  function tryNow() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function parts(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; }
  function dShort(iso) { var p = parts(iso); return p ? p.d + "-" + MESES[p.m - 1] + "-" + String(p.y).slice(2) : ""; }
  function dLong(iso) { var p = parts(iso); return p ? String(p.d).padStart(2, "0") + "/" + String(p.m).padStart(2, "0") + "/" + p.y : ""; }
  function autoCorr(iso) { var p = parts(iso); return p ? Math.ceil(p.d / 7) + "/" + p.m + "/" + p.y : ""; }
  function addDays(iso, n) { var p = parts(iso); if (!p) return ""; var t = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return t.getUTCFullYear() + "-" + String(t.getUTCMonth() + 1).padStart(2, "0") + "-" + String(t.getUTCDate()).padStart(2, "0"); }
  function dow(iso) { var p = parts(iso); return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() : -1; }
  function autoStart(rep) { if (!parts(rep)) return ""; var back = (dow(rep) - 2 + 7) % 7; return addDays(rep, -back - 7); }
  function cents(v) { var n = parseFloat(String(v == null ? "" : v).replace(/,/g, "")); return isFinite(n) ? Math.round(n * 100) : 0; }
  function money(c) { var neg = c < 0; var a = Math.abs(c); return (neg ? "-" : "") + Math.floor(a / 100).toLocaleString("en-US") + "." + String(a % 100).padStart(2, "0"); }
  function L(c) { return "L. " + money(c); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function latin(s) { return String(s == null ? "" : s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF]/g, ""); }
  var CC_DEF = "66200", RTN_OK = "05019010314509", RTN_TXT = "0501 9010 314509";
  function fmtRtn(x) { var d = String(x == null ? "" : x).replace(/\D/g, ""); return d.length === 14 ? d.slice(0, 4) + " " + d.slice(4, 8) + " " + d.slice(8) : String(x == null ? "" : x).trim(); }
  function rtnState(it) {
    if (it.st === "queued" || it.st === "reading") return null;
    var d = String(it.rtn || "").replace(/\D/g, "");
    if (!d) return { ok: false, msg: "No se encontró el RTN del cliente en la factura. Debe ser " + RTN_TXT + "." };
    if (d !== RTN_OK) return { ok: false, msg: "El RTN de la factura (" + fmtRtn(it.rtn) + ") no coincide con " + RTN_TXT + "." };
    return { ok: true, msg: "" };
  }
  function rate() { var r = parseFloat($("tarifa").value); return isFinite(r) && r > 0 ? r : 5.4; }
  function kmOf(c) { return Math.round((c / 100) / rate() * 10) / 10; }
  function kmStr(k) { return k.toFixed(1); }
  function catRow(id) { return id === "otro" ? "herr" : id; }
  function catName(it) {
    if (it.cat === "otro") return "Otro gasto" + (it.otro ? ": " + it.otro : "");
    var c = CATS.filter(function (x) { return x.id === it.cat; })[0]; return c ? c.name : "";
  }

  /* ---------- Imágenes ---------- */
  function canvasToItem(canvas) {
    return new Promise(function (res, rej) {
      var max = 1600, w = canvas.width, h = canvas.height, s = Math.min(1, max / Math.max(w, h));
      var c = document.createElement("canvas"); c.width = Math.round(w * s); c.height = Math.round(h * s);
      var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(canvas, 0, 0, c.width, c.height);
      c.toBlob(function (b) { if (!b) return rej(new Error("toBlob")); res({ blob: b, data: c.toDataURL("image/jpeg", 0.85), w: c.width, h: c.height }); }, "image/jpeg", 0.85);
    });
  }
  function fileToCanvas(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () { var c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext("2d").drawImage(im, 0, 0); URL.revokeObjectURL(url); res(c); };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error("img")); };
      im.src = url;
    });
  }
  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(new Error("script")); }; document.head.appendChild(s); });
  }
  var PDFJS = "/vendor/";
  function pdfPages(file) {
    return (window.pdfjsLib ? Promise.resolve() : loadScript(PDFJS + "pdf.min.js")).then(function () {
      return window.pdfjsWorker ? null : loadScript(PDFJS + "pdf.worker.min.js");
    }).then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
      return file.arrayBuffer();
    }).then(function (buf) { return window.pdfjsLib.getDocument({ data: buf }).promise; }).then(function (doc) {
      var out = [], chain = Promise.resolve();
      for (var i = 1; i <= doc.numPages; i++) (function (n) {
        chain = chain.then(function () { return doc.getPage(n); }).then(function (pg) {
          var vp = pg.getViewport({ scale: 2 }), c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
          return pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise.then(function () { out.push(c); });
        });
      })(i);
      return chain.then(function () { return out; });
    });
  }
  function newInv(o) { return Object.assign({ id: ++uid, data: "", blob: null, w: 0, h: 0, fecha: "", cat: "", otro: "", rtn: "", total: "", monto: "", desc: "", numero: "", cai: "", rtn_emisor: "", token: "", dup: null, st: "idle", note: "" }, o || {}); }

  function addFiles(files) {
    Array.prototype.forEach.call(files, function (f) {
      var isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      var p = isPdf ? pdfPages(f) : fileToCanvas(f).then(function (c) { return [c]; });
      p.then(function (cvs) {
        return cvs.reduce(function (ch, c) {
          return ch.then(function () { return canvasToItem(c); }).then(function (r) {
            var it = newInv({ data: r.data, blob: r.blob, w: r.w, h: r.h, st: "queued" });
            it.seq = ++state.seq; state.inv.unshift(it); renderCards(); update(); enqueue(it);
          });
        }, Promise.resolve());
      }).catch(function () {
        var it = newInv({ st: "err", note: "No se pudo abrir " + f.name + ". Prueba con una foto JPG o PNG." });
        it.seq = ++state.seq; state.inv.unshift(it); renderCards(); update();
      });
    });
  }

  /* ---------- Lectura con Claude (en el servidor) ---------- */
  function enqueue(it) { queue.push(it); pump(); }
  function pump() {
    while (running < 2 && queue.length) { (function (it) { running++; readInv(it).then(function () { running--; pump(); }); })(queue.shift()); }
  }
  function api(method, url, body) {
    return fetch(url, { method: method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && url !== "/api/login") { showLogin(); }
        if (r.status === 403 && j.must_change) { showPw(true); }
        if (!r.ok) { var e = new Error(j.error || "Error " + r.status); e.status = r.status; e.body = j; throw e; }
        return j;
      });
    });
  }
  function readInv(it) {
    it.st = "reading"; it.note = ""; renderCard(it); update();
    return api("POST", "/api/read", { img: it.data, corr: $("corr").value.trim(), periodo: $("periodo").value }).then(function (r) {
      var okF = /^\d{4}-\d{2}-\d{2}$/.test(r.fecha || ""), okT = typeof r.total === "number" && r.total > 0;
      if (okF) it.fecha = r.fecha;
      if (okT) { it.total = r.total.toFixed(2); it.monto = r.total.toFixed(2); }
      var cat = READ_MAP[String(r.concepto || "").toLowerCase()];
      if (cat) it.cat = cat;
      if (it.cat === "otro" && !it.otro) it.otro = String(r.proveedor || "").slice(0, 60);
      it.desc = String(r.descripcion || "").slice(0, 300);
      if (r.rtn_cliente) it.rtn = fmtRtn(r.rtn_cliente);
      it.numero = r.numero || ""; it.cai = r.cai || ""; it.rtn_emisor = r.rtn_emisor ? fmtRtn(r.rtn_emisor) : ""; it.token = r.token || ""; it.dup = r.dup || null;
      var miss = []; if (!okF) miss.push("la fecha"); if (!okT) miss.push("el monto"); if (!cat) miss.push("el concepto");
      if (miss.length) { it.st = "review"; it.note = "No se leyó con claridad " + miss.join(", ") + ". Complétalo."; } else { it.st = "ok"; it.note = "Leída. Revisa los datos antes de descargar."; }
      if (it.dup) { it.st = "review"; it.note = "Posible factura duplicada."; }
    }).catch(function (e) {
      it.st = "manual";
      it.note = (e && e.body && e.body.code === "no_key") ? "La lectura automática no está configurada. Escribe fecha y monto." : ((e && e.message) || "No se pudo leer la factura") + ". Escribe los datos o usa «Leer de nuevo».";
    }).then(function () { renderCard(it); update(); });
  }

  function blank() {
    state.inv = []; queue = [];
    ["lugares", "especificar", "obs"].forEach(function (k) { $(k).value = ""; });
    $("cc").value = CC_DEF; state.periodoTouched = false;
    $("fechaRep").value = tryNow(); state.corrTouched = false; state.boletasTouched = false;
    renderCards(); update();
  }

  /* ---------- Tarjetas de factura ---------- */
  function catOpts(sel) {
    return '<option value="">Elegir concepto</option>' + CATS.map(function (c) { return '<option value="' + c.id + '"' + (c.id === sel ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("") +
      '<option value="otro"' + (sel === "otro" ? " selected" : "") + ">Otro gasto (especificar)</option>";
  }
  var ST = { idle: ["", ""], queued: ["En cola", ""], reading: ["Leyendo factura…", ""], ok: ["Leída", "ok"], review: ["Revisar", "warn"], manual: ["Captura manual", "warn"], err: ["Error", "err"] };
  function cardHtml(it, n) {
    var st = ST[it.st] || ST.idle;
    return '<div class="card" data-id="' + it.id + '">' +
      (it.data ? '<img class="thumb" alt="Factura ' + n + '" src="' + it.data + '">' : '<div class="thumb"></div>') +
      '<div class="cbody">' +
      '<div class="chead"><b>Factura ' + n + '</b><span class="pill ' + st[1] + '" data-role="pill">' + esc(st[0]) + '</span><span class="hint" data-role="note">' + esc(it.note) + '</span>' +
      '<span class="sp"><button type="button" class="btn small" data-act="reread"' + (it.blob ? "" : " disabled") + '>Leer de nuevo</button><button type="button" class="btn small" data-act="rm">Quitar</button></span></div>' +
      '<div class="cgrid">' +
      '<div class="f"><label>Fecha</label><input type="date" data-k="fecha" value="' + esc(it.fecha) + '"></div>' +
      '<div class="f"><label>Concepto</label><select data-k="cat">' + catOpts(it.cat) + '</select></div>' +
      '<div class="f"><label>Monto a liquidar (L.)</label><input type="number" step="0.01" min="0" inputmode="decimal" data-k="monto" value="' + esc(it.monto) + '"></div>' +
      '<div class="f w6" data-role="otro"' + (it.cat === "otro" ? "" : " hidden") + '><label>Especificar el gasto</label><input type="text" data-k="otro" autocomplete="off" value="' + esc(it.otro) + '"></div>' +
      '<div class="f w3"><label>RTN del cliente en la factura</label><input type="text" data-k="rtn" inputmode="numeric" autocomplete="off" value="' + esc(it.rtn) + '"></div>' +
      '<div class="f w3"><label>RTN del emisor</label><input type="text" data-k="rtn_emisor" inputmode="numeric" autocomplete="off" value="' + esc(it.rtn_emisor) + '"></div>' +
      '<div class="f w3"><label>N° / correlativo de la factura</label><input type="text" data-k="numero" autocomplete="off" value="' + esc(it.numero) + '"></div>' +
      '<div class="f w3"><label>CAI</label><input type="text" data-k="cai" autocomplete="off" value="' + esc(it.cai) + '"></div>' +
      '<div class="f w6"><label>Descripción del gasto</label><textarea data-k="desc" rows="2">' + esc(it.desc) + '</textarea></div>' +
      '</div><div data-role="extra"></div></div></div>';
  }
  function extraHtml(it) {
    var h = "", rs = rtnState(it);
    if (it.dup) h += '<div class="diff dupbad">Posible factura duplicada: ya se usó el ' + esc(it.dup.when) + ' por ' + esc(it.dup.who) + ' (coincide: ' + esc(it.dup.match.join(", ")) + '). Si la descargas, el PDF llevará un aviso al pie de su página.</div>';
    if (rs) h += rs.ok ? '<div class="kmnote">RTN correcto (' + RTN_TXT + ')</div>' : '<div class="diff rtnbad">' + esc(rs.msg) + "</div>";
    var tot = cents(it.total), m = cents(it.monto);
    if (tot > 0 && m > 0 && tot !== m) h += '<div class="diff">La factura dice ' + L(tot) + '; se liquidan ' + L(m) + '. El PDF muestra ambos montos.</div>';
    if (it.cat === "comb" && m > 0) h += '<div class="kmnote">' + kmStr(kmOf(m)) + ' km a L. ' + rate().toFixed(2) + ' por km</div>';
    return h;
  }
  function renderCards() {
    $("cards").innerHTML = state.inv.map(function (it) { return cardHtml(it, it.seq); }).join("");
    state.inv.forEach(function (it) { var el = cardEl(it); if (el) el.querySelector('[data-role="extra"]').innerHTML = extraHtml(it); });
  }
  function cardEl(it) { return $("cards").querySelector('.card[data-id="' + it.id + '"]'); }
  function renderCard(it) {
    var el = cardEl(it); if (!el) return;
    var fresh = document.createElement("div"); fresh.innerHTML = cardHtml(it, it.seq);
    el.replaceWith(fresh.firstChild); cardEl(it).querySelector('[data-role="extra"]').innerHTML = extraHtml(it);
  }

  /* ---------- Cálculo ---------- */
  function model() {
    var valid = [], problems = [], warns = [], alerts = [], reading = false;
    state.inv.forEach(function (it) {
      var c = cents(it.monto), n = it.seq;
      if (it.st === "reading" || it.st === "queued") { reading = true; return; }
      if (!c && !it.fecha && !it.cat) { warns.push("Factura " + n + ": sin datos, no se incluye."); return; }
      var rs = rtnState(it); if (rs && !rs.ok) alerts.push("Factura " + n + ": " + rs.msg);
      var miss = []; if (!it.fecha) miss.push("la fecha"); if (!it.cat) miss.push("el concepto"); if (c <= 0) miss.push("el monto");
      if (it.cat === "otro" && !it.otro.trim()) miss.push("qué gasto es");
      if (miss.length) { problems.push("Factura " + n + ": falta " + miss.join(", ") + "."); return; }
      valid.push({ it: it, fecha: it.fecha, row: catRow(it.cat), cat: it.cat, c: c, n: n });
    });
    var pIni = $("periodo").value, pFin = pIni ? addDays(pIni, 7) : "";
    if (pIni && dow(pIni) !== 2) warns.push("El período debe empezar en martes (va de martes a martes).");
    if (pIni) valid.forEach(function (v) { if (v.fecha < pIni || v.fecha > pFin) warns.push("Factura " + v.n + ": la fecha " + dShort(v.fecha) + " queda fuera del período (" + dShort(pIni) + " al " + dShort(pFin) + ").");});
    var dates = Array.from(new Set(valid.map(function (v) { return v.fecha; }))).sort();
    if (dates.length > MAXD) problems.push("Hay " + dates.length + " fechas distintas y el formato admite " + MAXD + ". Divide el reporte en dos.");
    var mx = {}; CATS.forEach(function (c) { mx[c.id] = {}; });
    var dayT = {}, catT = {}, total = 0;
    valid.forEach(function (v) { mx[v.row][v.fecha] = (mx[v.row][v.fecha] || 0) + v.c; dayT[v.fecha] = (dayT[v.fecha] || 0) + v.c; catT[v.row] = (catT[v.row] || 0) + v.c; total += v.c; });
    var fondo = cents($("fondo").value), fuel = catT.comb || 0;
    return { valid: valid, dates: dates, mx: mx, dayT: dayT, catT: catT, total: total, fuel: fuel, km: kmOf(fuel), fondo: fondo, saldo: fondo - total,
      ratio: fondo > 0 ? Math.round(((fondo - total) / fondo) * 100) / 100 : null, problems: problems, warns: warns, alerts: alerts, reading: reading,
      f: { nombre: $("nombre").value.trim(), cargo: $("cargo").value.trim(), cc: $("cc").value.trim() || CC_DEF, fechaRep: $("fechaRep").value, periodo: $("periodo").value, periodoFin: $("periodoFin").value, corr: $("corr").value.trim(),
           boletas: $("boletas").value, lugares: $("lugares").value.trim(), especificar: $("especificar").value.trim(), obs: $("obs").value.trim() } };
  }
  function ratioStr(m) { return m.ratio == null ? "-" : "L. " + (m.ratio < 0 ? "-" : "") + Math.abs(m.ratio).toFixed(2); }

  function renderCuadro(m) {
    var cols = m.dates.length ? m.dates : [""];
    var h = "<thead><tr><th rowspan=\"2\">Clasificación de gastos</th><th rowspan=\"2\">Cuenta</th><th rowspan=\"2\">Sub</th>";
    cols.forEach(function () { h += "<th>Fecha</th>"; });
    h += "<th rowspan=\"2\">Total por concepto</th></tr><tr>";
    cols.forEach(function (d) { h += "<th>" + (d ? dShort(d) : "-") + "</th>"; });
    h += "</tr></thead><tbody>";
    CATS.forEach(function (c) {
      h += "<tr><td class=\"cat\">" + (c.g ? '<span class="grp">' + c.g + " · </span>" : "") + esc(c.n) + "</td><td class=\"cn\">" + c.cuenta + "</td><td class=\"cn\">" + c.sub + "</td>";
      cols.forEach(function (d) { var v = d ? (m.mx[c.id][d] || 0) : 0; h += "<td class=\"n" + (v ? "" : " zero") + "\">" + (v ? L(v) : "") + "</td>"; });
      var t = m.catT[c.id] || 0; h += "<td class=\"n" + (t ? "" : " zero") + "\">" + (t ? L(t) : "L. -") + "</td></tr>";
    });
    h += "</tbody><tfoot><tr><td colspan=\"3\" style=\"text-align:right\">Total de gastos por día</td>";
    cols.forEach(function (d) { h += "<td class=\"n\">" + L(d ? (m.dayT[d] || 0) : 0) + "</td>"; });
    h += "<td class=\"n\">" + L(m.total) + "</td></tr></tfoot>";
    $("cuadro").innerHTML = h;
    $("sumbox").innerHTML = '<div class="tot"><span>Total de gastos</span><span>' + L(m.total) + '</span></div><div><span>Monto fondo fijo</span><span>' + L(m.fondo) +
      '</span></div><div><span>Saldo (fondo - gastos)</span><span class="' + (m.saldo < 0 ? "neg" : "") + '">' + L(m.saldo) + '</span></div><div><span>Saldo ÷ fondo</span><span class="' + (m.ratio != null && m.ratio < 0 ? "neg" : "") + '">' + ratioStr(m) + "</span></div>";
  }
  function update() {
    var m = model();
    if (!state.periodoTouched) $("periodo").value = autoStart($("fechaRep").value);
    $("periodoFin").value = $("periodo").value ? addDays($("periodo").value, 7) : "";
    if (!state.corrTouched) $("corr").value = autoCorr($("fechaRep").value);
    if (!state.boletasTouched) $("boletas").value = state.inv.length ? String(state.inv.length) : "";
    m = model();
    $("kmrec").value = m.fuel ? kmStr(m.km) : "";
    renderCuadro(m);
    $("bTotal").textContent = L(m.total); $("bFondo").textContent = L(m.fondo);
    $("bSaldo").textContent = L(m.saldo); $("bSaldo").className = m.saldo < 0 ? "neg" : "";
    $("msgs").innerHTML = m.problems.concat(m.alerts).map(function (t) { return '<div class="msg err">' + esc(t) + "</div>"; }).join("") + m.warns.map(function (t) { return '<div class="msg warn">' + esc(t) + "</div>"; }).join("");
    $("pdfBtn").disabled = !(m.problems.length === 0 && m.valid.length > 0 && !m.reading);
    return m;
  }
  /* ---------- Eventos ---------- */
  function invOf(el) { var card = el.closest(".card"); if (!card) return null; return state.inv.filter(function (x) { return String(x.id) === card.dataset.id; })[0] || null; }
  $("cards").addEventListener("input", function (e) {
    var el = e.target, it = invOf(el); if (!it || !el.dataset.k) return;
    it[el.dataset.k] = el.value;
    if (el.dataset.k === "monto" || el.dataset.k === "cat" || el.dataset.k === "rtn") { var card = el.closest(".card"); card.querySelector('[data-role="extra"]').innerHTML = extraHtml(it); }
    update();
  });
  $("cards").addEventListener("change", function (e) {
    var el = e.target, it = invOf(el); if (!it || !el.dataset.k) return;
    it[el.dataset.k] = el.value;
    var card = el.closest(".card");
    if (el.dataset.k === "cat") card.querySelector('[data-role="otro"]').hidden = it.cat !== "otro";
    card.querySelector('[data-role="extra"]').innerHTML = extraHtml(it); update();
  });
  $("cards").addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]"); if (!b) return; var it = invOf(b); if (!it) return;
    if (b.dataset.act === "rm") { state.inv = state.inv.filter(function (x) { return x !== it; }); queue = queue.filter(function (x) { return x !== it; }); renderCards(); update(); }
    if (b.dataset.act === "reread" && it.blob) { it.st = "queued"; renderCard(it); update(); enqueue(it); }
  });
  var fileIn = $("file"), drop = $("drop");
  drop.addEventListener("click", function () { fileIn.click(); });
  drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileIn.click(); } });
  fileIn.addEventListener("change", function () { if (fileIn.files.length) addFiles(fileIn.files); fileIn.value = ""; });
  ["dragenter", "dragover"].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  ["cc", "fechaRep", "lugares", "especificar", "obs"].forEach(function (k) {
    $(k).addEventListener("input", function () { update(); });
  });
  $("cc").addEventListener("blur", function () { if (!$("cc").value.trim()) { $("cc").value = CC_DEF; update(); } });
  $("periodo").addEventListener("input", function () { state.periodoTouched = $("periodo").value !== ""; update(); });
  $("corr").addEventListener("input", function () { state.corrTouched = $("corr").value.trim() !== ""; update(); });
  $("boletas").addEventListener("input", function () { state.boletasTouched = $("boletas").value !== ""; update(); });


  /* ---------- PDF (lo genera el servidor) ---------- */
  function setStatus(t, bad) { var s = $("status"); s.textContent = t || ""; s.style.color = bad ? "var(--bad)" : ""; }
  $("pdfBtn").addEventListener("click", function () {
    if (!$("cc").value.trim()) $("cc").value = CC_DEF;
    var m = update(); if (m.problems.length || !m.valid.length || m.reading) return;
    var f = m.f, body = { cc: f.cc, fechaRep: f.fechaRep, periodo: f.periodo, corr: f.corr, boletas: f.boletas, lugares: f.lugares, especificar: f.especificar, obs: f.obs,
      inv: state.inv.filter(function (it) { return it.data; }).map(function (it) { return { seq: it.seq, fecha: it.fecha, cat: it.cat, otro: it.otro, monto: it.monto, total: it.total, rtn: it.rtn, desc: it.desc, img: it.data, w: it.w, h: it.h, numero: it.numero, cai: it.cai, rtn_emisor: it.rtn_emisor, token: it.token }; }) };
    $("pdfBtn").disabled = true; setStatus("Generando PDF…");
    fetch("/api/pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { if (r.status === 401) showLogin(); throw new Error(j.error || "No se pudo generar el PDF."); });
      var dups = +r.headers.get("X-Duplicadas") || 0, cd = r.headers.get("Content-Disposition") || "", mm = /filename="([^"]+)"/.exec(cd);
      return r.blob().then(function (b) {
        var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = mm ? mm[1] : "Fondos_Fijos.pdf"; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        setStatus("PDF descargado." + (dups ? " " + dups + " factura(s) quedaron marcadas como duplicadas al pie de su página." : ""), dups > 0);
      });
    }).catch(function (e) { setStatus(e.message, true); }).then(function () { update(); });
  });

  /* ---------- Sesión y cuenta ---------- */
  function show(id, on) { $(id).classList.toggle("on", !!on); }
  function showLogin() { $("app").hidden = true; $("bar").hidden = true; show("admin", false); show("pwbox", false); show("login", true); $("lp").value = ""; setTimeout(function () { $("lu").focus(); }, 30); }
  var pwForced = false;
  function showPw(forced) { pwForced = !!forced; $("pwTitle").textContent = forced ? "Crea tu contraseña" : "Cambiar contraseña"; $("pwHint").textContent = forced ? "Tu contraseña es temporal. Debes cambiarla para continuar." : ""; $("pwCancel").hidden = pwForced; $("pmsg").textContent = ""; $("pc").value = ""; $("pn").value = ""; show("pwbox", true); }
  function applyMe(j) {
    me = j.user; $("nombre").value = me.nombre; $("cargo").value = me.cargo; $("fondo").value = me.fondo; $("tarifa").value = String(j.tarifa);
    $("whoName").textContent = me.nombre; $("whoSub").textContent = me.cargo + (me.role === "admin" ? " · administrador" : "");
    $("btnAdmin").hidden = me.role !== "admin";
    show("login", false); $("app").hidden = false; $("bar").hidden = false;
    renderCards(); update();
    if (me.must_change) showPw(true);
  }
  function loadMe() { return api("GET", "/api/me").then(applyMe).catch(function () { showLogin(); }); }
  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault(); $("lmsg").textContent = "";
    api("POST", "/api/login", { username: $("lu").value, password: $("lp").value }).then(function (j) { blank(); applyMe(j); }).catch(function (er) { $("lmsg").textContent = er.message; });
  });
  $("btnOut").addEventListener("click", function () { api("POST", "/api/logout").then(function () { state.inv = []; showLogin(); }, showLogin); });
  $("btnPw").addEventListener("click", function () { showPw(false); });
  $("pwCancel").addEventListener("click", function () { show("pwbox", false); });
  $("pwForm").addEventListener("submit", function (e) {
    e.preventDefault();
    api("POST", "/api/password", { current: $("pc").value, next: $("pn").value }).then(function () { me.must_change = false; show("pwbox", false); }).catch(function (er) { $("pmsg").className = "err-t"; $("pmsg").textContent = er.message; });
  });

  /* ---------- Administración ---------- */
  var tabs = ["users", "cfg", "inv", "aud"];
  function say(t, bad) { var m = $("ovmsg"); m.textContent = t || ""; m.className = bad ? "err-t" : "ok-t"; }
  function openTab(t) {
    tabs.forEach(function (x) { $("tab-" + x).hidden = x !== t; });
    Array.prototype.forEach.call(document.querySelectorAll("[data-tab]"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.tab === t)); });
    say(""); ({ users: loadUsers, cfg: loadCfg, inv: loadInv, aud: loadAud })[t]();
  }
  function fld(label, id, val, extra) { return '<div class="f"><label for="' + id + '">' + label + '</label><input id="' + id + '" ' + (extra || 'type="text"') + ' value="' + esc(val == null ? "" : val) + '"></div>'; }
  function loadUsers() {
    api("GET", "/api/admin/users").then(function (j) {
      var h = '<h2>Crear cuenta</h2><form id="newUser" class="row" autocomplete="off">' +
        fld("Usuario", "nuU", "", 'type="text" required minlength="3"') + fld("Nombre completo", "nuN", "", 'type="text" required') + fld("Cargo", "nuC", "", 'type="text" required') +
        fld("Fondo fijo (L.)", "nuF", "", 'type="number" step="0.01" min="0" required') + fld("Contraseña temporal", "nuP", "", 'type="text" minlength="8" required') +
        '<div class="f"><label for="nuR">Rol</label><select id="nuR"><option value="colaborador">Colaborador</option><option value="admin">Administrador</option></select></div>' +
        '<button class="btn primary" type="submit">Crear cuenta</button></form>' +
        '<h2 style="margin-top:22px">Cuentas</h2><div class="scroll"><table class="list"><thead><tr><th>Usuario</th><th>Nombre</th><th>Cargo</th><th class="n">Fondo fijo (L.)</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>';
      j.users.forEach(function (u) {
        h += '<tr data-id="' + u.id + '"><td>' + esc(u.username) + '</td><td><input data-f="nombre" value="' + esc(u.nombre) + '"></td><td><input data-f="cargo" value="' + esc(u.cargo) + '"></td>' +
          '<td class="n"><input data-f="fondo" type="number" step="0.01" min="0" style="width:110px;text-align:right" value="' + esc(u.fondo) + '"></td>' +
          '<td><select data-f="role"' + (me && u.id === me.id ? " disabled" : "") + '><option value="colaborador"' + (u.role === "colaborador" ? " selected" : "") + '>Colaborador</option><option value="admin"' + (u.role === "admin" ? " selected" : "") + '>Administrador</option></select></td>' +
          '<td><span class="pill ' + (u.active ? "ok" : "off") + '">' + (u.active ? "Activa" : "Inactiva") + '</span></td>' +
          '<td style="white-space:nowrap"><button class="btn small" data-a="save">Guardar</button> <button class="btn small" data-a="pw">Restablecer clave</button>' +
          (me && u.id === me.id ? "" : ' <button class="btn small" data-a="tog">' + (u.active ? "Desactivar" : "Activar") + "</button>") + "</td></tr>";
      });
      $("tab-users").innerHTML = h + "</tbody></table></div><p class=\"hint\" style=\"margin-top:10px\">El nombre, cargo y fondo fijo de cada cuenta se precargan solos cuando el colaborador ingresa y solo un administrador puede cambiarlos. La contraseña temporal se debe cambiar en el primer ingreso.</p>";
    }).catch(function (e) { say(e.message, true); });
  }
  $("tab-users").addEventListener("submit", function (e) {
    if (e.target.id !== "newUser") return; e.preventDefault();
    api("POST", "/api/admin/users", { username: $("nuU").value, nombre: $("nuN").value, cargo: $("nuC").value, fondo: $("nuF").value, password: $("nuP").value, role: $("nuR").value }).then(function () { say("Cuenta creada."); loadUsers(); }).catch(function (er) { say(er.message, true); });
  });
  $("tab-users").addEventListener("click", function (e) {
    var b = e.target.closest("[data-a]"); if (!b) return; var tr = b.closest("tr"), id = tr.dataset.id, a = b.dataset.a;
    function val(f) { return tr.querySelector('[data-f="' + f + '"]').value; }
    var p;
    if (a === "save") p = api("PATCH", "/api/admin/users/" + id, { nombre: val("nombre"), cargo: val("cargo"), fondo: val("fondo"), role: val("role") });
    else if (a === "pw") { var np = prompt("Nueva contraseña temporal (mínimo 8 caracteres). La persona deberá cambiarla al ingresar."); if (!np) return; p = api("PATCH", "/api/admin/users/" + id, { password: np }); }
    else if (a === "tog") p = api("PATCH", "/api/admin/users/" + id, { active: b.textContent.trim() === "Activar" });
    p.then(function () { say("Cambios guardados."); loadUsers(); }).catch(function (er) { say(er.message, true); });
  });
  function loadCfg() {
    api("GET", "/api/admin/settings").then(function (s) {
      $("tab-cfg").innerHTML = '<h2>Configuración general</h2><form id="cfgForm" class="grid">' +
        '<div class="f w4"><label for="cgT">Lempiras por kilómetro</label><input id="cgT" type="number" step="0.01" min="0.01" value="' + esc(s.tarifa) + '"></div>' +
        '<div class="f w4"><label for="cgM">Modelo de Claude para leer facturas</label><input id="cgM" type="text" value="' + esc(s.model) + '"></div>' +
        '<div class="f w12"><label for="cgK">Clave de la API de Claude (de la empresa)</label><input id="cgK" type="password" autocomplete="off" placeholder="' + (s.api_key_set ? "Configurada (termina en " + esc(s.api_key_tail) + "). Escribe otra solo para reemplazarla." : (s.env_key ? "Se usa la clave de la variable de entorno ANTHROPIC_API_KEY." : "sk-ant-…")) + '"></div>' +
        '<div class="f w12 row" style="flex-direction:row"><button class="btn primary" type="submit">Guardar</button>' + (s.api_key_set ? '<button class="btn" type="button" id="cgClr">Borrar clave guardada</button>' : "") + "</div></form>" +
        '<p class="hint" style="margin-top:10px">La clave se guarda solo en este servidor y nunca se muestra completa ni se envía a los colaboradores.</p>';
    }).catch(function (e) { say(e.message, true); });
  }
  $("tab-cfg").addEventListener("submit", function (e) {
    e.preventDefault(); var b = { tarifa: $("cgT").value, model: $("cgM").value }; if ($("cgK").value.trim()) b.api_key = $("cgK").value;
    api("PUT", "/api/admin/settings", b).then(function () { say("Configuración guardada."); loadCfg(); }).catch(function (er) { say(er.message, true); });
  });
  $("tab-cfg").addEventListener("click", function (e) { if (e.target.id === "cgClr" && confirm("¿Borrar la clave guardada?")) api("PUT", "/api/admin/settings", { clear_api_key: true }).then(function () { say("Clave borrada."); loadCfg(); }); });
  function loadInv() {
    api("GET", "/api/admin/invoices").then(function (j) {
      var h = '<h2>Facturas de las últimas 4 semanas</h2><div class="scroll"><table class="list"><thead><tr><th>Registrada</th><th>Colaborador</th><th>Correlativo</th><th>RTN emisor</th><th>N° factura</th><th>CAI</th><th>Fecha</th><th class="n">Monto</th><th></th></tr></thead><tbody>';
      j.invoices.forEach(function (r) { h += "<tr><td>" + esc(r.when) + "</td><td>" + esc(r.user_nombre) + "</td><td>" + esc(r.correlativo) + "</td><td>" + esc(r.rtn_emisor) + "</td><td>" + esc(r.numero) + (r.edited ? " (editado)" : "") + "</td><td>" + esc(r.cai) + "</td><td>" + esc(dLong(r.fecha)) + '</td><td class="n">' + esc(r.total) + '</td><td><button class="btn small" data-del="' + r.id + '">Quitar</button></td></tr>'; });
      $("tab-inv").innerHTML = h + "</tbody></table></div>" + (j.invoices.length ? "" : '<p class="hint">Todavía no hay facturas registradas.</p>') + '<p class="hint" style="margin-top:10px">Los registros se borran solos a las 4 semanas. «Quitar» libera una factura para que pueda usarse de nuevo.</p>';
    }).catch(function (e) { say(e.message, true); });
  }
  $("tab-inv").addEventListener("click", function (e) { var d = e.target.dataset.del; if (d && confirm("¿Quitar este registro?")) api("DELETE", "/api/admin/invoices/" + d).then(loadInv); });
  function loadAud() {
    api("GET", "/api/admin/audit").then(function (j) {
      var h = '<h2>Bitácora (últimos 200 eventos)</h2><div class="scroll"><table class="list"><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Detalle</th></tr></thead><tbody>';
      j.audit.forEach(function (r) { h += "<tr><td>" + esc(r.when) + "</td><td>" + esc(r.actor) + "</td><td>" + esc(r.action) + "</td><td>" + esc(r.detail) + "</td></tr>"; });
      $("tab-aud").innerHTML = h + "</tbody></table></div>";
    }).catch(function (e) { say(e.message, true); });
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-tab]"), function (b) { b.addEventListener("click", function () { openTab(b.dataset.tab); }); });
  $("btnAdmin").addEventListener("click", function () { show("admin", true); openTab("users"); });
  $("admClose").addEventListener("click", function () { show("admin", false); loadMe(); });

  blank(); loadMe();
})();
