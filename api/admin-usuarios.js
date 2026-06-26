// api/admin-usuarios.js — Gestión de staff, roles y permisos (solo director)
import { query } from './_supabase.js';

const MODULOS = [
  'cafeteria','recreativos','salud','psicopedagogico',
  'cultura','becas','asistencia','banos','conocimientos',
];

async function verificarDirector(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) { res.status(401).json({ error: 'Token requerido' }); return null; }

  const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': process.env.SUPABASE_SECRET_KEY },
  });
  if (!userRes.ok) { res.status(401).json({ error: 'Sesión inválida' }); return null; }
  const user = await userRes.json();

  const staffData = await query('staff', 'GET', null,
    `?auth_user_id=eq.${user.id}&select=*,roles(nombre)&limit=1`);
  const staff = staffData?.[0];
  if (!staff || !staff.activo) { res.status(403).json({ error: 'Sin acceso' }); return null; }
  if (staff.roles?.nombre !== 'director') { res.status(403).json({ error: 'Solo el director puede gestionar usuarios' }); return null; }
  return staff;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const accion = req.method === 'GET' ? req.query.accion : req.body?.accion;

    // ── GET sin auth: lista de módulos disponibles ──
    if (req.method === 'GET' && accion === 'modulos') {
      res.json(MODULOS); return;
    }

    const director = await verificarDirector(req, res);
    if (!director) return;

    // ── GET ──
    if (req.method === 'GET') {
      if (accion === 'staff') {
        const data = await query('staff', 'GET', null, '?select=*,roles(nombre,descripcion)&order=id.asc');
        res.json(data || []); return;
      }
      if (accion === 'roles') {
        const data = await query('roles', 'GET', null, '?order=id.asc');
        res.json(data || []); return;
      }
      if (accion === 'permisos') {
        const rol_id = req.query.rol_id;
        const data = await query('permisos_rol', 'GET', null, `?rol_id=eq.${rol_id}`);
        res.json(data || []); return;
      }
      res.status(400).json({ error: 'Acción desconocida' }); return;
    }

    // ── POST ──
    if (req.method === 'POST') {
      const { accion: ac, ...body } = req.body;

      // Crear usuario auth + insertar en staff
      if (ac === 'crear-staff') {
        const { nombre, email, password, rol_id } = body;
        if (!nombre || !email || !password || !rol_id) {
          res.status(400).json({ error: 'Faltan campos requeridos' }); return;
        }
        // Crear usuario en Supabase Auth
        const authRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': process.env.SUPABASE_SECRET_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
          },
          body: JSON.stringify({ email, password, email_confirm: true }),
        });
        const authData = await authRes.json();
        if (!authRes.ok) {
          res.status(400).json({ error: authData.msg || authData.error || 'Error al crear usuario auth' }); return;
        }
        const auth_user_id = authData.id;
        const staff = await query('staff', 'POST', { auth_user_id, nombre, email, rol_id: parseInt(rol_id), activo: true });
        res.json({ ok: true, staff }); return;
      }

      // Crear rol
      if (ac === 'crear-rol') {
        const { nombre, descripcion } = body;
        if (!nombre) { res.status(400).json({ error: 'Nombre requerido' }); return; }
        const data = await query('roles', 'POST', { nombre, descripcion: descripcion || '' });
        res.json({ ok: true, data }); return;
      }

      // Guardar permisos de un rol
      if (ac === 'guardar-permisos') {
        const { rol_id, permisos } = body;
        // Eliminar permisos existentes del rol
        await query('permisos_rol', 'DELETE', null, `?rol_id=eq.${rol_id}`);
        // Insertar los nuevos
        if (permisos && permisos.length > 0) {
          await query('permisos_rol', 'POST', permisos.map(p => ({
            rol_id: parseInt(rol_id),
            modulo: p.modulo,
            puede_ver: p.puede_ver ?? true,
            puede_editar: p.puede_editar ?? false,
          })));
        }
        res.json({ ok: true }); return;
      }

      res.status(400).json({ error: 'Acción desconocida' }); return;
    }

    // ── PUT ──
    if (req.method === 'PUT') {
      const { accion: ac, id, ...body } = req.body;

      // Actualizar staff
      if (ac === 'staff') {
        const allowed = {};
        if (body.nombre       !== undefined) allowed.nombre       = body.nombre;
        if (body.email        !== undefined) allowed.email        = body.email;
        if (body.rol_id       !== undefined) allowed.rol_id       = parseInt(body.rol_id);
        if (body.activo       !== undefined) allowed.activo       = body.activo;
        if (body.fecha_inicio !== undefined) allowed.fecha_inicio = body.fecha_inicio || null;
        if (body.fecha_fin    !== undefined) allowed.fecha_fin    = body.fecha_fin    || null;
        await query('staff', 'PATCH', allowed, `?id=eq.${id}`);
        res.json({ ok: true }); return;
      }

      // Actualizar rol
      if (ac === 'rol') {
        const allowed = {};
        if (body.nombre      !== undefined) allowed.nombre      = body.nombre;
        if (body.descripcion !== undefined) allowed.descripcion = body.descripcion;
        await query('roles', 'PATCH', allowed, `?id=eq.${id}`);
        res.json({ ok: true }); return;
      }

      res.status(400).json({ error: 'Acción desconocida' }); return;
    }

    res.status(405).json({ error: 'Método no permitido' });

  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
