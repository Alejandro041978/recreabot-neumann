// api/evaluaciones.js — Email confirmación reserva + CRUD evaluaciones post-uso
import { query } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    // ── GET: listar evaluaciones ──
    if (req.method === 'GET') {
      const data = await query('evaluaciones', 'GET', null, '?order=ts.desc&limit=100');
      res.json({ evaluaciones: data || [], total: (data || []).length });
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      // ── POST: email de confirmación de reserva ──
      if (body.accion === 'email-confirmacion') {
        const RESEND_KEY = process.env.RESEND_API_KEY;
        const EMAIL_FROM = process.env.EMAIL_FROM || 'RecreaBot Neumann <onboarding@resend.dev>';
        const BASE_URL   = 'https://recreabot-neumann.vercel.app';
        if (!RESEND_KEY) { res.status(500).json({ error: 'RESEND_API_KEY no configurada' }); return; }

        const { estudiante, reserva } = body;
        if (!estudiante || !estudiante.email) {
          res.status(400).json({ error: 'Falta email del estudiante' }); return;
        }

        const nombre  = `${estudiante.nombre} ${estudiante.apellido}`.trim();
        const area    = reserva.area          || 'área recreativa';
        const fecha   = reserva.fecha_reserva || 'la fecha acordada';
        const horario = reserva.horario       || '';
        const partic  = reserva.participantes || '1';
        const codigo  = estudiante.codigo     || '';

        const emojis = { 'Canchita A': '⚽', 'Canchita B': '⚽', 'Taka Taka': '🏓', 'Ajedrez': '♟️', 'Sapito': '🐸' };
        const emoji = emojis[area] || '🎮';
        const params = new URLSearchParams({ codigo, area, fecha, horario });
        const linkEval = `${BASE_URL}/eval?${params.toString()}`;

        const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:540px;margin:30px auto;background:white;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.09)">
  <div style="background:linear-gradient(135deg,#1e3a5f 0%,#0d2137 100%);padding:32px;text-align:center">
    <div style="font-size:48px;margin-bottom:10px">${emoji}</div>
    <h1 style="margin:0;color:#60a5fa;font-size:22px;font-weight:700">¡Reserva confirmada!</h1>
    <p style="margin:8px 0 0;color:#94a3b8;font-size:14px">Instituto Superior Neumann · Espacios Recreativos</p>
  </div>
  <div style="padding:28px 32px 0">
    <p style="font-size:16px;color:#1e293b;margin:0 0 6px;font-weight:600">Hola, ${nombre} 👋</p>
    <p style="font-size:14px;color:#64748b;line-height:1.7;margin:0">Tu reserva ha sido registrada exitosamente.</p>
  </div>
  <div style="margin:24px 32px;background:#f8fafc;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:#1e3a5f;padding:10px 18px">
      <p style="margin:0;font-size:12px;font-weight:700;color:#93c5fd;text-transform:uppercase;letter-spacing:1px">Detalles de tu reserva</p>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:12px 18px;font-size:13px;color:#64748b;width:40%">Área</td><td style="padding:12px 18px;font-size:14px;color:#1e293b;font-weight:600">${emoji} ${area}</td></tr>
      <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:12px 18px;font-size:13px;color:#64748b">Fecha</td><td style="padding:12px 18px;font-size:14px;color:#1e293b;font-weight:600">${fecha}</td></tr>
      <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:12px 18px;font-size:13px;color:#64748b">Horario</td><td style="padding:12px 18px;font-size:14px;color:#1e293b;font-weight:600">${horario}</td></tr>
      <tr style="border-bottom:1px solid #e2e8f0"><td style="padding:12px 18px;font-size:13px;color:#64748b">Participantes</td><td style="padding:12px 18px;font-size:14px;color:#1e293b;font-weight:600">${partic} persona${partic !== '1' ? 's' : ''}</td></tr>
      <tr><td style="padding:12px 18px;font-size:13px;color:#64748b">Código</td><td style="padding:12px 18px;font-size:14px;color:#1e293b;font-family:monospace">${codigo}</td></tr>
    </table>
  </div>
  <div style="margin:0 32px 24px;background:#eff6ff;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;padding:14px 16px">
    <p style="margin:0;font-size:13px;color:#1e40af;font-weight:600;margin-bottom:4px">📌 Recuerda</p>
    <p style="margin:0;font-size:13px;color:#1e40af;line-height:1.6">Preséntate puntualmente. Si no puedes asistir, cancela con anticipación.</p>
  </div>
  <div style="margin:0 32px;border-top:1px dashed #e2e8f0;padding-top:24px">
    <p style="margin:0 0 6px;font-size:14px;color:#1e293b;font-weight:600">⭐ Evalúa tu experiencia</p>
    <p style="margin:0 0 16px;font-size:13px;color:#64748b;line-height:1.6">Después de usar ${area}, cuéntanos cómo estuvo.</p>
    <a href="${linkEval}" style="display:inline-block;background:#3b82f6;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Evaluar mi experiencia →</a>
  </div>
  <div style="margin:24px 0 0;background:#f8fafc;padding:18px 32px;border-top:1px solid #e2e8f0;text-align:center">
    <p style="margin:0;font-size:12px;color:#94a3b8">RecreaBot · Instituto Superior Neumann</p>
  </div>
</div></body></html>`;

        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: EMAIL_FROM, to: [estudiante.email], subject: `${emoji} Reserva confirmada — ${area} · ${fecha} · RecreaBot Neumann`, html }),
        });
        const d = await r.json();
        if (d.id) res.json({ ok: true, email_id: d.id });
        else res.status(500).json({ error: 'Error Resend', detail: d });
        return;
      }

      // ── POST: guardar evaluación post-uso ──
      const { codigo, area, fecha, horario, calificacion, estado_equipo, volveria, comentario, ts } = body;
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
