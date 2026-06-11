// api/sheets.js — guarda y lee registros en Google Sheets
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  const SA_EMAIL = process.env.GOOGLE_SA_EMAIL;
  const SA_KEY   = process.env.GOOGLE_SA_KEY;

  // ── DIAGNÓSTICO — siempre responde aunque falten variables ──
  if (req.url && req.url.includes('debug=1')) {
    res.json({
      ok: true,
      sheet_id:   SHEET_ID   || 'NO CONFIGURADO',
      sa_email:   SA_EMAIL   || 'NO CONFIGURADO',
      key_length: SA_KEY ? SA_KEY.length : 0,
      key_start:  SA_KEY ? SA_KEY.substring(0, 30) : 'VACÍO',
    });
    return;
  }

  if (!SHEET_ID || !SA_EMAIL || !SA_KEY) {
    res.status(500).json({
      error: 'Variables de entorno no configuradas',
      sheet_id: !!SHEET_ID, sa_email: !!SA_EMAIL, sa_key: !!SA_KEY
    });
    return;
  }

  try {
    const cleanKey = SA_KEY.replace(/\\n/g, '\n');
    const token    = await getAccessToken(SA_EMAIL, cleanKey);

    // ── Detectar nombre real de la hoja ──
    const metaRes  = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const metaData = await metaRes.json();
    const tabName  = (metaData.sheets && metaData.sheets[0])
      ? metaData.sheets[0].properties.title
      : 'Hoja 1';

    // ── GET: leer registros ──
    if (req.method === 'GET') {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tabName)}!A:I`;
      const r   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const d   = await r.json();
      const rows = d.values || [];
      if (rows.length <= 1) { res.json({ registros: [], tab: tabName }); return; }
      const registros = rows.slice(1).map(row => ({
        ts:           row[0] || '',
        codigo:       row[1] || '',
        carrera:      row[2] || '',
        area:         row[3] || '',
        participantes:row[4] || '',
        horario:      row[5] || '',
        estado:       row[6] || '',
        problema:     row[7] || '',
        calificacion: row[8] || '',
      }));
      res.json({ registros, tab: tabName, total: registros.length });
      return;
    }

    // ── POST: guardar registro ──
    if (req.method === 'POST') {
      const { registro } = req.body;
      if (!registro) { res.status(400).json({ error: 'Falta campo registro' }); return; }

      const fila = [
        registro.ts            || new Date().toISOString(),
        registro.codigo        || '',
        registro.carrera       || '',
        registro.area          || '',
        registro.participantes || '',
        registro.horario       || '',
        registro.estado        || '',
        registro.problema      || '',
        registro.calificacion  || '',
      ];

      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tabName)}!A:I:append?valueInputOption=USER_ENTERED`;
      const r   = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [fila] }),
      });
      const d = await r.json();
      if (d.updates) {
        res.json({ ok: true, fila: d.updates.updatedRange, tab: tabName });
      } else {
        res.status(500).json({ error: 'Error en Sheets API', detail: d });
      }
      return;
    }

    res.status(405).json({ error: 'Método no soportado' });

  } catch (err) {
    res.status(500).json({ error: 'Error interno', detail: err.message, stack: err.stack });
  }
}

// ── JWT para Google Service Account ──
async function getAccessToken(email, privateKey) {
  const now   = Math.floor(Date.now() / 1000);
  const claim = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claim));
  const unsigned = `${header}.${payload}`;

  const keyData   = privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${b64url(signature)}`;

  const tokenRes  = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error('Token fallido: ' + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}

function b64url(data) {
  const str = data instanceof ArrayBuffer
    ? String.fromCharCode(...new Uint8Array(data))
    : (typeof data === 'string' ? data : JSON.stringify(data));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
