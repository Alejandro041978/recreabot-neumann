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
      const rpc = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/rpc/get_asistencia_kpis`,
        { method: 'POST', headers: {
          'apikey': process.env.SUPABASE_SECRET_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
          'Content-Type': 'application/json',
        }, body: '{}' }
      );
      const kpis = await rpc.json();

      // Rellenar días faltantes en la semana
      const semanaMap = {};
      (kpis.semana || []).forEach(d => { semanaMap[d.dia] = Number(d.total); });
      const semana = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setUTCHours(12); d.setUTCDate(d.getUTCDate() - i);
        const dia = d.toISOString().substring(0, 10);
        semana.push({ dia, total: semanaMap[dia] || 0 });
      }

      res.json({ semana, prom3sem: kpis.prom3sem || 0, prom10sem: kpis.prom10sem || 0 }); return;
    }

    // ── Asistencia de un alumno específico (últimos 30 días) ──
    if (accion === 'alumno') {
      const { codigo } = req.query;
      if (!codigo) { res.status(400).json({ error: 'Código requerido' }); return; }

      // Buscar nombre del estudiante
      const estData = await query('estudiantes', 'GET', null, `?codigo=eq.${codigo}&limit=1`);
      if (!estData || !estData[0]) { res.status(404).json({ error: 'Estudiante no encontrado' }); return; }
      const est = estData[0];

      // Registros de asistencia por nombre, últimos 30 días
      const hace30 = new Date();
      hace30.setDate(hace30.getDate() - 30);
      const records = await query('asistencia', 'GET', null,
        `?nombre=eq.${encodeURIComponent(est.nombre)}&fecha=gte.${hace30.toISOString()}&order=fecha.asc&limit=500`);

      // Agrupar por fecha Lima y calcular primera entrada / última salida
      const byDate = {};
      for (const r of records || []) {
        // Fecha Lima ya está en el ISO string (datos ZKTeco sin offset)
        const key = r.fecha.substring(0, 10); // "YYYY-MM-DD"
        if (!byDate[key]) byDate[key] = { entradas: [], salidas: [] };
        if (r.tipo === true || r.tipo === 'true') byDate[key].entradas.push(r.fecha);
        else byDate[key].salidas.push(r.fecha);
      }

      // Los timestamps de ZKTeco se almacenan en hora Lima sin offset → extraer directo del ISO string
      const fmt = (iso) => iso.substring(11, 16); // "HH:MM" sin conversión de zona

      const dias = Object.entries(byDate)
        .map(([fecha, d]) => ({
          fecha,
          entrada: d.entradas.length ? fmt(d.entradas[0]) : null,
          salida:  d.salidas.length  ? fmt(d.salidas[d.salidas.length - 1]) : null,
        }))
        .sort((a, b) => b.fecha.localeCompare(a.fecha));

      res.json({ nombre: `${est.nombre} ${est.apellido || ''}`.trim(), dias, total_dias: dias.length }); return;
    }

    res.status(400).json({ error: 'Acción no válida' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
