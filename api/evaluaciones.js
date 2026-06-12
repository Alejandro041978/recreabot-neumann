// api/evaluaciones.js — Evaluaciones via Supabase
import { query } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    if (req.method === 'GET') {
      const data = await query('evaluaciones', 'GET', null, '?order=ts.desc&limit=100');
      res.json({ evaluaciones: data || [], total: (data || []).length });
      return;
    }

    if (req.method === 'POST') {
      const { codigo, area, fecha, horario, calificacion, estado_equipo, volveria, comentario, ts } = req.body;
      const row = {
        ts:            ts || new Date().toISOString(),
        codigo:        codigo        || '',
        area:          area          || '',
        fecha:         fecha         || '',
        horario:       horario       || '',
        calificacion:  parseInt(calificacion) || null,
        estado_equipo: estado_equipo || '',
        volveria:      volveria      || '',
        comentario:    comentario    || '',
      };
      const data = await query('evaluaciones', 'POST', row);
      res.json({ ok: true, id: data?.[0]?.id });
      return;
    }

    res.status(405).json({ error: 'Método no soportado' });

  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
