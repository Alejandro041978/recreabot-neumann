// api/calidad.js — Sistema de Mes Calidad: periodos, KPIs bonificables y dashboard de desempeño
import { query } from './_supabase.js';
import { calcularKpi, evalCumple } from './_calidad-kpis.js';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY;

async function sbFetch(path, method, body) {
  const headers = {
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
  };
  if (method === 'POST') headers['Prefer'] = 'return=representation';
  if (method === 'PATCH') headers['Prefer'] = 'return=minimal';
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`${method} ${path}: ${t}`); }
  return r.status === 204 ? null : r.json();
}

async function verificarDirector(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) { res.status(401).json({ error: 'Token requerido' }); return null; }
  const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SB_KEY },
  });
  if (!userRes.ok) { res.status(401).json({ error: 'Sesión inválida' }); return null; }
  const user = await userRes.json();
  const staffData = await query('staff', 'GET', null,
    `?auth_user_id=eq.${user.id}&select=*,roles(nombre)&limit=1`);
  const staff = staffData?.[0];
  if (!staff?.activo || staff.roles?.nombre !== 'director') {
    res.status(403).json({ error: 'Solo el director puede acceder' }); return null;
  }
  return staff;
}


export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const director = await verificarDirector(req, res);
    if (!director) return;

    const accion = req.method === 'GET' ? req.query.accion : req.body?.accion;

    // ── GET periodos ──
    if (req.method === 'GET' && accion === 'periodos') {
      const data = await query('periodos_calidad', 'GET', null, '?order=fecha_inicio.desc');
      res.json(data || []); return;
    }

    // ── GET staff disponibles para asignar KPIs ──
    if (req.method === 'GET' && accion === 'staff') {
      const data = await query('staff', 'GET', null,
        '?activo=eq.true&select=id,nombre,email,roles(nombre)&order=nombre.asc');
      res.json(data || []); return;
    }

    // ── GET KPIs de un trabajador ──
    if (req.method === 'GET' && accion === 'kpis') {
      const { staff_id } = req.query;
      const data = await query('kpis_trabajador', 'GET', null,
        `?staff_id=eq.${staff_id}&order=id.asc`);
      res.json(data || []); return;
    }

    // ── GET resumen cacheado del cron (lista rápida) ──
    if (req.method === 'GET' && accion === 'resumen') {
      const { periodo_id } = req.query;
      if (!periodo_id) { res.status(400).json({ error: 'periodo_id requerido' }); return; }
      const [resumen, staffData] = await Promise.all([
        query('calidad_resumen_trabajador', 'GET', null, `?periodo_id=eq.${periodo_id}&order=staff_id.asc`),
        query('staff', 'GET', null, '?activo=eq.true&select=id,nombre,email,roles(nombre)&order=nombre.asc'),
      ]);
      const staffMap = {};
      (staffData || []).forEach(s => { staffMap[s.id] = s; });
      const rows = (resumen || []).map(r => ({
        ...r,
        staff: staffMap[r.staff_id] || { id: r.staff_id, nombre: '—', rol: '—' },
      }));
      res.json(rows); return;
    }

    // ── GET detalle en tiempo real de un trabajador ──
    if (req.method === 'GET' && accion === 'detalle') {
      const { periodo_id, staff_id } = req.query;
      if (!periodo_id || !staff_id) { res.status(400).json({ error: 'periodo_id y staff_id requeridos' }); return; }

      const [periodos, kpis, staffData, manuales] = await Promise.all([
        query('periodos_calidad', 'GET', null, `?id=eq.${periodo_id}&limit=1`),
        query('kpis_trabajador', 'GET', null, `?staff_id=eq.${staff_id}&activo=eq.true&order=id.asc`),
        query('staff', 'GET', null, `?id=eq.${staff_id}&select=id,nombre,email,roles(nombre)&limit=1`),
        query('resultados_calidad', 'GET', null, `?periodo_id=eq.${periodo_id}&staff_id=eq.${staff_id}`),
      ]);

      const periodo = periodos?.[0];
      const staff = staffData?.[0];
      if (!periodo || !staff) { res.status(404).json({ error: 'No encontrado' }); return; }

      const manualMap = {};
      (manuales || []).forEach(m => { manualMap[m.kpi_id] = m.valor_obtenido; });

      const kpisCalc = await Promise.all((kpis || []).map(async k => {
        let valor;
        if (k.fuente === 'manual') {
          valor = manualMap[k.id] ?? null;
        } else {
          valor = await calcularKpi(k.fuente, staff_id, staff.email, periodo.fecha_inicio, periodo.fecha_fin);
        }
        const cumple = evalCumple(k.fuente, valor, k.meta_valor);
        return { ...k, valor_obtenido: valor, cumple };
      }));

      res.json({ periodo, staff, kpis: kpisCalc }); return;
    }

    // ── GET dashboard de desempeño para un periodo ──
    if (req.method === 'GET' && accion === 'dashboard') {
      const { periodo_id } = req.query;
      if (!periodo_id) { res.status(400).json({ error: 'periodo_id requerido' }); return; }

      const periodos = await query('periodos_calidad', 'GET', null, `?id=eq.${periodo_id}&limit=1`);
      const periodo = periodos?.[0];
      if (!periodo) { res.status(404).json({ error: 'Periodo no encontrado' }); return; }

      // KPIs de todos los trabajadores activos
      const kpis = await query('kpis_trabajador', 'GET', null,
        '?activo=eq.true&order=staff_id.asc,id.asc');
      if (!kpis?.length) { res.json({ periodo, trabajadores: [] }); return; }

      // Valores manuales ya guardados para este periodo
      const manuales = await query('resultados_calidad', 'GET', null,
        `?periodo_id=eq.${periodo_id}`);
      const manualMap = {};
      (manuales || []).forEach(m => { manualMap[`${m.staff_id}_${m.kpi_id}`] = m.valor_obtenido; });

      // Agrupar KPIs por staff_id
      const porStaff = {};
      kpis.forEach(k => {
        if (!porStaff[k.staff_id]) porStaff[k.staff_id] = [];
        porStaff[k.staff_id].push(k);
      });

      // Calcular cada KPI
      const staffIds = Object.keys(porStaff);
      const staffData = await query('staff', 'GET', null,
        `?id=in.(${staffIds.join(',')})&select=id,nombre,email,roles(nombre)`);
      const staffMap = {};
      (staffData || []).forEach(s => { staffMap[s.id] = s; });

      const trabajadores = await Promise.all(staffIds.map(async staffId => {
        const s = staffMap[staffId];
        const kpisStaff = porStaff[staffId];

        const kpisCalc = await Promise.all(kpisStaff.map(async k => {
          let valor;
          if (k.fuente === 'manual') {
            valor = manualMap[`${staffId}_${k.id}`] ?? null;
          } else {
            valor = await calcularKpi(k.fuente, staffId, staffMap[staffId]?.email, periodo.fecha_inicio, periodo.fecha_fin);
          }
          const cumple = valor !== null ? valor >= k.meta_valor : false;
          return { ...k, valor_obtenido: valor, cumple };
        }));

        const todosCalculados = kpisCalc.every(k => k.valor_obtenido !== null);
        const conBono = todosCalculados && kpisCalc.every(k => k.cumple);

        return {
          staff: { id: s?.id, nombre: s?.nombre, rol: s?.roles?.nombre },
          kpis: kpisCalc,
          con_bono: conBono,
          total_kpis: kpisCalc.length,
          kpis_cumplidos: kpisCalc.filter(k => k.cumple).length,
          tiene_manuales_pendientes: kpisCalc.some(k => k.fuente === 'manual' && k.valor_obtenido === null),
        };
      }));

      res.json({ periodo, trabajadores }); return;
    }

    // ── POST crear periodo ──
    if (req.method === 'POST' && accion === 'periodo') {
      const { nombre, fecha_inicio, fecha_fin, activo } = req.body;
      if (!nombre || !fecha_inicio || !fecha_fin)
        { res.status(400).json({ error: 'Faltan campos' }); return; }
      if (activo) await sbFetch('periodos_calidad?activo=eq.true', 'PATCH', { activo: false });
      const data = await sbFetch('periodos_calidad', 'POST',
        { nombre, fecha_inicio, fecha_fin, activo: !!activo });
      res.json({ ok: true, data }); return;
    }

    // ── POST crear KPI ──
    if (req.method === 'POST' && accion === 'kpi') {
      const { staff_id, nombre_kpi, descripcion, meta_valor, unidad, fuente } = req.body;
      if (!staff_id || !nombre_kpi || meta_valor === undefined || !fuente)
        { res.status(400).json({ error: 'Faltan campos' }); return; }
      const data = await sbFetch('kpis_trabajador', 'POST',
        { staff_id: parseInt(staff_id), nombre_kpi, descripcion: descripcion || '', meta_valor: Number(meta_valor), unidad: unidad || '', fuente, activo: true });
      res.json({ ok: true, data }); return;
    }

    // ── POST guardar valor manual ──
    if (req.method === 'POST' && accion === 'valor-manual') {
      const { periodo_id, staff_id, kpi_id, valor } = req.body;
      if (!periodo_id || !staff_id || !kpi_id || valor === undefined)
        { res.status(400).json({ error: 'Faltan campos' }); return; }
      // Upsert
      await sbFetch(`resultados_calidad?periodo_id=eq.${periodo_id}&staff_id=eq.${staff_id}&kpi_id=eq.${kpi_id}`, 'DELETE');
      await sbFetch('resultados_calidad', 'POST',
        { periodo_id, staff_id: parseInt(staff_id), kpi_id: parseInt(kpi_id), valor_obtenido: Number(valor) });
      res.json({ ok: true }); return;
    }

    // ── PUT actualizar periodo ──
    if (req.method === 'PUT' && accion === 'periodo') {
      const { id, nombre, fecha_inicio, fecha_fin, activo } = req.body;
      if (activo) await sbFetch('periodos_calidad?activo=eq.true', 'PATCH', { activo: false });
      await sbFetch(`periodos_calidad?id=eq.${id}`, 'PATCH',
        { nombre, fecha_inicio, fecha_fin, activo: !!activo });
      res.json({ ok: true }); return;
    }

    // ── PUT actualizar KPI ──
    if (req.method === 'PUT' && accion === 'kpi') {
      const { id, nombre_kpi, descripcion, meta_valor, unidad, fuente, activo } = req.body;
      const updates = {};
      if (nombre_kpi  !== undefined) updates.nombre_kpi  = nombre_kpi;
      if (descripcion !== undefined) updates.descripcion = descripcion;
      if (meta_valor  !== undefined) updates.meta_valor  = Number(meta_valor);
      if (unidad      !== undefined) updates.unidad      = unidad;
      if (fuente      !== undefined) updates.fuente      = fuente;
      if (activo      !== undefined) updates.activo      = activo;
      await sbFetch(`kpis_trabajador?id=eq.${id}`, 'PATCH', updates);
      res.json({ ok: true }); return;
    }

    // ── DELETE KPI ──
    if (req.method === 'DELETE' && accion === 'kpi') {
      const { id } = req.query;
      await sbFetch(`kpis_trabajador?id=eq.${id}`, 'DELETE');
      res.json({ ok: true }); return;
    }

    res.status(400).json({ error: 'Acción no encontrada' });

  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
