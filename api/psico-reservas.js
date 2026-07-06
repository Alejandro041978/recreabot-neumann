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

      // Excluir días no laborables
      const fechaFin28 = new Date(hoyStr + 'T00:00:00');
      fechaFin28.setDate(fechaFin28.getDate() + 27);
      const noLab = await query('psico_dias_no_laborables', 'GET', null,
        `?fecha=gte.${hoyStr}&fecha=lte.${fechaFin28.toISOString().split('T')[0]}&select=fecha`);
      const noLaborables = new Set((noLab || []).map(r => r.fecha));

      const available = slots.filter(s =>
        !booked.has(`${s.fecha}_${s.hora_inicio}`) && !noLaborables.has(s.fecha));

      res.json(available); return;
    }

    // ── GET días no laborables ──
    if (req.method === 'GET' && accion === 'dias-no-laborables') {
      const data = await query('psico_dias_no_laborables', 'GET', null,
        '?order=fecha.asc');
      res.json(data || []); return;
    }

    // ── POST agregar día no laborable ──
    if (req.method === 'POST' && req.body?.accion === 'agregar-no-laborable') {
      const { fecha, motivo } = req.body;
      if (!fecha) { res.json({ ok: false, error: 'Falta fecha' }); return; }
      await query('psico_dias_no_laborables', 'POST', [{ fecha, motivo: motivo || null }]);
      res.json({ ok: true }); return;
    }

    // ── POST eliminar día no laborable ──
    if (req.method === 'POST' && req.body?.accion === 'eliminar-no-laborable') {
      const { fecha } = req.body;
      if (!fecha) { res.json({ ok: false, error: 'Falta fecha' }); return; }
      await sbFetch(`psico_dias_no_laborables?fecha=eq.${fecha}`, 'DELETE');
      res.json({ ok: true }); return;
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
        `?order=fecha.desc,hora_inicio.desc&limit=20${filtroFecha}`);
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
              observaciones, con_quien_vive, motivo_consulta, telefono } = req.body;
      if (!id) { res.json({ ok: false, error: 'id requerido' }); return; }
      const updates = {};
      if (telefono          !== undefined) updates.telefono           = telefono;
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
      const { codigo, nombre, email, fecha, hora_inicio, hora_fin, ciclo, turno, seccion, telefono, con_quien_vive, motivo_consulta } = req.body;
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

      const horaFinFinal = hora_fin || `${String(parseInt(hora_inicio)+1).padStart(2,'0')}:${hora_inicio.slice(3)}`;
      await query('psico_reservas', 'POST', [{
        codigo, nombre: nombreCompleto, email: emailFinal,
        fecha, hora_inicio, hora_fin: horaFinFinal,
        estado: 'pendiente',
        ciclo:           ciclo           || null,
        turno:           turno           || null,
        seccion:         seccion         || null,
        telefono:        telefono        || null,
        con_quien_vive:  con_quien_vive  || null,
        motivo_consulta: motivo_consulta || null,
      }]);

      // Enviar email de confirmación al estudiante
      if (emailFinal) {
        const RESEND_KEY = process.env.RESEND_API_KEY;
        const EMAIL_FROM = process.env.EMAIL_FROM || 'Instituto Neumann <onboarding@resend.dev>';
        if (RESEND_KEY) {
          // Formatear fecha legible: "2026-06-25" → "miércoles 25 de junio de 2026"
          const fechaLegible = new Date(fecha + 'T12:00:00').toLocaleDateString('es-PE', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
          });
          const horaLegible = `${hora_inicio.substring(0,5)} – ${horaFinFinal.substring(0,5)}`;

          const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:540px;margin:30px auto;background:white;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.09)">

  <div style="background:linear-gradient(135deg,#312e81 0%,#1e1b4b 100%);padding:32px;text-align:center">
    <div style="font-size:48px;margin-bottom:10px">🧠</div>
    <h1 style="margin:0;color:#a5b4fc;font-size:22px;font-weight:700;letter-spacing:-0.3px">¡Sesión reservada!</h1>
    <p style="margin:8px 0 0;color:#94a3b8;font-size:14px">Servicio Psicopedagógico · Campus Neumann</p>
  </div>

  <div style="padding:28px 32px 0">
    <p style="font-size:16px;color:#1e293b;margin:0 0 6px;font-weight:600">Hola, ${nombreCompleto} 👋</p>
    <p style="font-size:14px;color:#64748b;line-height:1.7;margin:0">
      Tu sesión con la psicóloga del campus ha sido registrada. Aquí tienes el detalle de tu cita.
    </p>
  </div>

  <div style="margin:24px 32px;background:#f8fafc;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:#312e81;padding:10px 18px">
      <p style="margin:0;font-size:12px;font-weight:700;color:#a5b4fc;text-transform:uppercase;letter-spacing:1px">Detalle de tu cita</p>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <tr style="border-bottom:1px solid #e2e8f0">
        <td style="padding:12px 18px;font-size:13px;color:#64748b;width:40%">Fecha</td>
        <td style="padding:12px 18px;font-size:14px;color:#1e293b;font-weight:600">${fechaLegible}</td>
      </tr>
      <tr style="border-bottom:1px solid #e2e8f0">
        <td style="padding:12px 18px;font-size:13px;color:#64748b">Horario</td>
        <td style="padding:12px 18px;font-size:14px;color:#1e293b;font-weight:600">${horaLegible}</td>
      </tr>
      <tr>
        <td style="padding:12px 18px;font-size:13px;color:#64748b">Código</td>
        <td style="padding:12px 18px;font-size:14px;color:#1e293b;font-family:monospace">${codigo}</td>
      </tr>
    </table>
  </div>

  <div style="margin:0 32px 24px;background:#eef2ff;border-left:4px solid #6366f1;border-radius:0 8px 8px 0;padding:14px 16px">
    <p style="margin:0;font-size:13px;color:#3730a3;font-weight:600;margin-bottom:4px">📌 Importante</p>
    <p style="margin:0;font-size:13px;color:#3730a3;line-height:1.6">
      Preséntate <strong>10 minutos antes</strong> de tu horario en la <strong>oficina de la psicóloga</strong>, ubicada en el Campus Neumann. Si no puedes asistir, cancela tu reserva con anticipación desde <a href="https://system.neumann.edu.pe/psico-reserva" style="color:#4f46e5">system.neumann.edu.pe/psico-reserva</a>.
    </p>
  </div>

  <div style="margin:0 0 0;background:#f8fafc;padding:18px 32px;border-top:1px solid #e2e8f0;text-align:center">
    <p style="margin:0;font-size:12px;color:#94a3b8">
      Servicio Psicopedagógico · Instituto Superior Neumann<br>
      <a href="https://system.neumann.edu.pe" style="color:#6366f1;text-decoration:none">system.neumann.edu.pe</a>
    </p>
  </div>

</div>
</body>
</html>`;

          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from:    EMAIL_FROM,
              to:      [emailFinal],
              subject: `🧠 Sesión reservada — ${fechaLegible} · ${horaLegible}`,
              html,
            }),
          }).catch(err => console.error('psico email error:', err));
        }
      }

      res.json({ ok: true, nombre: nombreCompleto }); return;
    }

    // ── POST crear reserva libre (staff, atención directa — sin slots) ──
    if (req.method === 'POST' && req.body?.accion === 'reservar-directa') {
      const { codigo, nombre, email, fecha, hora_inicio, hora_fin, ciclo, turno, seccion, telefono, con_quien_vive, motivo_consulta } = req.body;
      if (!codigo || !fecha || !hora_inicio || !hora_fin) {
        res.json({ ok: false, error: 'Faltan datos obligatorios' }); return;
      }

      const est = await query('estudiantes', 'GET', null,
        `?codigo=eq.${encodeURIComponent(codigo)}&limit=1`);
      const e = est?.[0];
      const nombreCompleto = nombre || (e ? `${e.nombre} ${e.apellido || ''}`.trim() : codigo);
      const emailFinal = email || e?.email || null;

      await query('psico_reservas', 'POST', [{
        codigo, nombre: nombreCompleto, email: emailFinal,
        fecha, hora_inicio, hora_fin,
        estado: 'confirmada',
        ciclo:           ciclo           || null,
        turno:           turno           || null,
        seccion:         seccion         || null,
        telefono:        telefono        || null,
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
