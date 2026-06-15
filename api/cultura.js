// api/cultura.js — Museos virtuales: listado, clics, dashboard y healthcheck
import { query } from './_supabase.js';

async function checkUrl(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 Neumann-HealthCheck/1.0' },
    });
    clearTimeout(timer);
    return { ok: r.ok, status: r.status, url };
  } catch(e) {
    clearTimeout(timer);
    return { ok: false, status: null, url, error: e.message };
  }
}

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

    // ── GET: healthcheck mensual de URLs ──
    if (req.method === 'GET' && accion === 'healthcheck') {
      const secret = req.headers['x-cron-secret'] || req.query.secret;
      if (secret !== process.env.CRON_SECRET) {
        res.status(401).json({ error: 'No autorizado' }); return;
      }

      const museos = await query('museos', 'GET', null, '?activo=eq.true&order=nombre.asc');
      if (!museos?.length) { res.json({ ok: true, total: 0 }); return; }

      const resultados = await Promise.all(museos.map(m => checkUrl(m.url).then(r => ({ ...r, nombre: m.nombre, slug: m.slug }))));
      const caidos = resultados.filter(r => !r.ok);

      if (caidos.length > 0) {
        const filas = caidos.map(m =>
          `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${m.nombre}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#ef4444">${m.status ? `HTTP ${m.status}` : 'Sin respuesta / timeout'}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:0.85em;color:#64748b;word-break:break-all">${m.url}</td>
          </tr>`
        ).join('');

        const html = `
          <div style="font-family:Inter,sans-serif;max-width:640px;margin:0 auto">
            <div style="background:#0f1117;padding:24px 28px;border-radius:12px 12px 0 0">
              <p style="color:#8b5cf6;font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px">Instituto Superior Neumann</p>
              <h1 style="color:#e2e8f0;font-size:1.3rem;margin:0">⚠️ Healthcheck Museos Virtuales</h1>
            </div>
            <div style="background:#1a2235;padding:24px 28px">
              <p style="color:#94a3b8;margin:0 0 20px">Se detectaron <strong style="color:#ef4444">${caidos.length} museo${caidos.length > 1 ? 's' : ''}</strong> con links caídos o inaccesibles en la verificación mensual del ${new Date().toLocaleDateString('es-PE', { day:'numeric', month:'long', year:'numeric' })}.</p>
              <table style="width:100%;border-collapse:collapse;background:#212d42;border-radius:8px;overflow:hidden">
                <thead>
                  <tr style="background:#2a3a52">
                    <th style="padding:10px 12px;text-align:left;color:#94a3b8;font-size:0.8rem;font-weight:600">Museo</th>
                    <th style="padding:10px 12px;text-align:left;color:#94a3b8;font-size:0.8rem;font-weight:600">Estado</th>
                    <th style="padding:10px 12px;text-align:left;color:#94a3b8;font-size:0.8rem;font-weight:600">URL</th>
                  </tr>
                </thead>
                <tbody style="color:#e2e8f0;font-size:0.9rem">${filas}</tbody>
              </table>
              <p style="color:#64748b;font-size:0.8rem;margin:20px 0 0">Actualiza las URLs en la tabla <code>museos</code> de Supabase o marca el museo como inactivo (<code>activo=false</code>).</p>
            </div>
          </div>`;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || 'RecreaBot Neumann <onboarding@resend.dev>',
            to: [process.env.EMAIL_REPORTE || 'admin@balticec.com'],
            subject: `⚠️ ${caidos.length} museo${caidos.length > 1 ? 's' : ''} con link caído — Neumann`,
            html,
          }),
        });
      }

      res.json({ ok: true, total: museos.length, caidos: caidos.length, detalle: caidos }); return;
    }

    res.status(400).json({ error: 'Acción no válida' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
