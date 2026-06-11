// api/config.js — Lee y guarda configuración de horarios en Google Sheets
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  const SA_JSON  = process.env.GOOGLE_SA_JSON;
  if (!SHEET_ID || !SA_JSON) {
    res.status(500).json({ error: 'Variables no configuradas' }); return;
  }

  let sa;
  try { sa = JSON.parse(SA_JSON); } catch(e) {
    res.status(500).json({ error: 'SA_JSON inválido' }); return;
  }

  try {
    const token = await getToken(sa.client_email, sa.private_key);

    // Asegurar que existe la hoja "Config"
    const metaR = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const meta  = await metaR.json();
    const hojas = (meta.sheets || []).map(s => s.properties.title);

    if (!hojas.includes('Config')) {
      // Crear hoja Config
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'Config' } } }] })
      });
      // Escribir config por defecto
      await writeConfig(token, SHEET_ID, defaultConfig());
    }

    // GET — leer config
    if (req.method === 'GET') {
      const r = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Config!A:Z`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const d = await r.json();
      const rows = (d.values || []);
      if (rows.length < 2) {
        await writeConfig(token, SHEET_ID, defaultConfig());
        res.json(defaultConfig()); return;
      }
      // Parsear config desde Sheets
      const config = {};
      rows.slice(1).forEach(row => {
        if (!row[0]) return;
        config[row[0]] = {
          slots:     (row[1] || '').split(',').map(s => s.trim()).filter(Boolean),
          dias:      row[2] || 'Lunes a Domingo',
          activa:    row[3] !== 'false',
          tipo_slot: row[4] || '1h',
        };
      });
      res.json(config); return;
    }

    // POST — guardar config
    if (req.method === 'POST') {
      const config = req.body;
      await writeConfig(token, SHEET_ID, config);
      res.json({ ok: true }); return;
    }

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}

async function writeConfig(token, sheetId, config) {
  // Limpiar hoja Config
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Config!A:Z:clear`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  // Escribir encabezados y datos
  const rows = [
    ['Area', 'Slots', 'Dias', 'Activa', 'Tipo_Slot'],
    ...Object.entries(config).map(([area, cfg]) => [
      area,
      Array.isArray(cfg.slots) ? cfg.slots.join(', ') : cfg.slots,
      cfg.dias || 'Lunes a Domingo',
      String(cfg.activa !== false),
      cfg.tipo_slot || '1h',
    ])
  ];
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Config!A1:E${rows.length}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    }
  );
}

function defaultConfig() {
  const slots2h = ['8-10am','10am-12pm','12-2pm','2-4pm','4-6pm','6-8pm','8-10pm'];
  const slots1h = ['8-9am','9-10am','10-11am','11am-12pm','12-1pm','1-2pm','2-3pm','3-4pm','4-5pm','5-6pm','6-7pm','7-8pm','8-9pm','9-10pm'];
  return {
    'Canchita A': { slots: slots2h, dias: 'Lunes a Domingo', activa: true, tipo_slot: '2h' },
    'Canchita B': { slots: slots2h, dias: 'Lunes a Domingo', activa: true, tipo_slot: '2h' },
    'Taka Taka':  { slots: slots1h, dias: 'Lunes a Domingo', activa: true, tipo_slot: '1h' },
    'Ajedrez':    { slots: slots1h, dias: 'Lunes a Domingo', activa: true, tipo_slot: '1h' },
    'Sapito':     { slots: slots1h, dias: 'Lunes a Domingo', activa: true, tipo_slot: '1h' },
  };
}

// ── JWT ──
async function getToken(email, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now };
  const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify(claim));
  const key = privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const bin = Uint8Array.from(atob(key), c => c.charCodeAt(0));
  const ck  = await crypto.subtle.importKey('pkcs8', bin.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', ck, new TextEncoder().encode(`${h}.${p}`));
  const jwt = `${h}.${p}.${b64url(sig)}`;
  const tr  = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const td = await tr.json();
  if (!td.access_token) throw new Error('Token fallido: ' + JSON.stringify(td));
  return td.access_token;
}
function b64url(d) {
  const s = d instanceof ArrayBuffer ? String.fromCharCode(...new Uint8Array(d)) : (typeof d === 'string' ? d : JSON.stringify(d));
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
