// api/estudiantes.js — Estudiantes via Supabase
import { query } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    if (req.method === 'GET') {
      const codigo = req.query?.codigo;

      if (codigo) {
        // Buscar un estudiante por código
        const data = await query('estudiantes', 'GET', null,
          `?codigo=eq.${encodeURIComponent(codigo.trim())}&limit=1`);
        if (!data || data.length === 0) {
          res.json({ encontrado: false }); return;
        }
        const e = data[0];
        res.json({
          encontrado: true,
          activo:     e.activo !== false,
          codigo:     e.codigo    || '',
          nombre:     e.nombre    || '',
          apellido:   e.apellido  || '',
          carrera:    e.carrera   || '',
          email:      e.email     || '',
          whatsapp:   e.whatsapp  || '',
        });
        return;
      }

      // Listar todos
      const data = await query('estudiantes', 'GET', null, '?order=apellido.asc');
      res.json({ estudiantes: data || [], total: (data || []).length });
      return;
    }

    // POST: agregar o actualizar estudiante
    if (req.method === 'POST') {
      const est = req.body;
      if (!est.codigo) { res.status(400).json({ error: 'Falta código' }); return; }
      const data = await query('estudiantes', 'POST', est);
      res.json({ ok: true, id: data?.[0]?.id });
      return;
    }

    res.status(405).json({ error: 'Método no soportado' });

  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
