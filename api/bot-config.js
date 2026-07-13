// api/bot-config.js — Configuración editable del bot (nombre + instrucciones)
// GET  → público (los bots lo leen).  POST → solo director.
import { query } from './_supabase.js';

const DEFAULTS = { nombre_bot: 'John', instrucciones: '' };

async function verificarDirector(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) { res.status(401).json({ error: 'Token requerido' }); return null; }
  const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': process.env.SUPABASE_SECRET_KEY },
  });
  if (!userRes.ok) { res.status(401).json({ error: 'Sesión inválida' }); return null; }
  const user = await userRes.json();
  const staffData = await query('staff', 'GET', null, `?auth_user_id=eq.${user.id}&select=*,roles(nombre)&limit=1`);
  const staff = staffData?.[0];
  if (!staff || !staff.activo) { res.status(403).json({ error: 'Sin acceso' }); return null; }
  if (staff.roles?.nombre !== 'director') { res.status(403).json({ error: 'Solo el director puede editar la configuración del bot' }); return null; }
  return staff;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    if (req.method === 'GET') {
      const rows = await query('config_bot', 'GET', null, '?id=eq.1&limit=1');
      const cfg = rows?.[0] || {};
      res.json({
        nombre_bot:    cfg.nombre_bot    || DEFAULTS.nombre_bot,
        instrucciones: cfg.instrucciones || DEFAULTS.instrucciones,
      });
      return;
    }

    if (req.method === 'POST') {
      const director = await verificarDirector(req, res);
      if (!director) return;
      const { nombre_bot, instrucciones } = req.body || {};
      const row = {
        id: 1,
        nombre_bot: (nombre_bot || '').trim() || DEFAULTS.nombre_bot,
        instrucciones: instrucciones || '',
        updated_at: new Date().toISOString(),
      };
      const existe = await query('config_bot', 'GET', null, '?id=eq.1&limit=1');
      if (existe?.[0]) await query('config_bot', 'PATCH', row, '?id=eq.1');
      else await query('config_bot', 'POST', row);
      res.json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
