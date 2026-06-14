// api/asistencia.js — Módulo de asistencia: marcaciones desde ZKTeco via Supabase
import { query } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const { accion } = req.query || {};

    // ── Estudiantes dentro del campus ahora (última entrada sin salida posterior) ──
    if (accion === 'dentro') {
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      const data = await query('asistencia', 'GET', null,
        `?fecha=gte.${hoy.toISOString()}&order=fecha.desc&limit=2000`);
      const registros = data || [];

      // Por cada persona, tomar su último registro del día
      const porPersona = {};
      registros.forEach(r => {
        if (!porPersona[r.idpersonanew]) porPersona[r.idpersonanew] = r;
      });

      // Solo los que tienen tipo=true (entrada) como último registro
      const dentro = Object.values(porPersona).filter(r => r.tipo === true);
      res.json({ dentro, total: dentro.length }); return;
    }

    // ── KPIs: ingresos por día última semana + promedios 3 y 10 semanas ──
    if (accion === 'kpis') {
      const hace70 = new Date();
      hace70.setDate(hace70.getDate() - 70);
      const data = await query('asistencia', 'GET', null,
        `?fecha=gte.${hace70.toISOString()}&tipo=eq.true&order=fecha.desc&limit=50000`);
      const registros = data || [];

      // Agrupar ingresos únicos por persona por día
      const porDia = {};
      registros.forEach(r => {
        const dia = r.fecha.substring(0, 10);
        if (!porDia[dia]) porDia[dia] = new Set();
        porDia[dia].add(r.idpersonanew);
      });

      // Últimos 7 días
      const semana = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dia = d.toISOString().substring(0, 10);
        semana.push({ dia, total: porDia[dia]?.size || 0 });
      }

      // Promedio diario últimas 3 semanas (solo días con actividad)
      const hace21 = new Date(); hace21.setDate(hace21.getDate() - 21);
      const dias3sem = Object.entries(porDia)
        .filter(([d]) => new Date(d) >= hace21)
        .map(([, set]) => set.size);
      const prom3sem = dias3sem.length
        ? Math.round(dias3sem.reduce((a, b) => a + b, 0) / dias3sem.length)
        : 0;

      // Promedio diario últimas 10 semanas (solo días con actividad)
      const dias10sem = Object.entries(porDia).map(([, set]) => set.size);
      const prom10sem = dias10sem.length
        ? Math.round(dias10sem.reduce((a, b) => a + b, 0) / dias10sem.length)
        : 0;

      res.json({ semana, prom3sem, prom10sem }); return;
    }

    res.status(400).json({ error: 'Acción no válida' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
