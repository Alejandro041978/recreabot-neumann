// api/supervision-cafeteria.js — Cuestionario de supervisión a la cafetería.
// GET pendiente / historial (staff). POST responder (staff).
import { query } from './_supabase.js';

async function verificarStaff(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) { res.status(401).json({ error: 'Token requerido' }); return null; }
  const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': process.env.SUPABASE_SECRET_KEY },
  });
  if (!userRes.ok) { res.status(401).json({ error: 'Sesión inválida' }); return null; }
  const user = await userRes.json();
  const staff = (await query('staff', 'GET', null, `?auth_user_id=eq.${user.id}&select=*,roles(nombre)&limit=1`))?.[0];
  if (!staff || !staff.activo) { res.status(403).json({ error: 'Sin acceso' }); return null; }
  return staff;
}

async function emailEnfermera() {
  try {
    const rol = (await query('roles', 'GET', null, '?nombre=ilike.enfermera&limit=1'))?.[0];
    if (!rol) return null;
    const st = (await query('staff', 'GET', null, `?rol_id=eq.${rol.id}&activo=eq.true&limit=1`))?.[0];
    return st?.email || null;
  } catch (e) { return null; }
}

async function enviarAlerta(email, vence) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const EMAIL_FROM = process.env.EMAIL_FROM || 'RecreaBot Neumann <onboarding@resend.dev>';
  if (!RESEND_KEY || !email) return;
  const url = 'https://recreabot-neumann.vercel.app/supervision-cafeteria';
  const venceTxt = new Date(vence).toLocaleString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: true });
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#334155">
    <h2 style="color:#b45309">🍽️ Supervisión de Cafetería</h2>
    <p>Te corresponde realizar la supervisión al concesionario de la cafetería. Ingresa al sistema y completa el cuestionario.</p>
    <p style="background:#fef3c7;border-left:4px solid #f59e0b;padding:10px 14px">⏱️ Tienes <strong>3 horas</strong> (hasta las <strong>${venceTxt}</strong>). Después se cierra.</p>
    <p><a href="${url}" style="background:#f59e0b;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:700">Realizar supervisión →</a></p>
  </div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [email], subject: '🍽️ Supervisión de cafetería — tienes 3 horas', html }),
  }).catch(() => {});
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const staff = await verificarStaff(req, res);
    if (!staff) return;

    // ── GET: supervisión pendiente vigente ──
    if (req.method === 'GET' && req.query?.accion === 'pendiente') {
      // Cerrar vencidas primero (por si el cron no corrió aún)
      await query('supervision_cafeteria', 'PATCH', { estado: 'cerrada' },
        `?estado=eq.pendiente&vence_en=lt.${new Date().toISOString()}`);
      const p = (await query('supervision_cafeteria', 'GET', null,
        `?estado=eq.pendiente&order=alerta_en.desc&limit=1`))?.[0] || null;
      res.json({ pendiente: p }); return;
    }

    // ── GET: historial ──
    if (req.method === 'GET' && req.query?.accion === 'historial') {
      const data = await query('supervision_cafeteria', 'GET', null,
        '?estado=in.(completada,cerrada)&order=semana.desc&limit=100');
      res.json(data || []); return;
    }

    // ── POST: generar supervisión de prueba (solo director) ──
    if (req.method === 'POST' && req.body?.accion === 'prueba') {
      if (staff.roles?.nombre !== 'director') { res.status(403).json({ error: 'Solo el director puede generar una prueba' }); return; }
      // No duplicar si ya hay una pendiente
      const yaPend = (await query('supervision_cafeteria', 'GET', null, '?estado=eq.pendiente&limit=1'))?.[0];
      if (yaPend) { res.json({ ok: true, mensaje: 'Ya hay una supervisión pendiente' }); return; }

      const email = await emailEnfermera();
      const vence_en = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
      const hoy = new Date().toLocaleDateString('es-PE', { timeZone: 'America/Lima' });
      await query('supervision_cafeteria', 'POST', {
        semana: `PRUEBA ${hoy}`, estado: 'pendiente',
        alerta_en: new Date().toISOString(), vence_en, supervisor_email: email,
      });
      await enviarAlerta(email, vence_en);
      res.json({ ok: true, email: email || 'sin correo de enfermera' }); return;
    }

    // ── POST: responder ──
    if (req.method === 'POST' && req.body?.accion === 'responder') {
      const { id, respuestas, obs_salubridad, obs_orden, obs_precios, obs_general } = req.body;
      if (!id || !respuestas) { res.status(400).json({ error: 'Datos incompletos' }); return; }

      const p = (await query('supervision_cafeteria', 'GET', null, `?id=eq.${id}&limit=1`))?.[0];
      if (!p) { res.status(404).json({ error: 'Supervisión no encontrada' }); return; }
      if (p.estado !== 'pendiente') { res.status(400).json({ error: 'Esta supervisión ya no está disponible' }); return; }
      if (p.vence_en && new Date(p.vence_en) < new Date()) {
        await query('supervision_cafeteria', 'PATCH', { estado: 'cerrada' }, `?id=eq.${id}`);
        res.status(400).json({ error: 'El plazo de 3 horas ya venció' }); return;
      }

      // respuestas: { q1..q12 } con valores 0/1/2
      const claves = ['q1','q2','q3','q4','q5','q6','q7','q8','q9','q10','q11','q12'];
      const updates = {};
      let puntaje = 0;
      for (const k of claves) {
        const v = Math.max(0, Math.min(2, parseInt(respuestas[k], 10) || 0));
        updates[k] = v; puntaje += v;
      }
      updates.puntaje = puntaje;
      updates.porcentaje = Math.round((puntaje / 24) * 1000) / 10;
      updates.obs_salubridad = obs_salubridad || null;
      updates.obs_orden = obs_orden || null;
      updates.obs_precios = obs_precios || null;
      updates.obs_general = obs_general || null;
      updates.estado = 'completada';
      updates.completado_en = new Date().toISOString();
      updates.supervisor_nombre = staff.nombre || null;

      await query('supervision_cafeteria', 'PATCH', updates, `?id=eq.${id}`);
      res.json({ ok: true, puntaje, porcentaje: updates.porcentaje }); return;
    }

    res.status(400).json({ error: 'Acción no válida' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
