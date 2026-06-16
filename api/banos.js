// api/banos.js — Evaluaciones de servicios higiénicos
import { query } from './_supabase.js';

const NOMBRES = {
  BH1: 'Baño Hombres 1', BH2: 'Baño Hombres 2', BH3: 'Baño Hombres 3',
  BM1: 'Baño Mujeres 1', BM2: 'Baño Mujeres 2', BM3: 'Baño Mujeres 3',
};
const ORDEN = ['BH1','BH2','BH3','BM1','BM2','BM3'];

function corte3meses() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toISOString();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const accion = req.query.accion || req.body?.accion;

  try {
    // ── GUARDAR EVALUACIÓN ──
    if (req.method === 'POST' && accion === 'guardar') {
      const { bano, p1, p2, p3 } = req.body || {};
      if (!bano || !NOMBRES[bano]) { res.status(400).json({ error: 'Baño inválido' }); return; }
      if (!p1 || !p2 || !p3) { res.status(400).json({ error: 'Faltan respuestas' }); return; }
      const promedio = ((Number(p1) + Number(p2) + Number(p3)) / 3).toFixed(2);
      await query('evaluaciones_banos', 'POST', { bano, p1: Number(p1), p2: Number(p2), p3: Number(p3), promedio });
      res.json({ ok: true });
      return;
    }

    // ── DASHBOARD / KPIs ──
    if (req.method === 'GET' && (accion === 'dashboard' || accion === 'kpis')) {
      const desde = corte3meses();
      const rows = await query('evaluaciones_banos', 'GET', null,
        `?ts=gte.${desde}&order=ts.desc`
      );
      const data = rows || [];

      const total = data.length;
      const promGlobal = total > 0
        ? (data.reduce((s, r) => s + Number(r.promedio), 0) / total).toFixed(2)
        : '0.00';

      const porBano = ORDEN.map(codigo => {
        const items = data.filter(r => r.bano === codigo);
        const n = items.length;
        const prom = n > 0 ? (items.reduce((s, r) => s + Number(r.promedio), 0) / n).toFixed(2) : '0.00';
        return { codigo, nombre: NOMBRES[codigo], n, prom: Number(prom) };
      });

      res.json({ total, promGlobal: Number(promGlobal), porBano });
      return;
    }

    // ── REPORTE SEMANAL ──
    if (req.method === 'GET' && accion === 'reporte') {
      const secret = req.headers['x-cron-secret'] || req.query.secret;
      if (secret !== process.env.CRON_SECRET) { res.status(401).json({ error: 'No autorizado' }); return; }

      const desde = corte3meses();
      const rows = await query('evaluaciones_banos', 'GET', null, `?ts=gte.${desde}&order=ts.desc`);
      const data = rows || [];
      const total = data.length;
      const promGlobal = total > 0
        ? (data.reduce((s, r) => s + Number(r.promedio), 0) / total).toFixed(2)
        : '0.00';

      const porBano = ORDEN.map(codigo => {
        const items = data.filter(r => r.bano === codigo);
        const n = items.length;
        const prom = n > 0 ? (items.reduce((s, r) => s + Number(r.promedio), 0) / n).toFixed(2) : '0.00';
        return { codigo, nombre: NOMBRES[codigo], n, prom: Number(prom) };
      });

      const filasTabla = porBano.map(b =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${b.nombre}</td>
         <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center">${b.n}</td>
         <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-weight:700;color:${b.prom >= 4 ? '#10b981' : b.prom >= 3 ? '#f59e0b' : '#ef4444'}">${b.prom}/5</td></tr>`
      ).join('');

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;background:#0f1117;color:#e2e8f0;border-radius:12px">
          <h2 style="color:#a5b4fc;margin-bottom:4px">🚻 Reporte Semanal — Servicios Higiénicos</h2>
          <p style="color:#64748b;font-size:0.85rem;margin-bottom:24px">Instituto Superior Neumann · Últimos 3 meses</p>
          <div style="display:flex;gap:16px;margin-bottom:24px">
            <div style="flex:1;background:#1a2235;border-radius:10px;padding:16px;text-align:center">
              <div style="font-size:2rem;font-weight:800;color:#a5b4fc">${total}</div>
              <div style="font-size:0.75rem;color:#64748b;margin-top:4px">Encuestas completadas</div>
            </div>
            <div style="flex:1;background:#1a2235;border-radius:10px;padding:16px;text-align:center">
              <div style="font-size:2rem;font-weight:800;color:${Number(promGlobal) >= 4 ? '#10b981' : Number(promGlobal) >= 3 ? '#f59e0b' : '#ef4444'}">${promGlobal}/5</div>
              <div style="font-size:0.75rem;color:#64748b;margin-top:4px">Promedio general</div>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;background:#1a2235;border-radius:10px;overflow:hidden">
            <thead><tr style="background:#212d42">
              <th style="padding:10px 12px;text-align:left;font-size:0.75rem;color:#64748b;text-transform:uppercase">Baño</th>
              <th style="padding:10px 12px;text-align:center;font-size:0.75rem;color:#64748b;text-transform:uppercase">Encuestas</th>
              <th style="padding:10px 12px;text-align:center;font-size:0.75rem;color:#64748b;text-transform:uppercase">Promedio</th>
            </tr></thead>
            <tbody>${filasTabla}</tbody>
          </table>
          <p style="color:#64748b;font-size:0.75rem;margin-top:20px;text-align:center">
            Ver dashboard completo en <a href="https://system.neumann.edu.pe/bano-dashboard" style="color:#a5b4fc">system.neumann.edu.pe/bano-dashboard</a>
          </p>
        </div>`;

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'Instituto Neumann <onboarding@resend.dev>',
          to: process.env.EMAIL_REPORTE || 'director@neumann.education',
          subject: `Reporte Semanal — Servicios Higiénicos · ${new Date().toLocaleDateString('es-PE')}`,
          html,
        }),
      });
      if (!emailRes.ok) { const d = await emailRes.json(); throw new Error(d.message); }
      res.json({ ok: true, total, promGlobal });
      return;
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
