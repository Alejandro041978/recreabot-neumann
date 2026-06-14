// api/sheets.js — Registros via Supabase (reemplaza Google Sheets)
import { query, limaTime } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (req.url && req.url.includes('debug=1')) {
    res.json({ ok: true, db: 'supabase', url: !!process.env.SUPABASE_URL, key: !!process.env.SUPABASE_SECRET_KEY });
    return;
  }

  try {
    // ── GET: leer registros ──
    if (req.method === 'GET') {
      const desde = req.query?.desde ? `&ts=gte.${req.query.desde}` : '';
      const data = await query('registros', 'GET', null, `?order=ts.desc&limit=500${desde}`);
      const registros = (data || []).map(r => ({
        ts:            limaTime(r.ts),
        codigo:        r.codigo        || '',
        carrera:       r.carrera       || '',
        area:          r.area          || '',
        participantes: r.participantes || '',
        fecha_reserva: r.fecha_reserva || '',
        horario:       r.horario       || '',
        estado:        r.estado        || 'ok',
        problema:      r.problema      || '',
        calificacion:  r.calificacion  || '',
      }));
      res.json({ registros, total: registros.length });
      return;
    }

    // ── POST: guardar registro ──
    if (req.method === 'POST') {
      const { registro } = req.body;
      if (!registro) { res.status(400).json({ error: 'Falta registro' }); return; }

      const row = {
        ts:            registro.ts || new Date().toISOString(),
        codigo:        registro.codigo        || '',
        carrera:       registro.carrera       || '',
        area:          registro.area          || '',
        participantes: registro.participantes || '',
        fecha_reserva: registro.fecha_reserva || '',
        horario:       normalizarHorario(registro.horario || ''),
        estado:        registro.estado        || 'ok',
        problema:      registro.problema      || '',
        calificacion:  registro.calificacion  || '',
      };

      const data = await query('registros', 'POST', row);
      res.json({ ok: true, id: data?.[0]?.id });
      return;
    }

    res.status(405).json({ error: 'Método no soportado' });

  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}

function normalizarHorario(h) {
  if (!h) return '';
  if (h.includes('am') || h.includes('pm')) return h;
  const mapa = {
    '8-10':'8-10am','10-12':'10am-12pm','10am-12':'10am-12pm',
    '12-2':'12-2pm','2-4':'2-4pm','4-6':'4-6pm','6-8':'6-8pm','8-10p':'8-10pm',
    '8-9':'8-9am','9-10':'9-10am','10-11':'10-11am','11-12':'11am-12pm',
    '12-1':'12-1pm','1-2':'1-2pm','2-3':'2-3pm','3-4':'3-4pm',
    '4-5':'4-5pm','5-6':'5-6pm','6-7':'6-7pm','7-8':'7-8pm',
    '8-9p':'8-9pm','9-10p':'9-10pm',
  };
  const limpio = h.replace(/\s/g,'').toLowerCase();
  for (const [key, val] of Object.entries(mapa)) {
    if (limpio === key || limpio.startsWith(key)) return val;
  }
  return h;
}
