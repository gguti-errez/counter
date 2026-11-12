'use strict';
const PROMPT = 'La imagen es una factura o recibo de Honduras. Lee sus datos y responde SOLO con un objeto JSON con estas llaves: ' +
  '"fecha" (fecha de emisión en formato AAAA-MM-DD), "total" (importe total final a pagar en lempiras, número sin símbolo ni comas), ' +
  '"proveedor" (nombre del comercio), "concepto" (uno de: alimentacion, combustible, hospedaje, transporte, peajes, parqueo, recarga, repuestos, herramienta, otro), ' +
  '"rtn_cliente" (RTN del cliente o adquirente, es decir de quien compra, solo sus 14 dígitos; no uses el RTN del comercio que emite; null si no aparece), "rtn_emisor" (RTN del comercio que emite, solo dígitos, o null), ' +
  '"numero" (número o correlativo de la factura tal como aparece impreso, por ejemplo 000-001-01-00012345, o null), "cai" (código CAI impreso en la factura, o null), ' +
  '"descripcion" (una frase corta en español que diga qué se compró y dónde). Si algún dato no se lee con claridad, pon null en esa llave; no adivines. ' +
  'Ejemplo: {"fecha":"2026-10-30","total":245.00,"proveedor":"Restaurante X","rtn_cliente":"05019010314509","rtn_emisor":"08011990123456","numero":"000-001-01-00012345","cai":"A1B2C3-D4E5F6-A7B8C9-D0E1F2-A3B4C5-D6","concepto":"alimentacion","descripcion":"Almuerzo en Puerto Cortés"}';

async function readInvoice(app, jpegBase64) {
  if (process.env.MOCK_READER) {
    // Modo de pruebas: lee los datos de la variable MOCK_READER (JSON) sin llamar a la API.
    return JSON.parse(process.env.MOCK_READER);
  }
  const key = app.getSetting('api_key', '') || process.env.ANTHROPIC_API_KEY || '';
  if (!key) { const e = new Error('Falta configurar la clave de la API de Claude (menú Administración).'); e.code = 'no_key'; throw e; }
  const model = app.getSetting('model', 'claude-sonnet-5-5');
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 60000);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 700, messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } },
        { type: 'text', text: PROMPT }] }] }),
    });
  } finally { clearTimeout(to); }
  if (!res.ok) {
    const e = new Error(res.status === 401 ? 'La clave de la API de Claude no es válida.' : res.status === 429 ? 'Límite de lecturas alcanzado, intenta en un momento.' : 'La API de Claude respondió con error ' + res.status + '.');
    e.code = 'api_' + res.status; throw e;
  }
  const j = await res.json();
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) { const e = new Error('No se pudo interpretar la lectura.'); e.code = 'invalid_json'; throw e; }
  try { return JSON.parse(m[0]); } catch { const e = new Error('No se pudo interpretar la lectura.'); e.code = 'invalid_json'; throw e; }
}
module.exports = { readInvoice };
