// api/supervisor-cron.js — Supervisor diario de John: audita conversaciones y
// genera propuestas de mejora (prompt o base de conocimientos) para aprobación humana.
import { query } from './_supabase.js';

export default async function handler(req, res) {
  // Autorización: cron de Vercel o secret
  const authHeader = req.headers['authorization'] || '';
  const cronHeader = req.headers['x-vercel-cron'] || '';
  const secret = req.query?.secret || '';
  const CRON_SECRET = process.env.CRON_SECRET || 'recreabot-neumann-2026';
  if (!cronHeader && authHeader !== `Bearer ${CRON_SECRET}` && secret !== CRON_SECRET) {
    res.status(401).json({ error: 'No autorizado' }); return;
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' }); return; }

    // ── Rango: ayer completo en hora Lima (o últimas 24h si test=1) ──
    let desdeUTC, hastaUTC;
    if (req.query?.test) {
      const ahora = new Date();
      hastaUTC = ahora.toISOString();
      desdeUTC = new Date(ahora - 24 * 60 * 60 * 1000).toISOString();
    } else {
      const ahora   = new Date();
      const hoyLima = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Lima' }));
      const inicioHoy  = new Date(hoyLima); inicioHoy.setHours(0,0,0,0);
      const inicioAyer = new Date(inicioHoy); inicioAyer.setDate(inicioAyer.getDate() - 1);
      const offset = 5 * 60 * 60 * 1000;
      desdeUTC = new Date(inicioAyer.getTime() + offset).toISOString();
      hastaUTC = new Date(inicioHoy.getTime()  + offset).toISOString();
    }

    const conversaciones = await query('conversaciones', 'GET', null,
      `?ts=gte.${desdeUTC}&ts=lt.${hastaUTC}&order=ts.asc&limit=60`);

    if (!conversaciones || !conversaciones.length) {
      res.json({ ok: true, mensaje: 'Sin conversaciones para analizar', propuestas: 0 }); return;
    }

    // Config actual del bot
    const cfgRows = await query('config_bot', 'GET', null, '?id=eq.1&limit=1');
    const cfg = cfgRows?.[0] || { nombre_bot: 'John', instrucciones: '' };

    // Transcripciones compactas
    const transcripts = conversaciones.map((c, i) => {
      const msgs = Array.isArray(c.mensajes) ? c.mensajes : [];
      const texto = msgs.map(m => `${m.role === 'user' ? 'Estudiante' : 'John'}: ${m.content}`).join('\n').slice(0, 1500);
      return `--- Conversación ${i + 1} (resultado: ${c.resultado || 's/d'}) ---\n${texto}`;
    }).join('\n\n');

    const system = `Eres el supervisor de calidad de "${cfg.nombre_bot || 'John'}", el asistente virtual del Instituto Superior Neumann que atiende estudiantes: reservas de áreas recreativas, consulta de asistencia, orientación cultural (museos virtuales) y responde dudas usando SOLO la base de conocimientos (si no sabe, ofrece crear un ticket; nunca inventa).

Objetivo de ${cfg.nombre_bot || 'John'}: atender correctamente a los estudiantes, resolviendo su necesidad con información veraz y buen trato, sin inventar datos.

Instrucciones adicionales actuales (prompt secundario) de ${cfg.nombre_bot || 'John'}:
"""
${cfg.instrucciones || '(sin instrucciones adicionales)'}
"""

Revisa las conversaciones y detecta OPORTUNIDADES DE MEJORA concretas (máximo 5, solo las más relevantes; si no hay, devuelve []). Para cada una propone UNA de dos cosas:
- tipo "prompt": una instrucción breve y accionable que se AGREGARÁ al prompt secundario para corregir un comportamiento.
- tipo "conocimiento": una nueva entrada para la base de conocimientos, cuando el bot no supo responder algo que debería estar documentado.

No repitas mejoras que ya estén cubiertas por las instrucciones actuales. Sé específico y basado en lo que viste en las conversaciones.

Responde ÚNICAMENTE con un array JSON válido (sin texto adicional, sin markdown), con este formato exacto:
[
  {"tipo":"prompt","problema":"título corto del problema","resumen":"resumen de la mejora","contenido":"instrucción exacta a agregar al prompt"},
  {"tipo":"conocimiento","problema":"qué no supo responder","resumen":"agregar entrada sobre X","kb_tema":"tema","kb_pregunta":"la pregunta/título","kb_tags":"palabras,clave,separadas,por,coma","contenido":"la respuesta que debería dar (si no tienes el dato cierto, indícalo como sugerencia a completar)"}
]`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: `CONVERSACIONES A REVISAR (${conversaciones.length}):\n\n${transcripts}` }],
      }),
    });
    const data = await r.json();
    const texto = data?.content?.[0]?.text || '[]';

    // Parsear el array JSON de forma defensiva
    let propuestas = [];
    try {
      const ini = texto.indexOf('[');
      const fin = texto.lastIndexOf(']');
      propuestas = JSON.parse(texto.slice(ini, fin + 1));
    } catch (e) {
      res.status(200).json({ ok: false, error: 'No se pudo parsear la respuesta del supervisor', raw: texto.slice(0, 500) }); return;
    }

    // Insertar propuestas como pendientes
    let insertadas = 0;
    for (const p of propuestas) {
      if (!p || !p.tipo || !p.problema) continue;
      await query('bot_mejoras', 'POST', {
        tipo:        p.tipo === 'conocimiento' ? 'conocimiento' : 'prompt',
        estado:      'pendiente',
        problema:    String(p.problema).slice(0, 500),
        resumen:     p.resumen ? String(p.resumen).slice(0, 500) : null,
        contenido:   p.contenido ? String(p.contenido) : null,
        kb_tema:     p.kb_tema ? String(p.kb_tema).slice(0, 200) : null,
        kb_pregunta: p.kb_pregunta ? String(p.kb_pregunta) : null,
        kb_tags:     p.kb_tags ? String(p.kb_tags) : null,
      });
      insertadas++;
    }

    res.json({ ok: true, conversaciones: conversaciones.length, propuestas: insertadas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
