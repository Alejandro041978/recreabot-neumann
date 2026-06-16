// api/zoho-ticket.js — Crea tickets en Zoho Desk desde el bot
let cachedToken = null;
let cachedTokenExp = 0;

async function obtenerAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExp) return cachedToken;

  const r = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    }),
  });
  const data = await r.json();
  if (!data.access_token) throw new Error('No se pudo renovar el token de Zoho: ' + JSON.stringify(data));

  cachedToken = data.access_token;
  cachedTokenExp = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido' }); return; }

  try {
    const { codigo, nombre, email, asunto, descripcion, modulo } = req.body || {};
    if (!nombre || !descripcion) { res.status(400).json({ error: 'Faltan campos obligatorios' }); return; }

    const token = await obtenerAccessToken();

    const ticketBody = {
      subject: asunto || `Consulta de ${nombre} (${codigo || 'sin código'})`,
      departmentId: process.env.ZOHO_DEPT_ID,
      description: `${descripcion}\n\n— Generado automáticamente por RecreaBot${modulo ? ` (módulo: ${modulo})` : ''} —\nCódigo de estudiante: ${codigo || 'N/A'}`,
      contact: {
        firstName: nombre,
        email: email || `${codigo || 'sinregistro'}@neumann.education`,
      },
      priority: 'Medium',
      channel: 'Web',
    };

    const r = await fetch('https://desk.zoho.com/api/v1/tickets', {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${token}`,
        'orgId': process.env.ZOHO_ORG_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ticketBody),
    });
    const data = await r.json();
    if (!r.ok) { res.status(500).json({ error: data.message || 'Error al crear ticket en Zoho', detail: data }); return; }

    res.json({ ok: true, ticketNumber: data.ticketNumber, ticketId: data.id });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
