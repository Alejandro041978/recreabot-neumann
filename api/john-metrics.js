// api/john-metrics.js — Métricas de John (web + WhatsApp): conversaciones,
// resultados, canal y carrera, filtrable por 1d / 7d / 30d / acumulado.
import { query } from './_supabase.js';

const RES_MAP = {
  reserva_completada: 'Reserva',        reserva: 'Reserva',
  asistencia_mostrada: 'Asistencia',    asistencia: 'Asistencia',
  cultura_enviada: 'Cultura / Museos',  cultura: 'Cultura / Museos',
  ticket_creado: 'Ticket de soporte',
  no_identificado: 'No identificado',
  sin_resultado: 'Sin resultado',
};
function labelRes(v) { return RES_MAP[v] || (v ? v : 'Sin resultado'); }

async function verificarStaff(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) { res.status(401).json({ error: 'Token requerido' }); return null; }
  const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': process.env.SUPABASE_SECRET_KEY },
  });
  if (!userRes.ok) { res.status(401).json({ error: 'Sesión inválida' }); return null; }
  const user = await userRes.json();
  const staff = (await query('staff', 'GET', null, `?auth_user_id=eq.${user.id}&limit=1`))?.[0];
  if (!staff || !staff.activo) { res.status(403).json({ error: 'Sin acceso' }); return null; }
  return staff;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const staff = await verificarStaff(req, res);
    if (!staff) return;

    const dias = req.query?.dias || 'all';
    let filtroTs = '', filtroWa = '';
    if (dias !== 'all') {
      const n = parseInt(dias, 10) || 1;
      const desde = new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
      filtroTs = `&ts=gte.${desde}`;
      filtroWa = `&updated_at=gte.${desde}`;
    }

    const [web, wa] = await Promise.all([
      query('conversaciones', 'GET', null, `?select=carrera,resultado,ts&order=ts.desc&limit=5000${filtroTs}`),
      query('whatsapp_conversaciones', 'GET', null, `?select=carrera,modulo,updated_at&order=updated_at.desc&limit=5000${filtroWa}`).catch(() => []),
    ]);

    const porCanal = { Web: (web || []).length, WhatsApp: (wa || []).length };
    const total = porCanal.Web + porCanal.WhatsApp;
    const porResultado = {};
    const porCarrera = {};

    (web || []).forEach(c => {
      const r = labelRes(c.resultado); porResultado[r] = (porResultado[r] || 0) + 1;
      const ca = c.carrera || 'Sin dato';  porCarrera[ca] = (porCarrera[ca] || 0) + 1;
    });
    (wa || []).forEach(c => {
      const r = labelRes(c.modulo); porResultado[r] = (porResultado[r] || 0) + 1;
      const ca = c.carrera || 'Sin dato'; porCarrera[ca] = (porCarrera[ca] || 0) + 1;
    });

    const toSorted = obj => Object.entries(obj).map(([k, v]) => ({ label: k, valor: v })).sort((a, b) => b.valor - a.valor);

    res.json({
      total,
      por_canal:     toSorted(porCanal),
      por_resultado: toSorted(porResultado),
      por_carrera:   toSorted(porCarrera),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
