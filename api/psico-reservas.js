// api/psico-reservas.js — Reservas de sesiones psicopedagógicas
import { query } from './_supabase.js';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SECRET_KEY;

async function sbFetch(path, method, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=minimal' : undefined,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Supabase ${method} ${path}: ${t}`);
  }
  return r;
}

// Lima local date/time helpers (ZKTeco pattern: treat as-is, no UTC conversion)
function limaHoy() {
  // Returns "YYYY-MM-DD" in America/Lima
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Lima' });
}

function limaNow() {
  return new Date().toLocaleString('en-US', { timeZone: 'America/Lima' });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const { accion } = req.query || {};

    // ── GET disponibilidad semanal (plantilla) ──
    if (req.method === 'GET' && accion === 'disponibilidad') {
      const data = await query('psico_disponibilidad', 'GET', null,
        '?order=dia_semana.asc,hora_inicio.asc');
      res.json(data || []); return;
    }

    // ── POST guardar disponibilidad semanal ──
    if (req.method === 'POST' && req.body?.accion === 'disponibilidad') {
      const { slots } = req.body; // [{dia_semana:1, hora_inicio:"09:00"}]
      // Borrar todo y re-insertar
      await sbFetch('psico_disponibilidad?id=neq.00000000-0000-0000-0000-000000000000', 'DELETE');
      if (slots && slots.length > 0) {
        await query('psico_disponibilidad', 'POST', slots);
      }
      res.json({ ok: true }); return;
    }

    // ── GET slots disponibles para reserva (próximas 4 semanas) ──
    if (req.method === 'GET' && accion === 'slots') {
      const disp = await query('psico_disponibilidad', 'GET', null,
        '?order=dia_semana.asc,hora_inicio.asc');
      if (!disp || disp.length === 0) { res.json([]); return; }

      // Fecha/hora Lima actual
      const limaDatetime = new Date(limaNow());
      const hoyStr = limaHoy();

      const slots = [];
      for (let d = 0; d < 28; d++) {
        const fecha = new Date(hoyStr + 'T00:00:00');
        fecha.setDate(fecha.getDate() + d);
        const fechaStr = fecha.toISOString().split('T')[0];
        const diaSemana = fecha.getDay(); // 0=Dom

        const slotsDelDia = disp.filter(s => s.dia_semana === diaSemana);
        for (const slot of slotsDelDia) {
          const [h, m] = slot.hora_inicio.split(':').map(Number);
          // Saltar slots pasados (mismo día, misma hora o anterior con 1h de anticipación mínima)
          if (fechaStr === hoyStr) {
            const horaLima = limaDatetime.getHours() + limaDatetime.getMinutes() / 60;
            if (h + m / 60 <= horaLima + 1) continue;
          }
          const hFin = h + 1;
          const horaFin = `${String(hFin).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          slots.push({
            fecha: fechaStr,
            hora_inicio: slot.hora_inicio.substring(0, 5),
            hora_fin: horaFin,
          });
        }
      }

      // Excluir slots ya reservados (pendiente o confirmada)
      const reservas = await query('psico_reservas', 'GET', null,
        `?estado=in.(pendiente,confirmada)&fecha=gte.${hoyStr}`);
      const booked = new Set((reservas || []).map(r =>
        `${r.fecha}_${r.hora_inicio.substring(0, 5)}`));
      const available = slots.filter(s => !booked.has(`${s.fecha}_${s.hora_inicio}`));

      res.json(available); return;
    }

    // ── GET reserva activa de un estudiante ──
    if (req.method === 'GET' && accion === 'mis-reservas') {
      const { codigo } = req.query;
      if (!codigo) { res.json({ reserva: null }); return; }
      const data = await query('psico_reservas', 'GET', null,
        `?codigo=eq.${encodeURIComponent(codigo)}&estado=in.(pendiente,confirmada)&order=fecha.asc&limit=1`);
      res.json({ reserva: (data && data[0]) || null }); return;
    }

    // ── GET lista de reservas (staff dashboard) ──
    if (req.method === 'GET' && accion === 'lista') {
      const { desde } = req.query;
      const filtroFecha = desde ? `&fecha=gte.${desde}` : '';
      const data = await query('psico_reservas', 'GET', null,
        `?order=fecha.asc,hora_inicio.asc&limit=300${filtroFecha}`);
      res.json(data || []); return;
    }

    // ── GET detalle completo de una reserva (staff) ──
    if (req.method === 'GET' && accion === 'detalle') {
      const { id } = req.query;
      const reservas = await query('psico_reservas', 'GET', null, `?id=eq.${id}&limit=1`);
      const rv = reservas?.[0];
      if (!rv) { res.status(404).json({ error: 'No encontrado' }); return; }
      const ests = await query('estudiantes', 'GET', null, `?codigo=eq.${encodeURIComponent(rv.codigo)}&limit=1`);
      const est = ests?.[0] || null;
      // Posición secuencial de esta sesión para este estudiante
      const todas = await query('psico_reservas', 'GET', null,
        `?codigo=eq.${encodeURIComponent(rv.codigo)}&select=id&order=fecha.asc,hora_inicio.asc`);
      const pos = (todas || []).findIndex(r => r.id === rv.id);
      const nSesion = pos >= 0 ? pos + 1 : (todas?.length || 1);
      res.json({ reserva: rv, estudiante: est, n_sesion: nSesion }); return;
    }

    // ── POST guardar ficha clínica (staff) ──
    if (req.method === 'POST' && req.body?.accion === 'ficha-clinica') {
      const { id, estado, n_sesion, profundidad_problema, impacto_profesional,
              tipo_dificultad, nivel_compromiso, problema_hallado,
              observaciones, con_quien_vive, motivo_consulta } = req.body;
      if (!id) { res.json({ ok: false, error: 'id requerido' }); return; }
      const updates = {};
      if (estado            !== undefined) updates.estado             = estado;
      if (n_sesion          !== undefined) updates.n_sesion           = n_sesion;
      if (profundidad_problema !== undefined) updates.profundidad_problema = profundidad_problema;
      if (impacto_profesional  !== undefined) updates.impacto_profesional  = impacto_profesional;
      if (tipo_dificultad   !== undefined) updates.tipo_dificultad    = tipo_dificultad;
      if (nivel_compromiso  !== undefined) updates.nivel_compromiso   = nivel_compromiso;
      if (problema_hallado  !== undefined) updates.problema_hallado   = problema_hallado;
      if (observaciones     !== undefined) updates.notas              = observaciones;
      if (con_quien_vive    !== undefined) updates.con_quien_vive     = con_quien_vive;
      if (motivo_consulta   !== undefined) updates.motivo_consulta    = motivo_consulta;
      await sbFetch(`psico_reservas?id=eq.${id}`, 'PATCH', updates);
      res.json({ ok: true }); return;
    }

    // ── POST crear reserva (estudiante) ──
    if (req.method === 'POST' && req.body?.accion === 'reservar') {
      const { codigo, nombre, email, fecha, hora_inicio, hora_fin, con_quien_vive, motivo_consulta } = req.body;
      if (!codigo || !fecha || !hora_inicio) {
        res.json({ ok: false, error: 'Faltan datos obligatorios' }); return;
      }

      // Verificar que el estudiante existe y está activo
      const est = await query('estudiantes', 'GET', null,
        `?codigo=eq.${encodeURIComponent(codigo)}&activo=eq.true&limit=1`);
      if (!est || est.length === 0) {
        res.json({ ok: false, error: 'Código de estudiante no válido o inactivo' }); return;
      }

      // Verificar que no tiene reserva pendiente
      const existing = await query('psico_reservas', 'GET', null,
        `?codigo=eq.${encodeURIComponent(codigo)}&estado=in.(pendiente,confirmada)&limit=1`);
      if (existing && existing.length > 0) {
        res.json({ ok: false, error: 'Ya tienes una sesión reservada. Cancélala primero para reservar otra.' }); return;
      }

      // Verificar que el slot sigue disponible
      const conflict = await query('psico_reservas', 'GET', null,
        `?fecha=eq.${fecha}&hora_inicio=eq.${hora_inicio}&estado=in.(pendiente,confirmada)&limit=1`);
      if (conflict && conflict.length > 0) {
        res.json({ ok: false, error: 'Este horario ya fue tomado. Por favor elige otro.' }); return;
      }

      const e = est[0];
      const nombreCompleto = nombre || `${e.nombre} ${e.apellido || ''}`.trim();
      const emailFinal = email || e.email || null;

      await query('psico_reservas', 'POST', [{
        codigo, nombre: nombreCompleto, email: emailFinal,
        fecha, hora_inicio, hora_fin: hora_fin || `${String(parseInt(hora_inicio)+1).padStart(2,'0')}:${hora_inicio.slice(3)}`,
        estado: 'pendiente',
        con_quien_vive:  con_quien_vive  || null,
        motivo_consulta: motivo_consulta || null,
      }]);
      res.json({ ok: true, nombre: nombreCompleto }); return;
    }

    // ── POST cancelar reserva propia (estudiante) ──
    if (req.method === 'POST' && req.body?.accion === 'cancelar-propia') {
      const { codigo, id } = req.body;
      if (!codigo || !id) { res.json({ ok: false, error: 'Faltan datos' }); return; }
      // Verificar que la reserva pertenece al estudiante
      const r = await query('psico_reservas', 'GET', null,
        `?id=eq.${id}&codigo=eq.${encodeURIComponent(codigo)}&limit=1`);
      if (!r || r.length === 0) {
        res.json({ ok: false, error: 'Reserva no encontrada' }); return;
      }
      await sbFetch(`psico_reservas?id=eq.${id}`, 'PATCH', { estado: 'cancelada' });
      res.json({ ok: true }); return;
    }

    // ── POST actualizar estado (staff) ──
    if (req.method === 'POST' && req.body?.accion === 'estado') {
      const { id, estado, notas } = req.body;
      if (!id || !estado) { res.json({ ok: false, error: 'Faltan datos' }); return; }
      const updates = { estado };
      if (notas !== undefined) updates.notas = notas;
      await sbFetch(`psico_reservas?id=eq.${id}`, 'PATCH', updates);
      res.json({ ok: true }); return;
    }

    res.status(404).json({ error: 'Acción no encontrada' });
  } catch (e) {
    console.error('psico-reservas error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
}
