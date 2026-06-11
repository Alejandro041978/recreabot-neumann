export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  const SA_JSON  = process.env.GOOGLE_SA_JSON;

  if (req.url && req.url.includes('debug=1')) {
    let parsed = false, email = '', keyLen = 0;
    try { const j = JSON.parse(SA_JSON||'{}'); parsed=true; email=j.client_email||''; keyLen=(j.private_key||'').length; } catch(e){}
    res.json({ ok:true, sheet_id: SHEET_ID||'NO CONFIG', sa_json_parsed: parsed, email, key_length: keyLen });
    return;
  }

  if (!SHEET_ID || !SA_JSON) {
    res.status(500).json({ error:'Variables no configuradas', sheet_id:!!SHEET_ID, sa_json:!!SA_JSON }); return;
  }

  let sa;
  try { sa = JSON.parse(SA_JSON); }
  catch(e) { res.status(500).json({ error:'GOOGLE_SA_JSON inválido' }); return; }

  try {
    const token  = await getToken(sa.client_email, sa.private_key);
    const tabName = await getFirstTab(token, SHEET_ID);

    if (req.method === 'GET') {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${enc(tabName)}!A:J`;
      const r   = await fetch(url, { headers: { Authorization:`Bearer ${token}` } });
      const d   = await r.json();
      const rows = d.values || [];
      if (rows.length <= 1) { res.json({ registros:[], tab:tabName }); return; }
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
      res.json({ registros, tab:tabName, total:registros.length });
      return;
    }

    if (req.method === 'POST') {
      const { registro } = req.body;
      if (!registro) { res.status(400).json({ error:'Falta registro' }); return; }

      // Convertir timestamp ISO a hora Lima legible
      const tsLima = isoToLima(registro.ts || new Date().toISOString());

      // Normalizar horario — agregar am/pm si falta
      const horario = normalizarHorario(registro.horario || '');

      const fila = [
        tsLima,
        registro.codigo        || '',
        registro.carrera       || '',
        registro.area          || '',
        registro.participantes || '',
        registro.fecha_reserva || '',
        horario,
        registro.estado        || '',
        registro.problema      || '',
        registro.calificacion  || '',
      ];

      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${enc(tabName)}!A:J:append?valueInputOption=USER_ENTERED`;
      const r   = await fetch(url, {
        method: 'POST',
        headers: { Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ values:[fila] }),
      });
      const d = await r.json();
      if (d.updates) res.json({ ok:true, fila:d.updates.updatedRange, tab:tabName });
      else res.status(500).json({ error:'Error Sheets', detail:d });
      return;
    }

    res.status(405).json({ error:'Método no soportado' });

  } catch(err) {
    res.status(500).json({ error:err.message });
  }
}

// ── Convertir ISO a hora Lima legible ──
function isoToLima(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return iso; // si ya viene en otro formato, dejarlo
    return d.toLocaleString('es-PE', {
      timeZone: 'America/Lima',
      day:'2-digit', month:'2-digit', year:'numeric',
      hour:'2-digit', minute:'2-digit', second:'2-digit',
      hour12: true
    });
  } catch(e) { return iso; }
}

// ── Normalizar horario — asegurar formato correcto ──
function normalizarHorario(h) {
  if (!h) return '';
  // Si ya tiene am/pm correcto, devolver tal cual
  if (h.includes('am') || h.includes('pm')) return h;
  // Mapear rangos conocidos
  const mapa = {
    '8-10':  '8-10am',  '10-12': '10am-12pm', '10am-12': '10am-12pm',
    '12-2':  '12-2pm',  '2-4':   '2-4pm',      '4-6':     '4-6pm',
    '6-8':   '6-8pm',   '8-10p': '8-10pm',
    '8-9':   '8-9am',   '9-10':  '9-10am',     '10-11':   '10-11am',
    '11-12': '11am-12pm','12-1': '12-1pm',      '1-2':     '1-2pm',
    '2-3':   '2-3pm',   '3-4':   '3-4pm',       '4-5':     '4-5pm',
    '5-6':   '5-6pm',   '6-7':   '6-7pm',       '7-8':     '7-8pm',
    '8-9p':  '8-9pm',   '9-10p': '9-10pm',
  };
  const limpio = h.replace(/\s/g,'').toLowerCase();
  for (const [key, val] of Object.entries(mapa)) {
    if (limpio === key || limpio.startsWith(key)) return val;
  }
  return h; // devolver como está si no hay coincidencia
}

// ── Obtener nombre de la primera hoja ──
async function getFirstTab(token, sheetId) {
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,
    { headers: { Authorization:`Bearer ${token}` } }
  );
  const d = await r.json();
  return (d.sheets && d.sheets[0]) ? d.sheets[0].properties.title : 'Hoja 1';
}

function enc(s) { return encodeURIComponent(s); }

// ── JWT ──
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
