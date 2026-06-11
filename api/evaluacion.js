// api/evaluacion.js — envía email de evaluación post-uso al estudiante
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Solo POST' }); return; }

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const EMAIL_FROM = process.env.EMAIL_FROM || 'RecreaBot Neumann <onboarding@resend.dev>';
  const BASE_URL   = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://recreabot-neumann.vercel.app';

  if (!RESEND_KEY) { res.status(500).json({ error: 'RESEND_API_KEY no configurada' }); return; }

  const { estudiante, reserva } = req.body;
  if (!estudiante || !estudiante.email) {
    res.status(400).json({ error: 'Falta email del estudiante' }); return;
  }

  const nombre   = `${estudiante.nombre} ${estudiante.apellido}`.trim();
  const area     = reserva.area     || 'área recreativa';
  const fecha    = reserva.fecha_reserva || 'reciente';
  const horario  = reserva.horario  || '';

  // Generar link de evaluación con datos pre-rellenados
  const params = new URLSearchParams({
    codigo:  estudiante.codigo,
    area:    area,
    fecha:   fecha,
    horario: horario,
  });
  const linkEval = `${BASE_URL}/bot?eval=1&${params.toString()}`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:520px;margin:30px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">

    <div style="background:linear-gradient(135deg,#1e3a5f,#0d2137);padding:28px 32px;text-align:center">
      <div style="font-size:36px;margin-bottom:8px">🎮</div>
      <h1 style="margin:0;color:#60a5fa;font-size:20px;font-weight:700">¿Cómo estuvo tu experiencia?</h1>
      <p style="margin:8px 0 0;color:#94a3b8;font-size:14px">Instituto Superior Neumann</p>
    </div>

    <div style="padding:28px 32px">
      <p style="font-size:15px;color:#334155;margin:0 0 8px">Hola <strong>${nombre}</strong> 👋</p>
      <p style="font-size:14px;color:#64748b;line-height:1.6;margin:0 0 20px">
        Usaste <strong>${area}</strong> el <strong>${fecha}</strong>${horario ? ` de <strong>${horario}</strong>` : ''}.
        Tu opinión nos ayuda a mejorar los espacios recreativos del campus.
      </p>

      <p style="font-size:14px;color:#334155;font-weight:600;margin:0 0 12px">¿Cómo calificarías tu experiencia?</p>

      <div style="display:flex;gap:8px;margin-bottom:24px">
        ${[1,2,3,4,5].map(n => `
          <a href="${BASE_URL}/api/calificar?codigo=${estudiante.codigo}&area=${encodeURIComponent(area)}&fecha=${encodeURIComponent(fecha)}&nota=${n}"
             style="flex:1;text-align:center;padding:12px 6px;background:#f8fafc;border:2px solid #e2e8f0;border-radius:8px;text-decoration:none;color:#334155;font-size:20px;display:block">
            ${'⭐'.repeat(n)}<br>
            <span style="font-size:11px;color:#64748b">${['Malo','Regular','Bueno','Muy bueno','Excelente'][n-1]}</span>
          </a>`).join('')}
      </div>

      <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:20px">
        <p style="font-size:13px;color:#64748b;margin:0 0 10px;font-weight:600">O cuéntanos más en el bot:</p>
        <a href="${linkEval}"
           style="display:block;text-align:center;background:#3b82f6;color:white;padding:12px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">
          💬 Dejar comentario completo
        </a>
      </div>

      <p style="font-size:12px;color:#94a3b8;text-align:center;margin:0">
        Si tienes algún problema con las instalaciones escríbenos directo a<br>
        <a href="mailto:coordinacion@neumann.edu.pe" style="color:#3b82f6">coordinacion@neumann.edu.pe</a>
      </p>
    </div>

    <div style="background:#f8fafc;padding:14px 32px;border-top:1px solid #e2e8f0;text-align:center">
      <p style="margin:0;font-size:11px;color:#94a3b8">RecreaBot · Instituto Superior Neumann · <a href="https://recreabot-neumann.vercel.app" style="color:#3b82f6">recreabot-neumann.vercel.app</a></p>
    </div>
  </div>
</body>
</html>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    EMAIL_FROM,
        to:      [estudiante.email],
        subject: `🎮 ¿Cómo estuvo ${area}? Cuéntanos — RecreaBot Neumann`,
        html,
      }),
    });
    const d = await r.json();
    if (d.id) res.json({ ok: true, email_id: d.id });
    else res.status(500).json({ error: 'Error Resend', detail: d });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
