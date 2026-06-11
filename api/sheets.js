// api/sheets.js — guarda y lee registros en Google Sheets
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const SHEET_ID  = process.env.GOOGLE_SHEET_ID;
  const SA_JSON   = process.env.GOOGLE_SA_JSON; // JSON completo de la service account

  // ── DIAGNÓSTICO ──
  if (req.url && req.url.includes('debug=1')) {
    let parsed = false;
    let email  = '';
    let keyLen = 0;
    try {
      const j = JSON.parse(SA_JSON || '{}');
      parsed = true;
      email  = j.client_email || '';
      keyLen = (j.private_key || '').length;
    } catch(e) {}
    res.json({ ok: true, sheet_id: SHEET_ID || 'NO CONFIG', sa_json_parsed: parsed, email, key_length: keyLen });
    return;
  }

  if (!SHEET_ID || !SA_JSON) {
    res.status(500).json({ error: 'Variables no configuradas', sheet_id: !!SHEET_ID, sa_json: !!SA_JSON });
    return;
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(SA_JSON);
  } catch(e) {
    res.status(500).json({ error: 'GOOGLE_SA_JSON no es JSON válido', detail: e.message });
    return;
  }

  try {
    const token   = await getAccessToken(serviceAccount.client_email, serviceAccount.private_key);

    // ── Detectar nombre real de la hoja ──
    const metaRes  = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const metaData = await metaRes.json();
    const tabName  = (metaData.sheets && metaData.sheets[0])
      ? metaData.sheets[0].properties.title : 'Hoja 1';

    // ── GET: leer registros ──
    if (req.method === 'GET') {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tabName)}!A:J`;
      const r   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const d   = await r.json();
      const rows = d.values || [];
      if (rows.length <= 1) { res.json({ registros: [], tab: tabName }); return; }
      const registros = rows.slice(1).map(row => ({
        ts:            row[0]||'',
        codigo:        row[1]||'',
        carrera:       row[2]||'',
        area:          row[3]||'',
        participantes: row[4]||'',
        fecha_reserva: row[5]||'',
        horario:       row[6]||'',
        estado:        row[7]||'',
        problema:      row[8]||'',
        calificacion:  row[9]||'',
      }));
      res.json({ registros, tab: tabName, total: registros.length });
      return;
    }

    // ── POST: guardar registro ──
    if (req.method === 'POST') {
      const { registro } = req.body;
      if (!registro) { res.status(400).json({ error: 'Falta campo registro' }); return; }
      // Convertir timestamp a GMT-5 (Lima, Perú)
      const ahora = new Date(registro.ts || new Date().toISOString());
      const offsetPeru = -5 * 60; // minutos
      const ahoraLima  = new Date(ahora.getTime() + (offsetPeru - ahora.getTimezoneOffset()) * 60000);
      const tsLima     = ahoraLima.toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: true,
        year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', second:'2-digit' });

      const fila = [
        tsLima,
        registro.codigo||'', registro.carrera||'', registro.area||'',
        registro.participantes||'', registro.fecha_reserva||'',
        registro.horario||'', registro.estado||'',
        registro.problema||'', registro.calificacion||'',
      ];
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tabName)}!A:J:append?valueInputOption=USER_ENTERED`;
      const r   = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [fila] }),
      });
      const d = await r.json();
      if (d.updates) {
        res.json({ ok: true, fila: d.updates.updatedRange, tab: tabName });
      } else {
        res.status(500).json({ error: 'Error Sheets API', detail: d });
      }
      return;
    }

    res.status(405).json({ error: 'Método no soportado' });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── JWT para Google Service Account ──
async function getAccessToken(email, privateKey) {
  const now   = Math.floor(Date.now() / 1000);
  const claim = {
    iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now,
  };
  const header   = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload  = b64url(JSON.stringify(claim));
  const unsigned = `${header}.${payload}`;
  const keyData  = privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary   = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binary.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(sig)}`;
  const tokenRes  = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Token fallido: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

function b64url(data) {
  const str = data instanceof ArrayBuffer
    ? String.fromCharCode(...new Uint8Array(data))
    : (typeof data === 'string' ? data : JSON.stringify(data));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
