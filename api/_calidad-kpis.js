// api/_calidad-kpis.js — Lógica compartida de cálculo de KPIs (usado por calidad.js y calidad-cron.js)
import { query } from './_supabase.js';

let _zohoToken = null;
let _zohoTokenExp = 0;

async function zohoToken() {
  if (_zohoToken && Date.now() < _zohoTokenExp) return _zohoToken;
  const r = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      client_id:     process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    }),
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Zoho token error: ' + JSON.stringify(d));
  _zohoToken = d.access_token;
  _zohoTokenExp = Date.now() + (d.expires_in - 60) * 1000;
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
  (data?.data || []).forEach(a => { _agentIdCache[a.email] = a.id; });
  return _agentIdCache[email] || null;
}

// ── Calcular valor de un KPI ──
// staffEmail se usa solo para fuentes zoho_*
export async function calcularKpi(fuente, staffId, staffEmail, fechaInicio, fechaFin) {
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

      case 'zoho_tickets_resueltos': {
        if (!staffEmail) return 0;
        const agentId = await zohoAgentId(staffEmail);
        if (!agentId) return 0;
        const from = `${fechaInicio}T00:00:00.000Z`;
        const to   = `${fechaFin}T23:59:59.000Z`;
        const data = await zohoGet(
          `/tickets?assigneeId=${agentId}&status=Closed&createdTime=between[${from},${to}]&limit=1&include=count`
        );
        return data?.count ?? (data?.data?.length ?? 0);
      }

      case 'zoho_tickets_recibidos': {
        if (!staffEmail) return 0;
        const agentId = await zohoAgentId(staffEmail);
        if (!agentId) return 0;
        const from = `${fechaInicio}T00:00:00.000Z`;
        const to   = `${fechaFin}T23:59:59.000Z`;
        const data = await zohoGet(
          `/tickets?assigneeId=${agentId}&createdTime=between[${from},${to}]&limit=1&include=count`
        );
        return data?.count ?? (data?.data?.length ?? 0);
      }

      case 'zoho_csat': {
        if (!staffEmail) return 0;
        const agentId = await zohoAgentId(staffEmail);
        if (!agentId) return 0;
        const data = await zohoGet(
          `/reports/agentSummary?from=${fechaInicio}T00:00:00.000Z&to=${fechaFin}T23:59:59.000Z`
        );
        const agente = (data?.data || []).find(a => a.agentId === agentId);
        if (!agente?.happinessRating) return 0;
        return Math.round((agente.happinessRating / 100) * 5 * 10) / 10; // Zoho da %, convertimos a escala 1-5
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
