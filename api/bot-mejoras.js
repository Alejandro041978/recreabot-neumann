// api/bot-mejoras.js — Propuestas de mejora del supervisor de John.
// GET lista (director). POST aprobar/rechazar (director).
// Al aprobar 'prompt' → se agrega al prompt secundario (config_bot.instrucciones).
// Al aprobar 'conocimiento' → se inserta en la base de conocimientos.
import { query } from './_supabase.js';

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
  if (staff.roles?.nombre !== 'director') { res.status(403).json({ error: 'Solo el director puede gestionar las mejoras' }); return null; }
  return staff;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const director = await verificarDirector(req, res);
    if (!director) return;

    // ── GET lista ──
    if (req.method === 'GET') {
      const estado = req.query?.estado;
      const filtro = estado ? `&estado=eq.${estado}` : '';
      const data = await query('bot_mejoras', 'GET', null, `?order=creado_en.desc&limit=200${filtro}`);
      res.json(data || []); return;
    }

    // ── POST ejecutar supervisor ahora (dispara el cron server-side) ──
    if (req.method === 'POST' && req.body?.accion === 'ejecutar') {
      const CRON_SECRET = process.env.CRON_SECRET || 'recreabot-neumann-2026';
      const r = await fetch(`https://recreabot-neumann.vercel.app/api/supervisor-cron?secret=${encodeURIComponent(CRON_SECRET)}&test=1`);
      const data = await r.json();
      res.json(data); return;
    }

    // ── POST aprobar / rechazar ──
    if (req.method === 'POST') {
      const { accion, id } = req.body || {};
      if (!id) { res.status(400).json({ error: 'id requerido' }); return; }

      const rows = await query('bot_mejoras', 'GET', null, `?id=eq.${id}&limit=1`);
      const mejora = rows?.[0];
      if (!mejora) { res.status(404).json({ error: 'Propuesta no encontrada' }); return; }
      if (mejora.estado !== 'pendiente') { res.status(400).json({ error: 'La propuesta ya fue revisada' }); return; }

      if (accion === 'rechazar') {
        await query('bot_mejoras', 'PATCH', { estado: 'rechazada', revisado_en: new Date().toISOString() }, `?id=eq.${id}`);
        res.json({ ok: true }); return;
      }

      if (accion === 'aprobar') {
        // Valores editados por el humano (si no vienen, se usan los propuestos)
        const contenido   = req.body.contenido   !== undefined ? req.body.contenido   : mejora.contenido;
        const kb_tema     = req.body.kb_tema      !== undefined ? req.body.kb_tema     : mejora.kb_tema;
        const kb_pregunta = req.body.kb_pregunta  !== undefined ? req.body.kb_pregunta : mejora.kb_pregunta;
        const kb_tags     = req.body.kb_tags      !== undefined ? req.body.kb_tags     : mejora.kb_tags;

        if (!contenido || !String(contenido).trim()) {
          res.status(400).json({ error: 'El contenido no puede estar vacío' }); return;
        }

        if (mejora.tipo === 'prompt') {
          // Agregar al prompt secundario
          const cfgRows = await query('config_bot', 'GET', null, '?id=eq.1&limit=1');
          const cfg = cfgRows?.[0] || { instrucciones: '' };
          const actual = (cfg.instrucciones || '').trim();
          const nuevo = actual ? `${actual}\n- ${String(contenido).trim()}` : `- ${String(contenido).trim()}`;
          if (cfgRows?.[0]) await query('config_bot', 'PATCH', { instrucciones: nuevo, updated_at: new Date().toISOString() }, '?id=eq.1');
          else await query('config_bot', 'POST', { id: 1, nombre_bot: 'John', instrucciones: nuevo });
        } else if (mejora.tipo === 'conocimiento') {
          // Insertar en la base de conocimientos
          await query('conocimientos', 'POST', {
            tema:      kb_tema || 'General',
            pregunta:  kb_pregunta || mejora.problema,
            respuesta: String(contenido).trim(),
            tags:      kb_tags || '',
            activo:    true,
          });
        }
        // Guardar los valores finales (editados) en el registro de la propuesta
        await query('bot_mejoras', 'PATCH', {
          estado: 'aprobada', revisado_en: new Date().toISOString(),
          contenido, kb_tema, kb_pregunta, kb_tags,
        }, `?id=eq.${id}`);
        res.json({ ok: true }); return;
      }

      res.status(400).json({ error: 'Acción no válida' }); return;
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
