// api/staff-info.js — Verifica sesión y devuelve datos del staff + permisos
import { query } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) { res.status(401).json({ error: 'Token requerido' }); return; }

  try {
    // Verificar token con Supabase Auth
    const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': process.env.SUPABASE_SECRET_KEY,
      }
    });
    if (!userRes.ok) { res.status(401).json({ error: 'Sesión inválida' }); return; }
    const user = await userRes.json();

    // Buscar en tabla staff
    const staffData = await query('staff', 'GET', null,
      `?auth_user_id=eq.${user.id}&select=*,roles(nombre,descripcion)&limit=1`);
    const staff = staffData?.[0];
    if (!staff)        { res.status(403).json({ error: 'Usuario no registrado como staff' }); return; }
    if (!staff.activo) { res.status(403).json({ error: 'Usuario inactivo' }); return; }

    // Obtener permisos del rol
    const perms = await query('permisos_rol', 'GET', null,
      `?rol_id=eq.${staff.rol_id}&puede_ver=eq.true`);

    res.json({
      nombre:  staff.nombre,
      email:   staff.email,
      rol:     staff.roles?.nombre,
      modulos: (perms || []).map(p => p.modulo),
    });

  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
