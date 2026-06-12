// api/evaluaciones.js — Guarda respuestas completas de evaluación post-uso
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Solo POST' }); return; }

  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  const SA_JSON  = process.env.GOOGLE_SA_JSON;
  if (!SHEET_ID || !SA_JSON) {
    res.status(500).json({ error: 'Variables no configuradas' }); return;
  }

  let sa;
  try { sa = JSON.parse(SA_JSON); }
  catch(e) { res.status(500).json({ error: 'SA_JSON inválido' }); return; }

  const { codigo, area, fecha, horario, calificacion, estado_equipo, volveria, comentario, ts } = req.body;

  // Convertir timestamp a hora Lima
  const tsLima = (() => {
    try {
      return new Date(ts || new Date().toISOString()).toLocaleString('es-PE', {
        timeZone: 'America/Lima',
        day:'2-digit', month:'2-digit', year:'numeric',
        hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: true
      });
    } catch(e) { return new Date().toISOString(); }
  })();

  const fila = [
    tsLima,
    codigo        || '',
    area          || '',
    fecha         || '',
    horario       || '',
    String(calificacion || ''),
    estado_equipo || '',
    volveria      || '',
    comentario    || '',
  ];

  try {
    const token = await getToken(sa.client_email, sa.private_key);
    const TAB   = 'Evaluaciones';

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB)}!A:I:append?valueInputOption=USER_ENTERED`;
    const r   = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [fila] }),
    });
    const d = await r.json();
    if (d.updates) res.json({ ok: true, fila: d.updates.updatedRange });
    else res.status(500).json({ error: 'Error Sheets', detail: d });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}

async function getToken(email, privateKey) {
  const now = Math.floor(Date.now()/1000);
  const claim = { iss:email, scope:'https://www.googleapis.com/auth/spreadsheets', aud:'https://oauth2.googleapis.com/token', exp:now+3600, iat:now };
  const h = b64url(JSON.stringify({ alg:'RS256', typ:'JWT' }));
  const p = b64url(JSON.stringify(claim));
  const key = privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  const bin = Uint8Array.from(atob(key), c => c.charCodeAt(0));
  const ck  = await crypto.subtle.importKey('pkcs8', bin.buffer, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', ck, new TextEncoder().encode(`${h}.${p}`));
  const jwt = `${h}.${p}.${b64url(sig)}`;
  const tr  = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const td = await tr.json();
  if (!td.access_token) throw new Error('Token fallido: '+JSON.stringify(td));
  return td.access_token;
}
function b64url(d) {
  const s = d instanceof ArrayBuffer ? String.fromCharCode(...new Uint8Array(d)) : (typeof d==='string'?d:JSON.stringify(d));
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
