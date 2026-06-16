// api/conocimientos.js — Base de conocimientos del Instituto Neumann
import { query } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const accion = req.query.accion || (req.body?.accion);

  try {
    // ── BUSCAR (usado por el bot) ──
    if (req.method === 'GET' && accion === 'buscar') {
      const q = (req.query.q || '').trim();
      if (!q) { res.json([]); return; }

      // Extraer palabras significativas (más de 3 caracteres)
      const palabras = [...new Set(
        q.toLowerCase().split(/\s+/).filter(w => w.length > 3)
      )].slice(0, 6);

      if (!palabras.length) { res.json([]); return; }

      // Buscar cada palabra en pregunta, respuesta y tags
      const condiciones = palabras.flatMap(p => {
        const enc = encodeURIComponent(p);
        return [`pregunta.ilike.*${enc}*`, `respuesta.ilike.*${enc}*`, `tags.ilike.*${enc}*`];
      }).join(',');

      const resultados = await query('conocimientos', 'GET', null,
        `?activo=eq.true&limit=4&or=(${condiciones})`
      );

      // Marcar entradas que son archivos (URL) vs texto
      const formateados = (resultados || []).map(d => ({
        ...d,
        es_archivo: d.respuesta?.startsWith('https://'),
      }));
      res.json(formateados);
      return;
    }

    // ── LISTAR TODOS (panel admin) ──
    if (req.method === 'GET') {
      const todos = await query('conocimientos', 'GET', null, '?order=tema.asc,creado_en.asc');
      res.json(todos || []);
      return;
    }

    // ── CREAR ──
    if (req.method === 'POST') {
      const { tema, pregunta, respuesta, tags } = req.body || {};
      if (!tema || !pregunta || !respuesta) {
        res.status(400).json({ error: 'tema, pregunta y respuesta son obligatorios' }); return;
      }
      const nuevo = await query('conocimientos', 'POST', { tema, pregunta, respuesta, tags: tags || '', activo: true });
      res.json({ ok: true, id: nuevo?.[0]?.id });
      return;
    }

    // ── ACTUALIZAR ──
    if (req.method === 'PATCH') {
      const { id, ...campos } = req.body || {};
      if (!id) { res.status(400).json({ error: 'id requerido' }); return; }
      campos.actualizado_en = new Date().toISOString();
      await query('conocimientos', 'PATCH', campos, `?id=eq.${id}`);
      res.json({ ok: true });
      return;
    }

    // ── ELIMINAR ──
    if (req.method === 'DELETE') {
      const id = req.query.id || req.body?.id;
      if (!id) { res.status(400).json({ error: 'id requerido' }); return; }
      await query('conocimientos', 'DELETE', null, `?id=eq.${id}`);
      res.json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Método no permitido' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
