// api/estudiantes.js — consulta y gestiona la base de estudiantes
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const SHEET_ID = process.env.GOOGLE_SHEET_ID;
  const SA_JSON  = process.env.GOOGLE_SA_JSON;
  if (!SHEET_ID || !SA_JSON) {
    res.status(500).json({ error: 'Variables no configuradas' }); return;
  }

  let sa;
  try { sa = JSON.parse(SA_JSON); }
  catch(e) { res.status(500).json({ error: 'SA_JSON inválido' }); return; }

  try {
    const token = await getToken(sa.client_email, sa.private_key);
    const TAB   = 'Estudiantes';

    // GET ?codigo=202401 — buscar un estudiante por código
    if (req.method === 'GET' && req.query && req.query.codigo) {
      const codigo = req.query.codigo.trim();
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB)}!A:G`;
      const r   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const d   = await r.json();
      const rows = (d.values || []).slice(1);
      const fila = rows.find(row => String(row[0]||'').trim() === codigo);
      if (!fila) {
        res.json({ encontrado: false }); return;
      }
      const activo = String(fila[6]||'SI').toUpperCase().trim() === 'SI';
      res.json({
        encontrado: true,
        activo,
        codigo:    fila[0]||'',
        nombre:    fila[1]||'',
        apellido:  fila[2]||'',
        carrera:   fila[3]||'',
        email:     fila[4]||'',
        whatsapp:  fila[5]||'',
      });
      return;
    }

    // GET sin parámetros — listar todos
    if (req.method === 'GET') {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB)}!A:G`;
      const r   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const d   = await r.json();
      const rows = (d.values || []).slice(1);
      const estudiantes = rows
        .filter(row => row[0])
        .map(row => ({
          codigo:   row[0]||'',
          nombre:   row[1]||'',
          apellido: row[2]||'',
          carrera:  row[3]||'',
          email:    row[4]||'',
          whatsapp: row[5]||'',
          activo:   String(row[6]||'SI').toUpperCase().trim() === 'SI',
        }));
      res.json({ estudiantes, total: estudiantes.length });
      return;
    }

    res.status(405).json({ error: 'Método no soportado' });

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
