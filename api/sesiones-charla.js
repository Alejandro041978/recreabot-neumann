// api/sesiones-charla.js — Crea y valida sesiones de charla con ventana horaria
import { query } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    // ── POST: crear sesión de charla ──
    if (req.method === 'POST') {
      const { modulo, fecha, hora_inicio, hora_fin, creado_por } = req.body || {};
      if (!modulo || !fecha || !hora_inicio || !hora_fin)
        { res.status(400).json({ error: 'Campos obligatorios faltantes' }); return; }

      const data = await query('sesiones_charla', 'POST', {
        modulo, fecha, hora_inicio, hora_fin,
        creado_por: creado_por || null,
      });
      const sesion = data?.[0];
      res.json({ ok: true, token: sesion.token, id: sesion.id }); return;
    }

    // ── GET accion=validar: valida token y ventana horaria ──
    if (req.method === 'GET' && req.query?.accion === 'validar') {
      const { token } = req.query;
      if (!token) { res.status(400).json({ error: 'Token requerido' }); return; }

      const data = await query('sesiones_charla', 'GET', null, `?token=eq.${token}&limit=1`);
      const sesion = data?.[0];
      if (!sesion) { res.json({ valido: false, motivo: 'Token no existe' }); return; }

      // Verificar ventana horaria en hora Lima (UTC-5)
      const ahora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
      const horaActual = ahora.toTimeString().slice(0, 5); // HH:MM
      const fechaActual = ahora.toISOString().split('T')[0];

      if (sesion.fecha !== fechaActual) {
        res.json({ valido: false, motivo: 'Esta evaluación no corresponde a hoy' }); return;
      }
      if (horaActual < sesion.hora_inicio) {
        res.json({ valido: false, motivo: `La evaluación abre a las ${sesion.hora_inicio}` }); return;
      }
      if (horaActual >= sesion.hora_fin) {
        res.json({ valido: false, motivo: 'El período de evaluación ya cerró' }); return;
      }

      res.json({ valido: true, modulo: sesion.modulo, fecha: sesion.fecha, hora_inicio: sesion.hora_inicio, hora_fin: sesion.hora_fin }); return;
    }

    res.status(400).json({ error: 'Acción no válida' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
