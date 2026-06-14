// api/salud.js — Módulo de salud: atenciones, fichas y charlas
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
        const data = await query('fichas_salud', 'GET', null, `?codigo=eq.${codigo}&limit=1`);
        res.json({ ficha: data?.[0] || null }); return;
      }

      if (accion === 'atenciones') {
        const filtro = codigo ? `?codigo=eq.${codigo}&order=ts.desc&limit=50`
                               : '?order=ts.desc&limit=100';
        const data = await query('atenciones_salud', 'GET', null, filtro);
        res.json({ atenciones: data || [] }); return;
      }

      if (accion === 'kpis') {
        const data  = await query('atenciones_salud', 'GET', null, '?order=ts.desc&limit=1000');
        const charlas = await query('evaluaciones_charla', 'GET', null, '?order=ts.desc&limit=500');
        res.json({ atenciones: data || [], charlas: charlas || [] }); return;
      }

      res.status(400).json({ error: 'Acción no válida' }); return;
    }

    if (req.method === 'POST') {
      const { accion } = req.body || {};

      if (accion === 'atencion') {
        const { codigo, nombre, fecha_atencion, hora_atencion, motivo, resultado, notas } = req.body;
        if (!codigo || !fecha_atencion || !hora_atencion || !motivo || !resultado)
          { res.status(400).json({ error: 'Campos obligatorios faltantes' }); return; }
        const row = { ts: new Date().toISOString(), codigo, nombre: nombre||'', fecha_atencion, hora_atencion, motivo, resultado, notas: notas||'' };
        const data = await query('atenciones_salud', 'POST', row);
        res.json({ ok: true, id: data?.[0]?.id }); return;
      }

      if (accion === 'ficha') {
        const { codigo, grupo_sanguineo, estatura, enfermedades, discapacidad, conadis, seguro } = req.body;
        if (!codigo) { res.status(400).json({ error: 'Código requerido' }); return; }
        const row = { codigo, grupo_sanguineo: grupo_sanguineo||null, estatura: estatura?Number(estatura):null, enfermedades: enfermedades||null, discapacidad: discapacidad||null, conadis: conadis===true||conadis==='true', seguro: seguro||null };
        // upsert via PATCH si existe, POST si no
        const existe = await query('fichas_salud', 'GET', null, `?codigo=eq.${codigo}&limit=1`);
        if (existe?.[0]) {
          await query('fichas_salud', 'PATCH', row, `?codigo=eq.${codigo}`);
        } else {
          await query('fichas_salud', 'POST', row);
        }
        res.json({ ok: true }); return;
      }

      if (accion === 'charla') {
        const { p1, p2, p3 } = req.body;
        const vals = [p1,p2,p3].map(Number);
        if (vals.some(v => v<1||v>5||isNaN(v))) { res.status(400).json({ error: 'Valores 1-5 requeridos' }); return; }
        const data = await query('evaluaciones_charla', 'POST', { ts: new Date().toISOString(), p1:vals[0], p2:vals[1], p3:vals[2] });
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
