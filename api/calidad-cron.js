// api/calidad-cron.js — Cron nocturno: recalcula resumen de KPIs del periodo activo
import { query } from './_supabase.js';
import { calcularKpi, evalCumple } from './_calidad-kpis.js';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY;

async function sbFetch(path, method, body) {
  const headers = {
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
  };
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`${method} ${path}: ${t}`); }
  return r.status === 204 ? null : r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // Verificar secret del cron
  const secret = req.headers['x-vercel-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'No autorizado' }); return;
  }

  // Debug: listar agentes de Zoho para verificar emails
  if (req.query.debug === 'zoho-agents') {
    const { zohoToken: _tok, ...rest } = {};
    const r = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      }),
    });
    const tok = await r.json();
    if (!tok.access_token) { res.json({ error: 'token error', tok }); return; }
    const agentsRes = await fetch('https://desk.zoho.com/api/v1/agents?limit=50', {
      headers: { 'Authorization': `Zoho-oauthtoken ${tok.access_token}`, 'orgId': process.env.ZOHO_ORG_ID },
    });
    const agents = await agentsRes.json();
    res.json({ agents: (agents?.data || []).map(a => ({ id: a.id, email: a.emailId || a.email, name: a.firstName + ' ' + a.lastName })) });
    return;
  }

  try {
    // 1. Buscar periodo activo
    const periodos = await query('periodos_calidad', 'GET', null, '?activo=eq.true&limit=1');
    const periodo = periodos?.[0];
    if (!periodo) {
      res.json({ ok: true, msg: 'Sin periodo activo, nada que calcular' }); return;
    }

    // 2. Obtener todos los KPIs activos
    const kpis = await query('kpis_trabajador', 'GET', null, '?activo=eq.true&order=staff_id.asc');
    if (!kpis?.length) {
      res.json({ ok: true, msg: 'Sin KPIs configurados' }); return;
    }

    // 3. Obtener valores manuales guardados para este periodo
    const manuales = await query('resultados_calidad', 'GET', null, `?periodo_id=eq.${periodo.id}`);
    const manualMap = {};
    (manuales || []).forEach(m => { manualMap[`${m.staff_id}_${m.kpi_id}`] = m.valor_obtenido; });

    // 4. Obtener info de staff (nombre + email)
    const staffIds = [...new Set(kpis.map(k => k.staff_id))];
    const staffData = await query('staff', 'GET', null,
      `?id=in.(${staffIds.join(',')})&select=id,nombre,email`);
    const staffMap = {};
    (staffData || []).forEach(s => { staffMap[s.id] = s; });

    // 5. Agrupar KPIs por staff
    const porStaff = {};
    kpis.forEach(k => {
      if (!porStaff[k.staff_id]) porStaff[k.staff_id] = [];
      porStaff[k.staff_id].push(k);
    });

    // 6. Calcular y hacer upsert del resumen por cada trabajador
    const resultados = [];
    for (const staffId of staffIds) {
      const s = staffMap[staffId];
      const kpisStaff = porStaff[staffId] || [];

      const kpisCalc = await Promise.all(kpisStaff.map(async k => {
        let valor;
        if (k.fuente === 'manual') {
          valor = manualMap[`${staffId}_${k.id}`] ?? null;
        } else {
          valor = await calcularKpi(k.fuente, staffId, s?.email, periodo.fecha_inicio, periodo.fecha_fin);
        }
        const cumple = evalCumple(k.fuente, valor, k.meta_valor);
        return { cumple, valor };
      }));

      const kpisConValor = kpisCalc.filter(k => k.valor !== null);
      const kpisCumplidos = kpisCalc.filter(k => k.cumple).length;
      const tieneBono = kpisConValor.length === kpisStaff.length &&
                        kpisCumplidos === kpisStaff.length;

      resultados.push({
        periodo_id:    periodo.id,
        staff_id:      parseInt(staffId),
        kpis_cumplidos: kpisCumplidos,
        kpis_total:    kpisStaff.length,
        tiene_bono:    tieneBono,
        updated_at:    new Date().toISOString(),
      });
    }

    // Upsert todos los resúmenes en una sola llamada
    await sbFetch('calidad_resumen_trabajador?on_conflict=periodo_id,staff_id', 'POST', resultados);

    res.json({
      ok: true,
      periodo: periodo.nombre,
      trabajadores_procesados: resultados.length,
      updated_at: new Date().toISOString(),
    });

  } catch(err) {
    console.error('calidad-cron error:', err);
    res.status(500).json({ error: err.message });
  }
}
