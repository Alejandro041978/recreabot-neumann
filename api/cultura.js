// api/cultura.js — Museos virtuales: listado, clics y dashboard
import { query } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const accion = req.query?.accion;

    // ── GET: listar museos (para el bot) ──
    if (req.method === 'GET' && !accion) {
      const data = await query('museos', 'GET', null, '?activo=eq.true&order=categoria.asc,nombre.asc');
      res.json({ museos: data || [] }); return;
    }

    // ── GET: redirigir clic en museo ──
    if (req.method === 'GET' && accion === 'visitar') {
      const { slug, codigo } = req.query;
      if (!slug) { res.status(400).json({ error: 'slug requerido' }); return; }

      const museoData = await query('museos', 'GET', null, `?slug=eq.${slug}&limit=1`);
      const museo = museoData?.[0];
      if (!museo) { res.status(404).json({ error: 'Museo no encontrado' }); return; }

      // Registrar clic
      await query('cultura_clics', 'POST', {
        museo_id: museo.id,
        ts: new Date().toISOString(),
        codigo: codigo || null,
      });

      // Redirigir al museo
      res.setHeader('Location', museo.url);
      res.status(302).end(); return;
    }

    // ── POST: registrar interacción con el bot ──
    if (req.method === 'POST' && accion === 'interaccion') {
      const { codigo } = req.body || {};
      await query('cultura_interacciones', 'POST', {
        ts: new Date().toISOString(),
        codigo: codigo || null,
      });
      res.json({ ok: true }); return;
    }

    // ── GET: dashboard ──
    if (req.method === 'GET' && accion === 'dashboard') {
      const [clics, interacciones, museos] = await Promise.all([
        query('cultura_clics', 'GET', null, '?order=ts.desc&limit=1000'),
        query('cultura_interacciones', 'GET', null, '?order=ts.desc&limit=1000'),
        query('museos', 'GET', null, '?activo=eq.true&order=nombre.asc'),
      ]);

      // Ranking por museo
      const porMuseo = {};
      for (const c of clics || []) {
        if (!porMuseo[c.museo_id]) porMuseo[c.museo_id] = 0;
        porMuseo[c.museo_id]++;
      }

      const ranking = (museos || [])
        .map(m => ({ ...m, clics: porMuseo[m.id] || 0 }))
        .sort((a, b) => b.clics - a.clics);

      res.json({
        total_interacciones: (interacciones || []).length,
        total_clics: (clics || []).length,
        ranking,
      }); return;
    }

    res.status(400).json({ error: 'Acción no válida' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
