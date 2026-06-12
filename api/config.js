// api/config.js — Configuración de horarios via Supabase
import { query } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    if (req.method === 'GET') {
      const data = await query('config_horarios', 'GET', null, '?order=area.asc');
      // Convertir array a objeto keyed por área
      const config = {};
      (data || []).forEach(row => {
        config[row.area] = {
          slots:     row.slots || [],
          dias:      row.dias  || 'Lunes a Domingo',
          activa:    row.activa !== false,
          tipo_slot: row.tipo_slot || '1h',
        };
      });
      res.json(config);
      return;
    }

    if (req.method === 'POST') {
      const config = req.body;
      // Upsert cada área
      for (const [area, cfg] of Object.entries(config)) {
        await query('config_horarios', 'POST', {
          area,
          slots:     cfg.slots,
          dias:      cfg.dias || 'Lunes a Domingo',
          activa:    cfg.activa !== false,
          tipo_slot: cfg.tipo_slot || '1h',
          updated_at: new Date().toISOString(),
        });
      }
      res.json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Método no soportado' });

  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
