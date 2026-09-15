// api/email-test.js — Diagnóstico temporal de configuración de correo (Resend)
// Uso: GET /api/email-test?secret=XXX            → muestra config (from, si hay key)
//      GET /api/email-test?secret=XXX&to=a@b.com → envía un correo de prueba
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const secret = req.query?.secret;
  if (secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'No autorizado' }); return;
  }

  const EMAIL_FROM = process.env.EMAIL_FROM || null;
  const RESEND_KEY = process.env.RESEND_API_KEY || null;
  const info = {
    email_from: EMAIL_FROM || '(no definido — usaría onboarding@resend.dev)',
    resend_key_presente: !!RESEND_KEY,
    email_reporte: process.env.EMAIL_REPORTE || null,
  };

  const to = req.query?.to;
  if (!to) { res.json(info); return; }

  try {
    const from = EMAIL_FROM || 'Instituto Neumann <onboarding@resend.dev>';
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: '✅ Prueba de envío — Instituto Neumann',
        html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#334155">
          <p>Este es un correo de prueba del sistema RecreaBot / Neumann.</p>
          <p>Si lo recibes, la configuración de envío (<strong>${from}</strong>) funciona correctamente.</p>
        </div>`,
      }),
    });
    const data = await r.json();
    res.json({ ...info, enviado_a: to, resend_status: r.status, resend_respuesta: data });
  } catch (e) {
    res.status(500).json({ ...info, error: e.message });
  }
}
