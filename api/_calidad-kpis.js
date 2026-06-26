// api/_calidad-kpis.js — Lógica compartida de cálculo de KPIs (usado por calidad.js y calidad-cron.js)
import { query } from './_supabase.js';

// Calcula horas hábiles entre dos fechas: Lun-Vie 8am-6pm Lima (UTC-5)
function horasHabiles(inicio, fin) {
  const LIMA_OFFSET = -5 * 60; // minutos
  const BIZ_START = 8;  // 8am
  const BIZ_END   = 18; // 6pm

  const toLocal = (d) => new Date(d.getTime() + LIMA_OFFSET * 60000);

  let total = 0;
  let cur = new Date(inicio);

  while (cur < fin) {
    const local = toLocal(cur);
    const dow = local.getUTCDay(); // 0=dom,1=lun,...,5=vie,6=sab
    const hour = local.getUTCHours() + local.getUTCMinutes() / 60;

    if (dow >= 1 && dow <= 5 && hour >= BIZ_START && hour < BIZ_END) {
      // Avanzar hasta el próximo límite: fin del día hábil o fin del ticket
      const endOfBiz = new Date(cur);
      endOfBiz.setUTCHours(cur.getUTCHours() - (hour - BIZ_END), 0, 0, 0);
      // Calculamos cuántos minutos quedan en este bloque hábil
      const localEndBiz = new Date(local);
      localEndBiz.setUTCHours(BIZ_END, 0, 0, 0);
      const bizEndUTC = new Date(localEndBiz.getTime() - LIMA_OFFSET * 60000);
      const blockEnd = bizEndUTC < fin ? bizEndUTC : fin;
      total += (blockEnd - cur) / 3600000;
      cur = blockEnd;
    } else {
      // Avanzar al siguiente inicio de día hábil
      const next = toLocal(cur);
      if (dow === 0 || dow === 6 || hour >= BIZ_END) {
        // Ir al próximo lunes o próximo día laboral a las 8am
        const daysUntilMon = dow === 0 ? 1 : dow === 6 ? 2 : 1;
        const skip = hour >= BIZ_END ? (dow === 5 ? 3 : dow === 6 ? 2 : 1) : 0;
        next.setUTCDate(next.getUTCDate() + (hour >= BIZ_END ? skip : daysUntilMon));
        next.setUTCHours(BIZ_START, 0, 0, 0);
      } else {
        next.setUTCHours(BIZ_START, 0, 0, 0);
      }
      cur = new Date(next.getTime() - LIMA_OFFSET * 60000);
      if (cur >= fin) break;
    }
  }
  return total;
}

// Cache de zoho_agent_id por staffId
const _agentIdCache = {};
async function zohoAgentId(staffId) {
  if (_agentIdCache[staffId]) return _agentIdCache[staffId];
  const rows = await query('staff', 'GET', null, `?id=eq.${staffId}&select=zoho_agent_id`);
  const id = rows?.[0]?.zoho_agent_id || null;
  if (id) _agentIdCache[staffId] = id;
  return id;
}

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
        const agentId = await zohoAgentId(staffId);
        if (!agentId) return 0;
        const rows = await query('zoho_tickets', 'GET', null,
          `?assignee_id=eq.${agentId}&status=eq.Closed&closed_time=gte.${fechaInicio}T00:00:00.000Z&closed_time=lte.${fechaFin}T23:59:59.999Z&select=id`);
        return (rows || []).length;
      }

      case 'zoho_tickets_recibidos': {
        const agentId = await zohoAgentId(staffId);
        if (!agentId) return 0;
        const rows = await query('zoho_tickets', 'GET', null,
          `?assignee_id=eq.${agentId}&created_time=gte.${fechaInicio}T00:00:00.000Z&created_time=lte.${fechaFin}T23:59:59.999Z&select=id`);
        return (rows || []).length;
      }

      case 'zoho_primera_respuesta': {
        const agentId = await zohoAgentId(staffId);
        if (!agentId) return null;
        const rows = await query('zoho_tickets', 'GET', null,
          `?assignee_id=eq.${agentId}&status=eq.Closed&closed_time=gte.${fechaInicio}T00:00:00.000Z&closed_time=lte.${fechaFin}T23:59:59.999Z&select=created_time,closed_time`);
        if (!rows?.length) return null;
        const totalHrs = rows.reduce((s, t) => {
          return s + horasHabiles(new Date(t.created_time), new Date(t.closed_time));
        }, 0);
        return Math.round((totalHrs / rows.length) * 10) / 10;
      }

      case 'zoho_csat': {
        const agentId = await zohoAgentId(staffId);
        if (!agentId) return null;
        const rows = await query('zoho_ratings', 'GET', null,
          `?agent_id=eq.${agentId}&rated_time=gte.${fechaInicio}T00:00:00.000Z&rated_time=lte.${fechaFin}T23:59:59.999Z&select=rating`);
        if (!rows?.length) return null;
        const good = rows.filter(r => r.rating === 'GOOD').length;
        return Math.round((good / rows.length) * 100);
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
