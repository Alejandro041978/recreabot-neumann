// api/cafeteria-reporte.js — Reporte semanal cafetería via Resend
import { query } from './_supabase.js';

const CRITERIOS = [
  { nombre:'Calidad e inocuidad de los alimentos',  ps:['p1','p2'] },
  { nombre:'Variedad y valor nutricional',           ps:['p3','p4'] },
  { nombre:'Atención al usuario',                    ps:['p5','p6'] },
  { nombre:'Precios y relación calidad-precio',      ps:['p7','p8'] },
  { nombre:'Cumplimiento operativo y contractual',   ps:['p9','p10'] },
];

function prom(evs, ps) {
  if (!evs.length) return null;
  const vals = evs.flatMap(e => ps.map(p => Number(e[p]))).filter(v => v > 0);
  return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
}

function promTotal(evs) {
  if (!evs.length) return null;
  const vals = evs.map(e => ['p1','p2','p3','p4','p5','p6','p7','p8','p9','p10'].map(p=>Number(e[p])).filter(v=>v>0).reduce((a,b,_,arr)=>a+b/arr.length,0));
  return vals.reduce((a,b)=>a+b,0)/vals.length;
}

function semanasFiltro(evs, semanas) {
  const corte = new Date();
  corte.setDate(corte.getDate() - semanas * 7);
  return evs.filter(e => new Date(e.ts) >= corte);
}

function estrella(v) {
  if (v === null) return '—';
  if (v >= 4.5) return '⭐⭐⭐⭐⭐';
  if (v >= 3.5) return '⭐⭐⭐⭐';
  if (v >= 2.5) return '⭐⭐⭐';
  if (v >= 1.5) return '⭐⭐';
  return '⭐';
}

function color(v) {
  if (v === null) return '#64748b';
  if (v >= 4) return '#10b981';
  if (v >= 3) return '#f59e0b';
  return '#ef4444';
}

function bloqueperiodo(titulo, evs) {
  const pt = promTotal(evs);
  const filas = CRITERIOS.map((c,i) => {
    const p = prom(evs, c.ps);
    return `<tr>
      <td style="padding:8px 12px;font-size:13px;color:#334155">${i+1}. ${c.nombre}</td>
      <td style="padding:8px 12px;font-size:14px;font-weight:700;color:${color(p)};text-align:center">${p!==null?p.toFixed(2):'—'}</td>
      <td style="padding:8px 12px;font-size:13px;text-align:center">${estrella(p)}</td>
    </tr>`;
  }).join('');
  return `
    <h3 style="font-size:14px;color:#1e3a5f;margin:24px 0 8px;font-weight:700">${titulo}
      <span style="font-size:12px;font-weight:400;color:#64748b">(${evs.length} encuesta${evs.length!==1?'s':''})</span>
    </h3>
    <div style="background:#f8fafc;border-radius:8px;padding:4px 0;margin-bottom:8px">
      <div style="text-align:center;padding:12px 0;border-bottom:1px solid #e2e8f0">
        <span style="font-size:28px;font-weight:800;color:${color(pt)}">${pt!==null?pt.toFixed(2):'—'}</span>
        <span style="font-size:13px;color:#64748b"> / 5</span>
        <div style="font-size:12px;color:#64748b;margin-top:2px">Promedio total</div>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="padding:8px 12px;font-size:11px;color:#64748b;text-align:left;background:#e2e8f0">Criterio</th>
          <th style="padding:8px 12px;font-size:11px;color:#64748b;text-align:center;background:#e2e8f0">Promedio</th>
          <th style="padding:8px 12px;font-size:11px;color:#64748b;text-align:center;background:#e2e8f0">Rating</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}

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
  const EMAIL_DEST = process.env.EMAIL_REPORTE || 'director@neumann.education';
  const EMAIL_FROM = process.env.EMAIL_FROM    || 'RecreaBot Neumann <onboarding@resend.dev>';
  if (!RESEND_KEY) { res.status(500).json({ error: 'RESEND_API_KEY no configurada' }); return; }

  try {
    const data = await query('evaluaciones_cafeteria', 'GET', null, '?order=ts.desc&limit=1000');
    const evs  = data || [];

    const sem1  = semanasFiltro(evs,  1);
    const sem3  = semanasFiltro(evs,  3);
    const sem5  = semanasFiltro(evs,  5);
    const sem10 = semanasFiltro(evs, 10);

    const hoy = new Date(new Date().toLocaleString('en-US',{timeZone:'America/Lima'}));
    const fechaStr = hoy.toLocaleDateString('es-PE',{day:'2-digit',month:'long',year:'numeric'});

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:600px;margin:30px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#92400e,#1e3a5f);padding:28px 32px">
    <div style="font-size:28px;margin-bottom:8px">☕</div>
    <h1 style="margin:0;color:#fbbf24;font-size:20px">Cafetería — Reporte Semanal</h1>
    <p style="margin:6px 0 0;color:#94a3b8;font-size:14px">Instituto Superior Neumann · ${fechaStr}</p>
  </div>
  <div style="padding:28px 32px">
    <p style="font-size:14px;color:#334155;margin-bottom:4px">Total de encuestas registradas: <strong>${evs.length}</strong></p>
    ${bloqueperiodo('Última semana', sem1)}
    ${bloqueperiodo('Últimas 3 semanas', sem3)}
    ${bloqueperiodo('Últimas 5 semanas', sem5)}
    ${bloqueperiodo('Últimas 10 semanas', sem10)}
  </div>
  <div style="background:#f8fafc;padding:18px 32px;border-top:1px solid #e2e8f0;text-align:center">
    <p style="margin:0;font-size:12px;color:#94a3b8">
      RecreaBot · Instituto Superior Neumann ·
      <a href="https://recreabot-neumann.vercel.app/cafeteria-dashboard" style="color:#f59e0b">Ver dashboard</a>
    </p>
  </div>
</div>
</body></html>`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to:   EMAIL_DEST.split(',').map(e=>e.trim()),
        subject: `☕ Cafetería Neumann — Reporte semanal ${fechaStr}`,
        html,
      }),
    });
    const emailData = await emailRes.json();
    if (emailData.id) res.json({ ok:true, email_id:emailData.id, total:evs.length });
    else res.status(500).json({ error:'Error enviando email', detail:emailData });

  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
