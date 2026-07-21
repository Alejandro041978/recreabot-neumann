// api/supervision-cron.js — Programa y dispara la supervisión semanal a la cafetería.
// Corre en las franjas 9-11 y 18-19 (Lima). Sortea 1 día/hora por semana,
// envía la alerta a la enfermera y abre una ventana de 3 horas para completar.
import { query } from './_supabase.js';

const HORAS_ALERTA = [9, 10, 11, 18, 19]; // horas Lima válidas para la alerta
const BASE_URL = 'https://recreabot-neumann.vercel.app';

function limaNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
}
function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

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
  const url = `${BASE_URL}/supervision-cafeteria`;
  const venceTxt = new Date(vence).toLocaleString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: true });
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
  <body style="margin:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:520px;margin:30px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.09)">
    <div style="background:linear-gradient(135deg,#92400e,#1e3a5f);padding:28px 32px">
      <div style="font-size:30px">🍽️</div>
      <h1 style="margin:6px 0 0;color:#fbbf24;font-size:20px">Supervisión de Cafetería</h1>
      <p style="margin:6px 0 0;color:#94a3b8;font-size:13px">Instituto Superior Neumann</p>
    </div>
    <div style="padding:26px 32px;color:#334155;font-size:14px;line-height:1.7">
      <p><strong>Hola,</strong> te corresponde realizar la supervisión semanal al concesionario de la cafetería.</p>
      <p>Ingresa al sistema con tu cuenta y completa el cuestionario (salubridad, orden y precios).</p>
      <p style="background:#fef3c7;border-left:4px solid #f59e0b;padding:10px 14px;border-radius:0 8px 8px 0;color:#92400e">
        ⏱️ Tienes <strong>3 horas</strong> para completarlo (hasta las <strong>${venceTxt}</strong>). Después se cierra automáticamente.
      </p>
      <a href="${url}" style="display:inline-block;margin-top:10px;background:#f59e0b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Realizar supervisión →</a>
    </div>
  </div></body></html>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: EMAIL_FROM, to: [email], subject: '🍽️ Supervisión de cafetería — tienes 3 horas', html }),
  }).catch(() => {});
}

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const cronHeader = req.headers['x-vercel-cron'] || '';
  const secret = req.query?.secret || '';
  const CRON_SECRET = process.env.CRON_SECRET || 'recreabot-neumann-2026';
  if (!cronHeader && authHeader !== `Bearer ${CRON_SECRET}` && secret !== CRON_SECRET) {
    res.status(401).json({ error: 'No autorizado' }); return;
  }

  try {
    const lima = limaNow();
    const dow  = lima.getDay() === 0 ? 7 : lima.getDay(); // 1=Lun .. 7=Dom
    const hora = lima.getHours();

    // Clave de semana = lunes de la semana actual (Lima)
    const monday = new Date(lima); monday.setDate(lima.getDate() - (dow - 1));
    const semana = ymd(monday);

    // 1) Cerrar supervisiones vencidas
    const nowISO = new Date().toISOString();
    await query('supervision_cafeteria', 'PATCH', { estado: 'cerrada' },
      `?estado=eq.pendiente&vence_en=lt.${nowISO}`);

    // 2) Asegurar plan de la semana
    let plan = (await query('supervision_cafeteria', 'GET', null, `?semana=eq.${semana}&limit=1`))?.[0];
    if (!plan) {
      const planDow  = 1 + Math.floor(Math.random() * 5);        // 1-5
      const planHora = HORAS_ALERTA[Math.floor(Math.random() * HORAS_ALERTA.length)];
      const creado = await query('supervision_cafeteria', 'POST', {
        semana, dow: planDow, hora: planHora, estado: 'programada',
      });
      plan = creado?.[0] || { dow: planDow, hora: planHora, estado: 'programada', semana };
    }

    // 3) Disparar si es el momento programado
    if (plan.estado === 'programada' && dow === plan.dow && hora === plan.hora) {
      const email = await emailEnfermera();
      const vence_en = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
      await query('supervision_cafeteria', 'PATCH', {
        estado: 'pendiente', alerta_en: nowISO, vence_en, supervisor_email: email,
      }, `?semana=eq.${semana}`);
      await enviarAlerta(email, vence_en);
      res.json({ ok: true, accion: 'alerta_enviada', semana, email: email || 'sin correo' }); return;
    }

    res.json({ ok: true, semana, plan: { dow: plan.dow, hora: plan.hora, estado: plan.estado }, ahora: { dow, hora } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
