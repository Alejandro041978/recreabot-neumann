// api/_calidad-kpis.js — Lógica compartida de cálculo de KPIs (usado por calidad.js y calidad-cron.js)
import { query } from './_supabase.js';

// Cache en memoria (válido mientras la función esté caliente)
let _zohoToken = null;
let _zohoTokenExp = 0;

const SB_URL_KPI = process.env.SUPABASE_URL;
const SB_KEY_KPI = process.env.SUPABASE_SECRET_KEY;

async function zohoToken() {
  // 1. Cache en memoria (más rápido, evita llamadas innecesarias)
  if (_zohoToken && Date.now() < _zohoTokenExp) return _zohoToken;

  // 2. Leer token persistido en Supabase
  try {
    const r = await fetch(`${SB_URL_KPI}/rest/v1/config_sistema?clave=eq.zoho_access_token&limit=1`, {
      headers: { 'apikey': SB_KEY_KPI, 'Authorization': `Bearer ${SB_KEY_KPI}` },
    });
    if (r.ok) {
      const rows = await r.json();
      const row = rows?.[0];
      if (row?.valor && row?.expires_at && new Date(row.expires_at) > new Date(Date.now() + 60000)) {
        _zohoToken = row.valor;
        _zohoTokenExp = new Date(row.expires_at).getTime();
        return _zohoToken;
      }
    }
  } catch(_) {}

  // 3. Renovar token desde Zoho
  const resp = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    }),
  });
  const d = await resp.json();
  if (!d.access_token) throw new Error('Zoho token error: ' + JSON.stringify(d));

  _zohoToken = d.access_token;
  _zohoTokenExp = Date.now() + (d.expires_in - 60) * 1000;
  const expiresAt = new Date(_zohoTokenExp).toISOString();

  // 4. Persistir en Supabase (upsert)
  try {
    await fetch(`${SB_URL_KPI}/rest/v1/config_sistema?clave=eq.zoho_access_token`, {
      method: 'DELETE',
      headers: { 'apikey': SB_KEY_KPI, 'Authorization': `Bearer ${SB_KEY_KPI}` },
    });
    await fetch(`${SB_URL_KPI}/rest/v1/config_sistema`, {
      method: 'POST',
      headers: {
        'apikey': SB_KEY_KPI, 'Authorization': `Bearer ${SB_KEY_KPI}`,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ clave: 'zoho_access_token', valor: _zohoToken, expires_at: expiresAt }),
    });
  } catch(_) {}

  return _zohoToken;
}

async function zohoGet(path) {
  const token = await zohoToken();
  const r = await fetch(`https://desk.zoho.com/api/v1${path}`, {
    headers: {
      'Authorization': `Zoho-oauthtoken ${token}`,
      'orgId': process.env.ZOHO_ORG_ID,
    },
  });
  return r.json();
}

// Cache de agentId por email para evitar llamadas repetidas en el cron
const _agentIdCache = {};
async function zohoAgentId(email) {
  if (_agentIdCache[email]) return _agentIdCache[email];
  const data = await zohoGet(`/agents?limit=50`);
  (data?.data || []).forEach(a => { const em = a.emailId || a.email; if (em) _agentIdCache[em] = a.id; });
  return _agentIdCache[email] || null;
}

// Cache de tickets Zoho para el cron (evita re-fetching por cada agente)
let _zohoTicketsCache = null;

// Pre-carga todos los tickets Zoho del periodo una sola vez (usar en el cron)
export async function precargarTicketsZoho(fechaInicio, fechaFin) {
  if (_zohoTicketsCache) return _zohoTicketsCache;
  const fi = new Date(`${fechaInicio}T00:00:00.000Z`);
  const ff = new Date(`${fechaFin}T23:59:59.000Z`);
  const closed = {}, frt = {}; // { agentId: count }, { agentId: [seconds] }
  let offset = 0;
  while (offset < 5000) {
    const data = await zohoGet(`/tickets?status=Closed&limit=50&from=${offset}`);
    const rows = data?.data || [];
    if (!rows.length) break;
    for (const t of rows) {
      const aid = t.assigneeId;
      if (!aid) continue;
      const ct = t.closedTime ? new Date(t.closedTime) : null;
      if (ct && ct >= fi && ct <= ff) {
        closed[aid] = (closed[aid] || 0) + 1;
        // firstResponseTime si está en el listado
        if (t.firstResponseTime) {
          if (!frt[aid]) frt[aid] = [];
          frt[aid].push(Number(t.firstResponseTime));
        }
      }
    }
    if (rows.length < 50) break;
    offset += 50;
  }
  _zohoTicketsCache = { closed, frt };
  return _zohoTicketsCache;
}

export function limpiarCacheZoho() { _zohoTicketsCache = null; }

// Fuentes donde menor valor es mejor (ej: tiempo de respuesta)
const FUENTES_INVERSAS = new Set(['zoho_primera_respuesta']);
export function esFuenteInversa(fuente) { return FUENTES_INVERSAS.has(fuente); }
export function evalCumple(fuente, valor, meta) {
  if (valor === null || valor === undefined) return false;
  return esFuenteInversa(fuente) ? valor <= meta : valor >= meta;
}

// ── Calcular valor de un KPI ──
// staffEmail se usa solo para fuentes zoho_*
export async function calcularKpi(fuente, staffId, staffEmail, fechaInicio, fechaFin, zohoCache = null) {
  try {
    switch (fuente) {

      case 'salud_atenciones': {
        const rows = await query('atenciones_salud', 'GET', null,
          `?fecha_atencion=gte.${fechaInicio}&fecha_atencion=lte.${fechaFin}&select=id`);
        return (rows || []).length;
      }

      case 'salud_charlas': {
        const rows = await query('sesiones_charla', 'GET', null,
          `?modulo=eq.salud&fecha=gte.${fechaInicio}&fecha=lte.${fechaFin}&select=id`);
        return (rows || []).length;
      }

      case 'salud_satisfaccion': {
        const rows = await query('evaluaciones_atencion', 'GET', null,
          `?ts=gte.${fechaInicio}T00:00:00&ts=lte.${fechaFin}T23:59:59&select=p1,p2,p3`);
        if (!rows?.length) return 0;
        const sum = rows.reduce((a, e) => a + ((+e.p1 + +e.p2 + +e.p3) / 3), 0);
        return Math.round((sum / rows.length) * 100) / 100;
      }

      case 'salud_charlas_participantes': {
        const rows = await query('evaluaciones_charla', 'GET', null,
          `?modulo=neq.psicopedagogico&ts=gte.${fechaInicio}T00:00:00&ts=lte.${fechaFin}T23:59:59&select=id`);
        return (rows || []).length;
      }

      case 'salud_charlas_satisfaccion': {
        const rows = await query('evaluaciones_charla', 'GET', null,
          `?modulo=neq.psicopedagogico&ts=gte.${fechaInicio}T00:00:00&ts=lte.${fechaFin}T23:59:59&select=p1,p2,p3`);
        if (!rows?.length) return 0;
        const sum = rows.reduce((a, e) => a + ((+e.p1 + +e.p2 + +e.p3) / 3), 0);
        return Math.round((sum / rows.length) * 100) / 100;
      }

      case 'psico_sesiones': {
        const rows = await query('psico_reservas', 'GET', null,
          `?estado=eq.completada&fecha=gte.${fechaInicio}&fecha=lte.${fechaFin}&select=id`);
        return (rows || []).length;
      }

      case 'psico_satisfaccion': {
        const rows = await query('evaluaciones_psico_atencion', 'GET', null,
          `?ts=gte.${fechaInicio}T00:00:00&ts=lte.${fechaFin}T23:59:59&select=p1,p2,p3`);
        if (!rows?.length) return 0;
        const sum = rows.reduce((a, e) => a + ((+e.p1 + +e.p2 + +e.p3) / 3), 0);
        return Math.round((sum / rows.length) * 100) / 100;
      }

      case 'psico_asistencia': {
        const [comp, noA] = await Promise.all([
          query('psico_reservas', 'GET', null, `?estado=eq.completada&fecha=gte.${fechaInicio}&fecha=lte.${fechaFin}&select=id`),
          query('psico_reservas', 'GET', null, `?estado=eq.no_asistio&fecha=gte.${fechaInicio}&fecha=lte.${fechaFin}&select=id`),
        ]);
        const tot = (comp||[]).length + (noA||[]).length;
        return tot ? Math.round(((comp||[]).length / tot) * 100) : 0;
      }

      case 'psico_charlas': {
        const rows = await query('sesiones_charla', 'GET', null,
          `?modulo=eq.psicopedagogico&fecha=gte.${fechaInicio}&fecha=lte.${fechaFin}&select=id`);
        return (rows || []).length;
      }

      case 'psico_charlas_satisfaccion': {
        const rows = await query('evaluaciones_charla', 'GET', null,
          `?modulo=eq.psicopedagogico&ts=gte.${fechaInicio}T00:00:00&ts=lte.${fechaFin}T23:59:59&select=calificacion`);
        if (!rows?.length) return 0;
        const sum = rows.reduce((a, e) => a + (+e.calificacion || 0), 0);
        return Math.round((sum / rows.length) * 10) / 10;
      }

      // ── Fuentes Zoho Desk ──
      // Nota: la API de Zoho Desk no admite filtro por assigneeId en el endpoint de tickets.
      // Se pagina /tickets?status=Closed y se filtra client-side por assigneeId y rango de fecha.

      case 'zoho_tickets_resueltos': {
        if (!staffEmail) return 0;
        const agentId = await zohoAgentId(staffEmail);
        if (!agentId) return 0;
        const rows = await query('zoho_tickets', 'GET', null,
          `?assignee_id=eq.${agentId}&status=eq.Closed&closed_time=gte.${fechaInicio}T00:00:00.000Z&closed_time=lte.${fechaFin}T23:59:59.999Z&select=id`);
        return (rows || []).length;
      }

      case 'zoho_tickets_recibidos': {
        if (!staffEmail) return 0;
        const agentId = await zohoAgentId(staffEmail);
        if (!agentId) return 0;
        const rows = await query('zoho_tickets', 'GET', null,
          `?assignee_id=eq.${agentId}&created_time=gte.${fechaInicio}T00:00:00.000Z&created_time=lte.${fechaFin}T23:59:59.999Z&select=id`);
        return (rows || []).length;
      }

      case 'zoho_primera_respuesta': {
        if (!staffEmail) return null;
        const agentId = await zohoAgentId(staffEmail);
        if (!agentId) return null;
        const rows = await query('zoho_tickets', 'GET', null,
          `?assignee_id=eq.${agentId}&status=eq.Closed&closed_time=gte.${fechaInicio}T00:00:00.000Z&closed_time=lte.${fechaFin}T23:59:59.999Z&first_response_time=not.is.null&select=first_response_time`);
        if (!rows?.length) return null;
        const avg = rows.reduce((s, t) => s + Number(t.first_response_time), 0) / rows.length;
        return Math.round((avg / 3600) * 10) / 10;
      }

      case 'zoho_csat': {
        return null;
      }

      case 'manual':
        return null;

      default:
        return null;
    }
  } catch(e) {
    console.error(`calcularKpi error [${fuente}]:`, e.message);
    return null;
  }
}
