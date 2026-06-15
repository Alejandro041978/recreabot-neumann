// api/conversaciones.js — Almacena sesiones del bot y expone datos para análisis
import { query } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    // ── POST: guardar conversación al finalizar sesión ──
    if (req.method === 'POST') {
      const { session_id, codigo, carrera, modulo_final, resultado, mensajes, duracion_segundos } = req.body || {};
      if (!session_id || !Array.isArray(mensajes) || mensajes.length === 0) {
        res.status(400).json({ error: 'Datos insuficientes' }); return;
      }
      await query('conversaciones', 'POST', {
        session_id,
        codigo:            codigo            || null,
        carrera:           carrera           || null,
        modulo_final:      modulo_final      || null,
        resultado:         resultado         || 'sin_resultado',
        mensajes:          mensajes,
        duracion_segundos: duracion_segundos || null,
      });
      res.json({ ok: true }); return;
    }

    // ── GET accion=analisis: conversaciones de ayer para N8N ──
    if (req.method === 'GET' && req.query?.accion === 'analisis') {
      const secret = req.headers['x-cron-secret'] || req.query.secret;
      if (secret !== process.env.CRON_SECRET) {
        res.status(401).json({ error: 'No autorizado' }); return;
      }

      // Rango: ayer 00:00 → hoy 00:00 hora Lima (UTC-5)
      const ahora   = new Date();
      const hoyLima = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Lima' }));
      const hoy     = new Date(hoyLima); hoy.setHours(0,0,0,0);
      const ayer    = new Date(hoy);     ayer.setDate(ayer.getDate() - 1);

      // Convertir a UTC para la query
      const offset     = 5 * 60 * 60 * 1000; // UTC-5
      const ayerUTC    = new Date(ayer.getTime()    + offset).toISOString();
      const hoyUTC     = new Date(hoy.getTime()     + offset).toISOString();

      const conversaciones = await query(
        'conversaciones', 'GET', null,
        `?ts=gte.${ayerUTC}&ts=lt.${hoyUTC}&order=ts.asc&limit=200`
      );

      // Resumen estadístico
      const total       = (conversaciones || []).length;
      const porResultado = {};
      for (const c of conversaciones || []) {
        porResultado[c.resultado] = (porResultado[c.resultado] || 0) + 1;
      }

      res.json({ fecha: ayer.toLocaleDateString('es-PE'), total, porResultado, conversaciones }); return;
    }

    res.status(400).json({ error: 'Acción no válida' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
