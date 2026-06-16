// api/otp.js — OTP para autenticación de estudiantes
import { query } from './_supabase.js';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

function maskEmail(email) {
  if (!email) return '***@***.***';
  const [user, domain] = email.split('@');
  const masked = user.slice(0, 2) + '*'.repeat(Math.max(user.length - 2, 3));
  return `${masked}@${domain}`;
}

function generarOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido' }); return; }

  const { accion, codigo, otp } = req.body || {};

  try {
    // ── Enviar OTP ──
    if (accion === 'enviar') {
      if (!codigo) { res.status(400).json({ error: 'Código requerido' }); return; }

      // Buscar estudiante
      const estudiantes = await query('estudiantes', 'GET', null, `?codigo=eq.${encodeURIComponent(codigo)}&activo=eq.true&limit=1`);
      const est = estudiantes?.[0];
      if (!est) { res.status(404).json({ error: 'Código no encontrado o estudiante inactivo' }); return; }
      if (!est.email) { res.status(400).json({ error: 'Este estudiante no tiene email registrado. Acércate a Secretaría.' }); return; }

      // Invalidar OTPs anteriores del mismo estudiante
      await query('otps_estudiantes', 'PATCH', { usado: true }, `?codigo=eq.${encodeURIComponent(codigo)}&usado=eq.false`);

      // Generar nuevo OTP con 5 min de vigencia
      const otpCode = generarOTP();
      const expira = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      await query('otps_estudiantes', 'POST', {
        codigo, email: est.email, otp: otpCode, expira_en: expira
      });

      // Enviar email
      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'Instituto Neumann <onboarding@resend.dev>',
        to: est.email,
        subject: 'Tu código de acceso — Instituto Neumann',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0f1117;color:#e2e8f0;border-radius:12px">
            <h2 style="font-size:1.1rem;color:#a5b4fc;margin-bottom:8px">🔐 Código de acceso</h2>
            <p style="color:#94a3b8;font-size:0.9rem;margin-bottom:24px">Hola <strong style="color:#e2e8f0">${est.nombre}</strong>, usa este código para ingresar al Portal Estudiantes:</p>
            <div style="background:#1a2235;border:2px solid #6366f1;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
              <div style="font-size:2.8rem;font-weight:800;letter-spacing:12px;color:#a5b4fc">${otpCode}</div>
              <div style="font-size:0.75rem;color:#64748b;margin-top:8px">Válido por 5 minutos · Uso único</div>
            </div>
            <p style="color:#64748b;font-size:0.78rem">Si no solicitaste este código, ignora este mensaje. Nadie del Instituto te pedirá este código.</p>
          </div>
        `,
      });

      res.json({
        ok: true,
        nombre: `${est.nombre} ${est.apellido || ''}`.trim(),
        carrera: est.carrera,
        email_masked: maskEmail(est.email),
      });
      return;
    }

    // ── Verificar OTP ──
    if (accion === 'verificar') {
      if (!codigo || !otp) { res.status(400).json({ error: 'Campos requeridos' }); return; }

      const ahora = new Date().toISOString();
      const registros = await query('otps_estudiantes', 'GET', null,
        `?codigo=eq.${encodeURIComponent(codigo)}&otp=eq.${otp}&usado=eq.false&expira_en=gt.${ahora}&order=creado_en.desc&limit=1`
      );
      const reg = registros?.[0];
      if (!reg) { res.status(401).json({ error: 'Código incorrecto o expirado' }); return; }

      // Marcar OTP como usado
      await query('otps_estudiantes', 'PATCH', { usado: true }, `?id=eq.${reg.id}`);

      // Buscar datos del estudiante
      const estudiantes = await query('estudiantes', 'GET', null, `?codigo=eq.${encodeURIComponent(codigo)}&limit=1`);
      const est = estudiantes?.[0];

      // Crear sesión con 8 horas de vigencia
      const expiraSesion = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      const sesiones = await query('sesiones_estudiantes', 'POST', {
        codigo,
        email: est?.email || null,
        nombre: est ? `${est.nombre} ${est.apellido || ''}`.trim() : codigo,
        expira_en: expiraSesion,
      });
      const sesion = sesiones?.[0];

      res.json({
        ok: true,
        token: sesion.token,
        codigo,
        nombre: est ? `${est.nombre} ${est.apellido || ''}`.trim() : codigo,
        carrera: est?.carrera || null,
      });
      return;
    }

    res.status(400).json({ error: 'Acción no válida' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
