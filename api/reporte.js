// api/reporte.js — Reporte semanal via Supabase
import { query } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const authHeader  = req.headers['authorization'] || '';
  const cronHeader  = req.headers['x-vercel-cron'] || '';
  const CRON_SECRET = process.env.CRON_SECRET || 'recreabot-neumann-2026';
  if (!cronHeader && authHeader !== `Bearer ${CRON_SECRET}`) {
    res.status(401).json({ error: 'No autorizado' }); return;
  }

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const EMAIL_DEST = process.env.EMAIL_REPORTE || 'coordinacion@neumann.edu.pe';
  const EMAIL_FROM = process.env.EMAIL_FROM    || 'RecreaBot Neumann <onboarding@resend.dev>';

  if (!RESEND_KEY) { res.status(500).json({ error: 'RESEND_API_KEY no configurada' }); return; }

  try {
    // Calcular semana anterior
    const hoy     = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
    const lunes   = new Date(hoy); lunes.setDate(hoy.getDate() - hoy.getDay() - 6); lunes.setHours(0,0,0,0);
    const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6); domingo.setHours(23,59,59,999);

    // Leer registros de la semana anterior desde Supabase
    const data = await query('registros', 'GET', null,
      `?ts=gte.${lunes.toISOString()}&ts=lte.${domingo.toISOString()}&order=ts.asc`);
    const registros = data || [];

    const areas    = ['Canchita A','Canchita B','Taka Taka','Ajedrez','Sapito'];
    const carreras = ['Administración','Contabilidad'];
    const total    = registros.length;

    const porArea    = {};
    const porCarrera = {};
    areas.forEach(a    => porArea[a]    = registros.filter(r => r.area    === a).length);
    carreras.forEach(c => porCarrera[c] = registros.filter(r => r.carrera === c).length);

    const incidencias  = registros.filter(r => r.estado === 'problema');
    const areasSinUso  = areas.filter(a => porArea[a] === 0);
    const topArea      = areas.reduce((a,b) => porArea[a] >= porArea[b] ? a : b);
    const topPct       = total > 0 ? Math.round((porArea[topArea]/total)*100) : 0;

    const alertas = [];
    if (areasSinUso.length)              alertas.push(`⚠️ Sin uso: ${areasSinUso.join(', ')}`);
    if (total > 0 && topPct >= 60)       alertas.push(`🔴 ${topArea} concentra el ${topPct}% del uso`);
    if (incidencias.length)              alertas.push(`🔧 ${incidencias.length} incidencia(s) pendiente(s)`);
    if (alertas.length === 0)            alertas.push('✅ Todo en orden — uso bien distribuido');

    const semanaStr = `${lunes.toLocaleDateString('es-PE')} al ${domingo.toLocaleDateString('es-PE')}`;
    const html      = generarHTML({ semana:semanaStr, total, porArea, porCarrera, incidencias, alertas, topArea, topPct, areas, carreras });

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to:   EMAIL_DEST.split(',').map(e => e.trim()),
        subject: `📊 RecreaBot Neumann — Reporte semanal ${semanaStr}`,
        html,
      }),
    });
    const emailData = await emailRes.json();
    if (emailData.id) res.json({ ok:true, email_id:emailData.id, registros:total, semana:semanaStr });
    else res.status(500).json({ error:'Error enviando email', detail:emailData });

  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}

function generarHTML({ semana, total, porArea, porCarrera, incidencias, alertas, topArea, topPct, areas, carreras }) {
  const colores = {'Canchita A':'#10b981','Canchita B':'#3b82f6','Taka Taka':'#f59e0b','Ajedrez':'#8b5cf6','Sapito':'#06b6d4'};
  const barras  = areas.map(a => {
    const n = porArea[a]; const pct = total > 0 ? Math.round((n/total)*100) : 0;
    return `<tr>
      <td style="padding:6px 12px;font-size:14px;color:#334155;width:120px">${a}</td>
      <td style="padding:6px 8px"><div style="background:#e2e8f0;border-radius:4px;height:14px;width:200px">
        <div style="background:${colores[a]||'#64748b'};height:14px;border-radius:4px;width:${pct}%"></div></div></td>
      <td style="padding:6px 8px;font-size:14px;color:#64748b">${n} usos (${pct}%)</td></tr>`;
  }).join('');
  const carrerasRows = carreras.map(c =>
    `<tr><td style="padding:6px 12px;font-size:14px;color:#334155">${c}</td>
     <td style="padding:6px 12px;font-size:14px;font-weight:700;color:#1e3a5f">${porCarrera[c]||0}</td></tr>`
  ).join('');
  const incRows = incidencias.length
    ? incidencias.map(i => `<tr><td style="padding:6px 12px;font-size:13px;color:#dc2626">${i.area}</td>
        <td style="padding:6px 12px;font-size:13px;color:#334155">${i.problema||'Sin descripción'}</td>
        <td style="padding:6px 12px;font-size:13px;color:#64748b">${i.codigo}</td></tr>`).join('')
    : '<tr><td colspan="3" style="padding:12px;font-size:13px;color:#10b981;text-align:center">✅ Sin incidencias</td></tr>';
  const alertasHtml = alertas.map(a =>
    `<div style="padding:8px 14px;margin-bottom:6px;background:#f8fafc;border-left:3px solid #3b82f6;border-radius:0 6px 6px 0;font-size:14px;color:#334155">${a}</div>`
  ).join('');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:600px;margin:30px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#1e3a5f,#0d2137);padding:28px 32px">
    <div style="font-size:28px;margin-bottom:8px">🎮</div>
    <h1 style="margin:0;color:#60a5fa;font-size:20px">RecreaBot — Reporte Semanal</h1>
    <p style="margin:6px 0 0;color:#94a3b8;font-size:14px">Instituto Superior Neumann · ${semana}</p>
  </div>
  <div style="display:flex;border-bottom:1px solid #e2e8f0">
    <div style="flex:1;padding:20px;text-align:center;border-right:1px solid #e2e8f0">
      <div style="font-size:32px;font-weight:800;color:#1e3a5f">${total}</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px;text-transform:uppercase">Usos totales</div>
    </div>
    <div style="flex:1;padding:20px;text-align:center;border-right:1px solid #e2e8f0">
      <div style="font-size:20px;font-weight:800;color:#1e3a5f">${topArea}</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px;text-transform:uppercase">Área top (${topPct}%)</div>
    </div>
    <div style="flex:1;padding:20px;text-align:center">
      <div style="font-size:32px;font-weight:800;color:${incidencias.length?'#dc2626':'#10b981'}">${incidencias.length}</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px;text-transform:uppercase">Incidencias</div>
    </div>
  </div>
  <div style="padding:28px 32px">
    <h2 style="font-size:15px;color:#1e3a5f;margin:0 0 12px;font-weight:700">⚡ Alertas</h2>${alertasHtml}
    <h2 style="font-size:15px;color:#1e3a5f;margin:24px 0 12px;font-weight:700">📊 Uso por área</h2>
    <table style="width:100%;border-collapse:collapse">${barras}</table>
    <h2 style="font-size:15px;color:#1e3a5f;margin:24px 0 12px;font-weight:700">👥 Por carrera</h2>
    <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px">${carrerasRows}</table>
    <h2 style="font-size:15px;color:#1e3a5f;margin:24px 0 12px;font-weight:700">🔧 Incidencias</h2>
    <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px">
      <thead><tr>
        <th style="padding:8px 12px;font-size:12px;color:#64748b;text-align:left;background:#e2e8f0">Área</th>
        <th style="padding:8px 12px;font-size:12px;color:#64748b;text-align:left;background:#e2e8f0">Descripción</th>
        <th style="padding:8px 12px;font-size:12px;color:#64748b;text-align:left;background:#e2e8f0">Código</th>
      </tr></thead><tbody>${incRows}</tbody>
    </table>
  </div>
  <div style="background:#f8fafc;padding:18px 32px;border-top:1px solid #e2e8f0;text-align:center">
    <p style="margin:0;font-size:12px;color:#94a3b8">RecreaBot · Instituto Superior Neumann · <a href="https://recreabot-neumann.vercel.app" style="color:#3b82f6">recreabot-neumann.vercel.app</a></p>
  </div>
</div></body></html>`;
}
