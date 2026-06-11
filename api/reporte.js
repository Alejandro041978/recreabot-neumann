// api/reporte.js — Genera y envía reporte semanal por email
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Verificar autorización — solo Vercel Cron o llamada manual con token
  const authHeader = req.headers['authorization'] || '';
  const cronHeader = req.headers['x-vercel-cron'] || '';
  const CRON_SECRET = process.env.CRON_SECRET || 'recreabot-neumann-2026';
  if (!cronHeader && authHeader !== `Bearer ${CRON_SECRET}`) {
    res.status(401).json({ error: 'No autorizado' }); return;
  }

  const SHEET_ID    = process.env.GOOGLE_SHEET_ID;
  const SA_JSON     = process.env.GOOGLE_SA_JSON;
  const RESEND_KEY  = process.env.RESEND_API_KEY;
  const EMAIL_DEST  = process.env.EMAIL_REPORTE || 'coordinacion@neumann.edu.pe';
  const EMAIL_FROM  = process.env.EMAIL_FROM    || 'RecreaBot Neumann <reportes@neumann.edu.pe>';

  if (!SHEET_ID || !SA_JSON || !RESEND_KEY) {
    res.status(500).json({ error: 'Variables no configuradas', sheet_id:!!SHEET_ID, sa_json:!!SA_JSON, resend:!!RESEND_KEY });
    return;
  }

  try {
    // ── Leer registros de la semana anterior desde Sheets ──
    const sa    = JSON.parse(SA_JSON);
    const token = await getToken(sa.client_email, sa.private_key);
    const tab   = await getFirstTab(token, SHEET_ID);

    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tab)}!A:J`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const d    = await r.json();
    const rows = (d.values || []).slice(1); // omitir encabezados

    // Calcular rango semana anterior (lunes a domingo)
    const hoy       = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
    const lunes     = new Date(hoy); lunes.setDate(hoy.getDate() - hoy.getDay() - 6);  lunes.setHours(0,0,0,0);
    const domingo   = new Date(lunes); domingo.setDate(lunes.getDate() + 6); domingo.setHours(23,59,59,999);

    const registros = rows
      .map(row => ({
        ts: row[0]||'', codigo: row[1]||'', carrera: row[2]||'',
        area: row[3]||'', participantes: row[4]||'', fecha_reserva: row[5]||'',
        horario: row[6]||'', estado: row[7]||'', problema: row[8]||'',
      }))
      .filter(r => {
        const d = parseDate(r.ts);
        return d && d >= lunes && d <= domingo;
      });

    // ── Calcular estadísticas ──
    const areas    = ['Canchita A','Canchita B','Taka Taka','Ajedrez','Sapito'];
    const carreras = ['Administración','Contabilidad'];
    const total    = registros.length;

    const porArea = {};
    areas.forEach(a => porArea[a] = registros.filter(r => r.area === a).length);

    const porCarrera = {};
    carreras.forEach(c => porCarrera[c] = registros.filter(r => r.carrera === c).length);

    const incidencias = registros.filter(r => r.estado === 'problema');
    const areasSinUso = areas.filter(a => porArea[a] === 0);
    const topArea     = areas.reduce((a, b) => porArea[a] >= porArea[b] ? a : b);
    const topPct      = total > 0 ? Math.round((porArea[topArea] / total) * 100) : 0;

    // Alertas
    const alertas = [];
    if (areasSinUso.length) alertas.push(`⚠️ Sin uso esta semana: ${areasSinUso.join(', ')}`);
    if (total > 0 && topPct >= 60) alertas.push(`🔴 ${topArea} concentra el ${topPct}% del uso`);
    if (incidencias.length) alertas.push(`🔧 ${incidencias.length} incidencia(s) pendiente(s)`);
    if (alertas.length === 0) alertas.push('✅ Todo en orden — uso bien distribuido');

    const semanaStr = `${lunes.toLocaleDateString('es-PE')} al ${domingo.toLocaleDateString('es-PE')}`;

    // ── Generar HTML del email ──
    const html = generarHTML({
      semana: semanaStr, total, porArea, porCarrera,
      incidencias, alertas, topArea, topPct, areas, carreras
    });

    // ── Enviar con Resend ──
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    EMAIL_FROM,
        to:      EMAIL_DEST.split(',').map(e => e.trim()),
        subject: `📊 RecreaBot Neumann — Reporte semanal ${semanaStr}`,
        html,
      }),
    });
    const emailData = await emailRes.json();

    if (emailData.id) {
      res.json({ ok: true, email_id: emailData.id, registros: total, semana: semanaStr });
    } else {
      res.status(500).json({ error: 'Error enviando email', detail: emailData });
    }

  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Generar HTML del reporte ──
function generarHTML({ semana, total, porArea, porCarrera, incidencias, alertas, topArea, topPct, areas, carreras }) {
  const barras = areas.map(a => {
    const n   = porArea[a];
    const pct = total > 0 ? Math.round((n / total) * 100) : 0;
    const color = { 'Canchita A':'#10b981','Canchita B':'#3b82f6','Taka Taka':'#f59e0b','Ajedrez':'#8b5cf6','Sapito':'#06b6d4' }[a] || '#64748b';
    return `
      <tr>
        <td style="padding:6px 12px;font-size:14px;color:#334155;width:120px">${a}</td>
        <td style="padding:6px 8px">
          <div style="background:#e2e8f0;border-radius:4px;height:14px;width:200px">
            <div style="background:${color};height:14px;border-radius:4px;width:${pct}%"></div>
          </div>
        </td>
        <td style="padding:6px 8px;font-size:14px;color:#64748b">${n} usos (${pct}%)</td>
      </tr>`;
  }).join('');

  const carrerasRows = carreras.map(c => `
    <tr>
      <td style="padding:6px 12px;font-size:14px;color:#334155">${c}</td>
      <td style="padding:6px 12px;font-size:14px;font-weight:700;color:#1e3a5f">${porCarrera[c]||0}</td>
    </tr>`).join('');

  const incRows = incidencias.length
    ? incidencias.map(i => `
        <tr>
          <td style="padding:6px 12px;font-size:13px;color:#dc2626">${i.area}</td>
          <td style="padding:6px 12px;font-size:13px;color:#334155">${i.problema||'Sin descripción'}</td>
          <td style="padding:6px 12px;font-size:13px;color:#64748b">${i.codigo}</td>
        </tr>`).join('')
    : '<tr><td colspan="3" style="padding:12px;font-size:13px;color:#10b981;text-align:center">✅ Sin incidencias esta semana</td></tr>';

  const alertasHtml = alertas.map(a => `
    <div style="padding:8px 14px;margin-bottom:6px;background:#f8fafc;border-left:3px solid #3b82f6;border-radius:0 6px 6px 0;font-size:14px;color:#334155">${a}</div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:600px;margin:30px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e3a5f,#0d2137);padding:28px 32px">
      <div style="font-size:28px;margin-bottom:8px">🎮</div>
      <h1 style="margin:0;color:#60a5fa;font-size:20px;font-weight:700">RecreaBot — Reporte Semanal</h1>
      <p style="margin:6px 0 0;color:#94a3b8;font-size:14px">Instituto Superior Neumann · ${semana}</p>
    </div>

    <!-- KPIs -->
    <div style="display:flex;border-bottom:1px solid #e2e8f0">
      <div style="flex:1;padding:20px;text-align:center;border-right:1px solid #e2e8f0">
        <div style="font-size:32px;font-weight:800;color:#1e3a5f">${total}</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:1px">Usos totales</div>
      </div>
      <div style="flex:1;padding:20px;text-align:center;border-right:1px solid #e2e8f0">
        <div style="font-size:20px;font-weight:800;color:#1e3a5f">${topArea}</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:1px">Área top (${topPct}%)</div>
      </div>
      <div style="flex:1;padding:20px;text-align:center">
        <div style="font-size:32px;font-weight:800;color:${incidencias.length?'#dc2626':'#10b981'}">${incidencias.length}</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:1px">Incidencias</div>
      </div>
    </div>

    <div style="padding:28px 32px">

      <!-- Alertas -->
      <h2 style="font-size:15px;color:#1e3a5f;margin:0 0 12px;font-weight:700">⚡ Alertas y recomendaciones</h2>
      ${alertasHtml}

      <!-- Uso por área -->
      <h2 style="font-size:15px;color:#1e3a5f;margin:24px 0 12px;font-weight:700">📊 Uso por área recreativa</h2>
      <table style="width:100%;border-collapse:collapse">${barras}</table>

      <!-- Uso por carrera -->
      <h2 style="font-size:15px;color:#1e3a5f;margin:24px 0 12px;font-weight:700">👥 Participación por carrera</h2>
      <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px">
        ${carrerasRows}
      </table>

      <!-- Incidencias -->
      <h2 style="font-size:15px;color:#1e3a5f;margin:24px 0 12px;font-weight:700">🔧 Incidencias reportadas</h2>
      <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px">
        <thead><tr>
          <th style="padding:8px 12px;font-size:12px;color:#64748b;text-align:left;background:#e2e8f0">Área</th>
          <th style="padding:8px 12px;font-size:12px;color:#64748b;text-align:left;background:#e2e8f0">Descripción</th>
          <th style="padding:8px 12px;font-size:12px;color:#64748b;text-align:left;background:#e2e8f0">Código</th>
        </tr></thead>
        <tbody>${incRows}</tbody>
      </table>

    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;padding:18px 32px;border-top:1px solid #e2e8f0;text-align:center">
      <p style="margin:0;font-size:12px;color:#94a3b8">Generado automáticamente por RecreaBot · Instituto Superior Neumann</p>
      <p style="margin:6px 0 0;font-size:12px;color:#94a3b8">Ver dashboard: <a href="https://recreabot-neumann.vercel.app" style="color:#3b82f6">recreabot-neumann.vercel.app</a></p>
    </div>
  </div>
</body>
</html>`;
}

// ── Parsear fecha del timestamp ──
function parseDate(ts) {
  if (!ts) return null;
  if (ts.includes('T')) return new Date(ts);
  const m = ts.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(parseInt(m[3]), parseInt(m[2])-1, parseInt(m[1]));
  return null;
}

// ── Obtener primera hoja ──
async function getFirstTab(token, sheetId) {
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const d = await r.json();
  return (d.sheets && d.sheets[0]) ? d.sheets[0].properties.title : 'Hoja 1';
}

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
