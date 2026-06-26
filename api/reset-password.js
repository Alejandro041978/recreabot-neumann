// api/reset-password.js — Envío y verificación de código de recuperación de contraseña
import { query } from './_supabase.js';

const RESEND_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = 'Sistema Neumann <onboarding@resend.dev>';
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY;

function codigo6() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function supabaseAdmin(path, method, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=minimal' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return text?.trim() ? JSON.parse(text) : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Solo POST' }); return; }

  const { accion, email, code, new_password } = req.body;

  // ── 1. Solicitar código ──
  if (accion === 'solicitar') {
    if (!email) { res.status(400).json({ error: 'Falta email' }); return; }

    // Verificar que el email existe en staff
    const staff = await query('staff', 'GET', null, `?email=eq.${encodeURIComponent(email)}&select=id,nombre&limit=1`);
    if (!staff?.length) { res.status(404).json({ error: 'Email no encontrado' }); return; }

    const nombre = staff[0].nombre;
    const codigo = codigo6();
    const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutos

    // Invalidar códigos anteriores del mismo email
    await fetch(`${SB_URL}/rest/v1/reset_codes?email=eq.${encodeURIComponent(email)}&used=eq.false`, {
      method: 'PATCH',
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ used: true }),
    });

    // Guardar nuevo código
    await supabaseAdmin('reset_codes', 'POST', { email, code: codigo, expires_at });

    // Enviar email con Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [email],
        subject: 'Código de recuperación — Sistema Neumann',
        html: `
          <div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:32px;background:#0f1117;color:#e2e8f0;border-radius:12px">
            <h2 style="color:#60a5fa;margin-bottom:8px">🔐 Recuperación de contraseña</h2>
            <p style="color:#94a3b8;margin-bottom:24px">Hola <strong style="color:#e2e8f0">${nombre}</strong>, usa este código para restablecer tu contraseña:</p>
            <div style="background:#1a2235;border:2px solid #3b82f6;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
              <span style="font-size:2.5rem;font-weight:800;letter-spacing:12px;color:#60a5fa">${codigo}</span>
            </div>
            <p style="color:#64748b;font-size:0.82rem">Este código expira en <strong>5 minutos</strong>. Si no solicitaste este código, ignora este mensaje.</p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) { res.status(500).json({ error: 'Error enviando email' }); return; }
    res.json({ ok: true });
    return;
  }

  // ── 2. Verificar código y cambiar contraseña ──
  if (accion === 'verificar') {
    if (!email || !code || !new_password) { res.status(400).json({ error: 'Faltan datos' }); return; }
    if (new_password.length < 8) { res.status(400).json({ error: 'Contraseña muy corta' }); return; }

    // Buscar código válido
    const rows = await query('reset_codes', 'GET', null,
      `?email=eq.${encodeURIComponent(email)}&code=eq.${code}&used=eq.false&order=created_at.desc&limit=1`);

    if (!rows?.length) { res.status(400).json({ error: 'Código incorrecto' }); return; }
    const row = rows[0];
    if (new Date(row.expires_at) < new Date()) { res.status(400).json({ error: 'Código expirado' }); return; }

    // Marcar como usado
    await fetch(`${SB_URL}/rest/v1/reset_codes?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ used: true }),
    });

    // Actualizar contraseña en Supabase Auth usando service role
    const authRes = await fetch(`${SB_URL}/auth/v1/admin/users`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    });
    // Buscar user por email
    const usersPage = await fetch(`${SB_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    });
    const usersData = await usersPage.json();
    const user = (usersData.users || []).find(u => u.email === email);
    if (!user) { res.status(404).json({ error: 'Usuario no encontrado en Auth' }); return; }

    const updateRes = await fetch(`${SB_URL}/auth/v1/admin/users/${user.id}`, {
      method: 'PUT',
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: new_password }),
    });

    if (!updateRes.ok) {
      const err = await updateRes.text();
      res.status(500).json({ error: 'Error actualizando contraseña: ' + err }); return;
    }

    res.json({ ok: true });
    return;
  }

  res.status(400).json({ error: 'Acción desconocida' });
}
