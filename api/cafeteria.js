// api/cafeteria.js — Evaluaciones cafetería via Supabase
import { query } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    if (req.method === 'GET') {
      const data = await query('evaluaciones_cafeteria', 'GET', null, '?order=ts.desc&limit=200');
      res.json({ evaluaciones: data || [], total: (data || []).length });
      return;
    }

    if (req.method === 'POST') {
      const { p1,p2,p3,p4,p5,p6,p7,p8,p9,p10 } = req.body;
      const vals = [p1,p2,p3,p4,p5,p6,p7,p8,p9,p10].map(Number);
      if (vals.some(v => v < 1 || v > 5 || isNaN(v))) {
        res.status(400).json({ error: 'Todas las respuestas deben ser entre 1 y 5' }); return;
      }
      const row = { ts: new Date().toISOString(), p1:vals[0],p2:vals[1],p3:vals[2],p4:vals[3],p5:vals[4],p6:vals[5],p7:vals[6],p8:vals[7],p9:vals[8],p10:vals[9] };
      const data = await query('evaluaciones_cafeteria', 'POST', row);
      res.json({ ok: true, id: data?.[0]?.id });
      return;
    }

    res.status(405).json({ error: 'Método no soportado' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
