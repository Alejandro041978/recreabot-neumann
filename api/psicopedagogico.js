// api/psicopedagogico.js — Módulo psicopedagógico: atenciones, fichas, charlas y evaluaciones
import { query } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    if (req.method === 'GET') {
      const { accion, codigo, q } = req.query || {};

      if (accion === 'buscar' && q) {
        const porCodigo = await query('estudiantes', 'GET', null,
          `?codigo=ilike.*${q}*&activo=eq.true&limit=10`);
        const porNombre = await query('estudiantes', 'GET', null,
          `?or=(nombre.ilike.*${q}*,apellido.ilike.*${q}*)&activo=eq.true&limit=10`);
        const todos = [...(porCodigo||[]), ...(porNombre||[])];
        const unicos = todos.filter((e,i,a) => a.findIndex(x=>x.codigo===e.codigo)===i);
        res.json({ estudiantes: unicos }); return;
      }

      if (accion === 'ficha' && codigo) {
        const data = await query('fichas_psico', 'GET', null, `?codigo=eq.${codigo}&limit=1`);
        res.json({ ficha: data?.[0] || null }); return;
      }

      if (accion === 'atenciones') {
        const filtro = codigo
          ? `?codigo=eq.${codigo}&order=ts.desc&limit=50`
          : '?order=ts.desc&limit=100';
        const data = await query('atenciones_psico', 'GET', null, filtro);
        res.json({ atenciones: data || [] }); return;
      }

      if (accion === 'charlas' && codigo) {
        const data = await query('evaluaciones_psico_charla', 'GET', null, `?codigo=eq.${codigo}&order=ts.desc`);
        res.json({ charlas: data || [] }); return;
      }

      if (accion === 'kpis') {
        const [atenciones, charlas, evals] = await Promise.all([
          query('atenciones_psico',              'GET', null, '?order=ts.desc&limit=1000'),
          query('evaluaciones_psico_charla',     'GET', null, '?order=ts.desc&limit=500'),
          query('evaluaciones_psico_atencion',   'GET', null, '?order=ts.desc&limit=500'),
        ]);
        res.json({ atenciones: atenciones||[], charlas: charlas||[], eval_atenciones: evals||[] }); return;
      }

      res.status(400).json({ error: 'Acción no válida' }); return;
    }

    if (req.method === 'POST') {
      const { accion } = req.body || {};

      if (accion === 'atencion') {
        const { codigo, nombre, fecha_atencion, hora_atencion, tipo_atencion, canal, area_afectada, accion_realizada, resultado, notas } = req.body;
        if (!codigo || !fecha_atencion || !hora_atencion || !tipo_atencion || !canal || !area_afectada || !accion_realizada || !resultado)
          { res.status(400).json({ error: 'Campos obligatorios faltantes' }); return; }

        const row = {
          ts: new Date().toISOString(),
          codigo, nombre: nombre||'',
          fecha_atencion, hora_atencion,
          tipo_atencion, canal, area_afectada, accion_realizada, resultado,
          notas: notas||'',
        };
        const data = await query('atenciones_psico', 'POST', row);
        const atencionId = data?.[0]?.id;

        // Email de evaluación post-atención
        try {
          const estData = await query('estudiantes', 'GET', null, `?codigo=eq.${codigo}&limit=1`);
          const email = estData?.[0]?.email;
          if (email && atencionId) {
            const RESEND_KEY = process.env.RESEND_API_KEY;
            const EMAIL_FROM = process.env.EMAIL_FROM || 'RecreaBot Neumann <onboarding@resend.dev>';
            const evalUrl = `https://recreabot-neumann.vercel.app/psico-atencion-eval?id=${atencionId}`;
            const nombreEst = `${estData[0].nombre} ${estData[0].apellido||''}`.trim();
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: EMAIL_FROM,
                to: [email],
                subject: '🧠 Evalúa tu atención psicopedagógica — Instituto Neumann',
                html: `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:520px;margin:30px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#1e1b4b,#0f1117);padding:28px 32px">
    <div style="font-size:28px;margin-bottom:8px">🧠</div>
    <h1 style="margin:0;color:#a5b4fc;font-size:20px">Evalúa tu atención psicopedagógica</h1>
    <p style="margin:6px 0 0;color:#94a3b8;font-size:14px">Instituto Superior Neumann</p>
  </div>
  <div style="padding:28px 32px">
    <p style="font-size:15px;color:#334155;margin-bottom:16px">Hola <strong>${nombreEst}</strong>,</p>
    <p style="font-size:14px;color:#334155;margin-bottom:24px;line-height:1.6">
      Hoy recibiste atención en el servicio psicopedagógico del instituto. Nos gustaría conocer tu experiencia. Son solo <strong>3 preguntas rápidas</strong> y es completamente confidencial.
    </p>
    <div style="text-align:center;margin-bottom:24px">
      <a href="${evalUrl}" style="display:inline-block;background:#6366f1;color:#fff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;text-decoration:none">
        Evaluar atención →
      </a>
    </div>
    <p style="font-size:12px;color:#94a3b8;text-align:center">Tu opinión es anónima y nos ayuda a mejorar el servicio.</p>
  </div>
</div>
</body></html>`,
              }),
            });
          }
        } catch(emailErr) {
          console.error('Email error:', emailErr.message);
        }

        res.json({ ok: true, id: atencionId }); return;
      }

      if (accion === 'ficha') {
        const { codigo, derivado_por, situacion_academica, observaciones } = req.body;
        if (!codigo) { res.status(400).json({ error: 'Código requerido' }); return; }
        const row = {
          codigo,
          derivado_por: derivado_por||null,
          situacion_academica: situacion_academica||null,
          observaciones: observaciones||null,
          updated_at: new Date().toISOString(),
        };
        const existe = await query('fichas_psico', 'GET', null, `?codigo=eq.${codigo}&limit=1`);
        if (existe?.[0]) {
          await query('fichas_psico', 'PATCH', row, `?codigo=eq.${codigo}`);
        } else {
          await query('fichas_psico', 'POST', row);
        }
        res.json({ ok: true }); return;
      }

      if (accion === 'charla') {
        const { p1, p2, p3, codigo, nombre } = req.body;
        const vals = [p1,p2,p3].map(Number);
        if (vals.some(v => v<1||v>5||isNaN(v))) { res.status(400).json({ error: 'Valores 1-5 requeridos' }); return; }
        const data = await query('evaluaciones_psico_charla', 'POST', {
          ts: new Date().toISOString(), p1:vals[0], p2:vals[1], p3:vals[2],
          codigo: codigo||null, nombre: nombre||null,
        });
        res.json({ ok: true, id: data?.[0]?.id }); return;
      }

      if (accion === 'eval_atencion') {
        const { p1, p2, p3, codigo, nombre, atencion_id } = req.body;
        const vals = [p1,p2,p3].map(Number);
        if (vals.some(v => v<1||v>5||isNaN(v))) { res.status(400).json({ error: 'Valores 1-5 requeridos' }); return; }
        const data = await query('evaluaciones_psico_atencion', 'POST', {
          ts: new Date().toISOString(),
          atencion_id: atencion_id||null,
          codigo: codigo||null,
          nombre: nombre||null,
          p1: vals[0], p2: vals[1], p3: vals[2],
        });
        res.json({ ok: true, id: data?.[0]?.id }); return;
      }

      res.status(400).json({ error: 'Acción no válida' });
      return;
    }

    res.status(405).json({ error: 'Método no soportado' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
