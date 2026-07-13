// api/whatsapp.js — Bot de WhatsApp (Twilio) con paridad del bot web
// Recibe el webhook de Twilio, mantiene estado por número, identifica al
// estudiante automáticamente por su teléfono y responde con TwiML.
import { query } from './_supabase.js';

const BASE_URL = 'https://recreabot-neumann.vercel.app';
const AREAS = ['Canchita A', 'Canchita B', 'Taka Taka', 'Ajedrez', 'Sapito'];
const MAX_HIST = 20; // mensajes de historial que se conservan por conversación

// ── Utilidades ──────────────────────────────────────────────
function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;' }[c]));
}
function twiml(mensaje) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Message>${xmlEscape(mensaje)}</Message></Response>`;
}
function soloDigitos(s) { return (s || '').replace(/\D/g, ''); }

// ── Extracción de datos de la reserva desde el resumen de Claude ──
function extraerDeResumen(texto) {
  const t  = texto;
  const tl = texto.toLowerCase();
  const reg = { area:'', codigo:'', carrera:'', participantes:'', horario:'', estado:'ok', problema:'', calificacion:'', fecha_reserva:'' };

  const cod = t.match(/[Cc][oó]digo[:\s*]+([0-9]{4,10})/);
  if (cod) reg.codigo = cod[1];

  if (tl.includes('administración de negocios') || tl.includes('administracion de negocios')) reg.carrera = 'Administración de Negocios Internacionales';
  else if (tl.includes('administración') || tl.includes('administracion')) reg.carrera = 'Administración de Negocios Internacionales';
  else if (tl.includes('contabilidad')) reg.carrera = 'Contabilidad';

  for (const a of AREAS) { if (tl.includes(a.toLowerCase())) { reg.area = a; break; } }

  const part  = t.match(/[Pp]articipantes?[:\s*]+([0-9]+|6\+|6 o más)/);
  const partB = t.match(/([0-9]+)\s+persona/);
  if (part) reg.participantes = part[1];
  else if (partB) reg.participantes = partB[1];

  const hoy = new Date();
  const MES_IDX = { enero:0, febrero:1, marzo:2, abril:3, mayo:4, junio:5, julio:6,
    agosto:7, septiembre:8, setiembre:8, octubre:9, noviembre:10, diciembre:11 };
  const fechaTexto = tl.match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)(?:\s+de\s+(\d{4}))?/);
  if (fechaTexto && MES_IDX[fechaTexto[2]] !== undefined) {
    const dia = parseInt(fechaTexto[1]); const mes = MES_IDX[fechaTexto[2]];
    const anio = fechaTexto[3] ? parseInt(fechaTexto[3]) : hoy.getFullYear();
    reg.fecha_reserva = new Date(anio, mes, dia).toLocaleDateString('es-PE');
  } else if (tl.includes('hoy')) {
    reg.fecha_reserva = hoy.toLocaleDateString('es-PE');
  } else if (tl.includes('mañana') || tl.includes('manana')) {
    const m = new Date(hoy); m.setDate(m.getDate() + 1); reg.fecha_reserva = m.toLocaleDateString('es-PE');
  } else {
    const DIAS = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
    const DIAS_AC = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
    for (let i = 0; i < DIAS.length; i++) {
      if (tl.includes(DIAS[i]) || tl.includes(DIAS_AC[i])) {
        const f = new Date(hoy); const diff = (i - f.getDay() + 7) % 7 || 7;
        f.setDate(f.getDate() + diff); reg.fecha_reserva = f.toLocaleDateString('es-PE'); break;
      }
    }
  }

  const TODOS_SLOTS = ['8-10am','10am-12pm','12-2pm','2-4pm','4-6pm','6-8pm','8-10pm',
    '8-9am','9-10am','10-11am','11am-12pm','12-1pm','1-2pm','2-3pm','3-4pm','4-5pm','5-6pm','6-7pm','7-8pm','8-9pm','9-10pm'];
  for (const slot of TODOS_SLOTS) { if (tl.includes(slot.toLowerCase())) { reg.horario = slot; break; } }

  if (!reg.codigo || !reg.area) return null;
  return reg;
}

// ── Config de slots por área (desde config_horarios) ──
async function cargarSlots() {
  const map = {};
  try {
    const cfg = await query('config_horarios', 'GET', null, '?select=area,slots,activa');
    (cfg || []).forEach(c => {
      const activa = c.activa === true || String(c.activa).toUpperCase() === 'TRUE';
      if (!activa) return;
      const slots = Array.isArray(c.slots) ? c.slots
        : (typeof c.slots === 'string' ? c.slots.split(',').map(s => s.trim()).filter(Boolean) : []);
      map[c.area] = slots;
    });
  } catch (e) { /* usa defaults abajo */ }
  if (!Object.keys(map).length) {
    const s2h = ['8-10am','10am-12pm','12-2pm','2-4pm','4-6pm','6-8pm','8-10pm'];
    const s1h = ['8-9am','9-10am','10-11am','11am-12pm','12-1pm','1-2pm','2-3pm','3-4pm','4-5pm','5-6pm','6-7pm','7-8pm','8-9pm','9-10pm'];
    return { 'Canchita A':s2h, 'Canchita B':s2h, 'Taka Taka':s1h, 'Ajedrez':s1h, 'Sapito':s1h };
  }
  return map;
}

// ── Detección de intención ──
function esConsultaAsistencia(tl) {
  return ['asistencia','vine','llegué','llegue','asistí','asisti','falté','falte','mis días','mis dias',
    'cuándo vine','cuando vine','ingresé','ingrese','mis marcaciones','he faltado'].some(k => tl.includes(k));
}
function esConsultaReserva(tl) {
  return ['reservar','cancha','canchita','taka','ajedrez','sapito','reserva','quiero jugar','área recreativa','area recreativa'].some(k => tl.includes(k));
}
function esConsultaCultura(tl) {
  return ['museo','museos','cultura','cultural','arte','visita virtual','recorrido virtual','exposición','exposicion',
    'louvre','prado','sipán','sipan','chan chan','pachacamac','inca','arqueología','arqueologia','virtual'].some(k => tl.includes(k));
}

// ── System prompt (paridad con el bot web) ──
function buildSystem(est, modulo, slotsMap, asistenciaData, conocimientosData) {
  const hoyStr = new Date().toLocaleDateString('es-PE', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'America/Lima' });
  const slotsBloque = Object.entries(slotsMap).map(([a, s]) => `- ${a}: ${s.join(', ')}`).join('\n');

  let sys = `Eres el Asistente Digital del Instituto Superior Neumann. Ayudas a los estudiantes por WhatsApp con tres servicios:

1. RESERVAS DE ÁREAS RECREATIVAS
2. CONSULTA DE ASISTENCIA AL CAMPUS
3. ORIENTACIÓN CULTURAL — museos virtuales que pueden visitar desde casa

FECHA HOY: ${hoyStr}

ESTUDIANTE IDENTIFICADO:
  Nombre: ${est.nombre} ${est.apellido || ''}
  Carrera: ${est.carrera || ''}
  Código: ${est.codigo}
  REGLA: Usa EXACTAMENTE este nombre. Nunca lo cambies. Ya está verificado, no le pidas su código.

REGLAS GENERALES:
- Respuestas cortas — máximo 3 líneas — es WhatsApp
- No uses markdown, asteriscos ni guiones al inicio de línea
- NUNCA inventes información sobre el instituto (servicios, horarios, profesores, precios, instalaciones, procedimientos). Si no la tienes en el contexto, admite que no la tienes y ofrece crear un ticket.

ESCALAMIENTO A SOPORTE:
Si el estudiante pide algo que no puedes resolver (no es reserva, asistencia ni cultura, o es una queja que requiere atención humana), ofrécele crear un ticket. Si acepta, responde EXACTAMENTE con este formato y nada más:
[CREAR_TICKET] descripción breve y clara del problema o solicitud del estudiante

FLUJO DE RESERVA:
ÁREAS Y HORARIOS DISPONIBLES:
${slotsBloque}
Pasos:
1. Pregunta qué área quiere reservar (si no lo dijo)
2. Pide NÚMERO DE PARTICIPANTES (1 a 6+)
3. Pide la FECHA (hoy, mañana o día de la semana)
4. Muestra los slots del área elegida y pide elegir uno EXACTO de la lista
5. Confirma con este formato EXACTO (una línea por dato, sin markdown):
   Código: ${est.codigo}
   Carrera: ${est.carrera || ''}
   Área: nombre exacto
   Participantes: número
   Fecha: fecha exacta (ej: 12 de julio de 2026)
   Horario: slot exacto (ej: 8-9am)
   [REGISTRO COMPLETO ✅]
- Ofrece ÚNICAMENTE los slots listados para el área elegida`;

  if (asistenciaData) {
    sys += `\n\nDATOS DE ASISTENCIA DEL ESTUDIANTE (usa esto para responder):\n${asistenciaData}\n\nPreséntalos de forma conversacional. Resalta el total de días presentes y los registros recientes.`;
  }
  if (conocimientosData) {
    sys += `\n\nINFORMACIÓN DEL INSTITUTO (usa esto para responder):\n${conocimientosData}\n\nResponde con esta información de forma natural. Si no responde exactamente lo que pregunta, ofrécele crear un ticket.`;
  }
  return sys;
}

// ── Búsquedas contextuales (reusan endpoints existentes) ──
async function fetchAsistencia(codigo) {
  try {
    const r = await fetch(`${BASE_URL}/api/asistencia?accion=alumno&codigo=${encodeURIComponent(codigo)}`);
    if (!r.ok) return null;
    const d = await r.json();
    return JSON.stringify(d).slice(0, 3000);
  } catch (e) { return null; }
}
async function fetchConocimientos(texto) {
  try {
    const r = await fetch(`${BASE_URL}/api/conocimientos?accion=buscar&q=${encodeURIComponent(texto)}`);
    if (!r.ok) return null;
    const d = await r.json();
    const arr = Array.isArray(d) ? d : (d.resultados || []);
    if (!arr.length) return null;
    return arr.map(x => x.es_archivo
      ? `[${x.tema}] ${x.pregunta}\nRespuesta: Comparte este enlace directo sin texto adicional: ${x.respuesta}`
      : `[${x.tema}] ${x.pregunta}\n${x.respuesta}`).join('\n\n');
  } catch (e) { return null; }
}

// ── Guardado de reserva + email + ticket ──
async function guardarReserva(reg, est) {
  try {
    await fetch(`${BASE_URL}/api/sheets`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registro: { ...reg, ts: new Date().toISOString() } }),
    });
    if (est?.email) {
      await fetch(`${BASE_URL}/api/evaluacion`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'email-confirmacion', estudiante: est, reserva: reg }),
      }).catch(() => {});
    }
    return true;
  } catch (e) { return false; }
}
async function crearTicket(descripcion, est, modulo) {
  try {
    await fetch(`${BASE_URL}/api/zoho-ticket`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codigo: est?.codigo || null,
        nombre: est ? `${est.nombre} ${est.apellido || ''}`.trim() : 'Estudiante WhatsApp',
        email: est?.email || null,
        descripcion, modulo: modulo || 'whatsapp', canal: 'whatsapp',
      }),
    });
    return true;
  } catch (e) { return false; }
}

// ── Estado de conversación (tabla whatsapp_conversaciones) ──
async function cargarEstado(phone) {
  const rows = await query('whatsapp_conversaciones', 'GET', null, `?phone=eq.${encodeURIComponent(phone)}&limit=1`);
  return rows?.[0] || null;
}
async function guardarEstado(phone, estado) {
  const row = { phone, ...estado, updated_at: new Date().toISOString() };
  const existe = await query('whatsapp_conversaciones', 'GET', null, `?phone=eq.${encodeURIComponent(phone)}&limit=1`);
  if (existe?.[0]) await query('whatsapp_conversaciones', 'PATCH', row, `?phone=eq.${encodeURIComponent(phone)}`);
  else await query('whatsapp_conversaciones', 'POST', row);
}

// ── Identificación del estudiante por número de WhatsApp ──
async function buscarPorTelefono(phone) {
  const d9 = soloDigitos(phone).slice(-9); // últimos 9 dígitos (formato local Perú)
  if (d9.length < 9) return null;
  try {
    const rows = await query('estudiantes', 'GET', null, `?whatsapp=ilike.*${d9}*&limit=1`);
    return rows?.[0] || null;
  } catch (e) { return null; }
}
async function buscarPorCodigo(codigo) {
  const rows = await query('estudiantes', 'GET', null, `?codigo=eq.${encodeURIComponent(codigo)}&limit=1`);
  return rows?.[0] || null;
}

// ── Llamada a Claude ──
async function callClaude(system, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
    body: JSON.stringify({ model:'claude-sonnet-4-5', max_tokens:600, system, messages }),
  });
  const data = await r.json();
  return data?.content?.[0]?.text || '';
}

// ── Handler principal ──────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).send('Método no permitido'); return; }

  // Seguridad opcional: ?token=SECRETO debe coincidir con WHATSAPP_WEBHOOK_SECRET
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (secret && req.query?.token !== secret) { res.status(403).send('No autorizado'); return; }

  res.setHeader('Content-Type', 'text/xml; charset=utf-8');

  try {
    const from = (req.body?.From || '').replace('whatsapp:', '').trim();
    const body = (req.body?.Body || '').trim();
    if (!from) { res.status(200).send(twiml('No pude leer tu mensaje. Intenta de nuevo.')); return; }

    let estado = await cargarEstado(from) || { historial: [], modulo: null, codigo: null };
    let historial = Array.isArray(estado.historial) ? estado.historial : [];

    // ── 1) Identificación ──
    let est = null;
    if (estado.codigo) {
      est = { codigo: estado.codigo, nombre: estado.nombre, apellido: estado.apellido, carrera: estado.carrera, email: estado.email };
    } else {
      // a) intentar por teléfono
      est = await buscarPorTelefono(from);
      // b) si no, ver si el mensaje es un código
      if (!est) {
        const posibleCod = soloDigitos(body);
        if (posibleCod.length >= 4 && posibleCod.length <= 10) {
          const e = await buscarPorCodigo(posibleCod);
          if (e && e.activo !== false && e.activo !== 0) est = e;
          else if (e) { res.status(200).send(twiml('Tu código está inactivo. Acércate a Secretaría para más información.')); return; }
          else { res.status(200).send(twiml(`No encontré el código ${posibleCod} en el sistema. Verifica que esté bien escrito e inténtalo de nuevo.`)); return; }
        }
      }
      if (est) {
        // guardar identidad y saludar (sin gastar tokens de Claude)
        await guardarEstado(from, {
          codigo: est.codigo, nombre: est.nombre, apellido: est.apellido || '', carrera: est.carrera || '',
          email: est.email || null, modulo: estado.modulo || null, historial,
        });
        const saludo = `👋 Hola ${est.nombre}, soy el Asistente del Instituto Neumann.\n\n¿En qué te ayudo hoy?\n📅 Reservar un área recreativa\n📊 Consultar tu asistencia\n🏛️ Museos virtuales`;
        res.status(200).send(twiml(saludo)); return;
      }
      // no identificado → pedir código
      res.status(200).send(twiml('👋 Hola, soy el Asistente del Instituto Neumann. Para ayudarte necesito tu código de estudiante. ¿Me lo compartes?'));
      return;
    }

    // ── 2) Orquestación (estudiante ya identificado) ──
    const tl = body.toLowerCase();
    let modulo = estado.modulo || null;
    if (esConsultaAsistencia(tl)) modulo = 'asistencia';
    else if (esConsultaReserva(tl)) modulo = 'reserva';
    else if (esConsultaCultura(tl)) modulo = 'cultura';

    const slotsMap = await cargarSlots();
    let asistenciaData = null, conocimientosData = null;
    if (modulo === 'asistencia') asistenciaData = await fetchAsistencia(est.codigo);
    else if (modulo !== 'reserva' && modulo !== 'cultura') conocimientosData = await fetchConocimientos(body);

    const system = buildSystem(est, modulo, slotsMap, asistenciaData, conocimientosData);
    const messages = [...historial, { role: 'user', content: body }].slice(-MAX_HIST);

    let reply = await callClaude(system, messages);
    if (!reply) reply = 'Disculpa, no pude procesar tu mensaje. ¿Puedes repetirlo?';

    // ── 3) Acciones según marcadores ──
    if (reply.includes('[REGISTRO COMPLETO')) {
      const reg = extraerDeResumen(reply);
      if (reg) {
        await guardarReserva(reg, est);
        reply = reply.replace(/\[REGISTRO COMPLETO[^\]]*\]/g, '').trim();
        reply += '\n\n✅ Tu reserva quedó registrada. Acércate a garita para recibir los implementos.';
      }
      modulo = null;
    } else if (reply.includes('[CREAR_TICKET]')) {
      const desc = reply.split('[CREAR_TICKET]')[1]?.trim() || body;
      await crearTicket(desc, est, modulo);
      reply = 'Listo, generé un ticket de soporte con tu solicitud. El equipo del instituto te contactará. ¿Algo más en lo que te ayude?';
      modulo = null;
    }

    // ── 4) Guardar historial + estado ──
    historial = [...messages, { role: 'assistant', content: reply }].slice(-MAX_HIST);
    await guardarEstado(from, {
      codigo: est.codigo, nombre: est.nombre, apellido: est.apellido || '', carrera: est.carrera || '',
      email: est.email || null, modulo, historial,
    });

    res.status(200).send(twiml(reply));
  } catch (err) {
    res.status(200).send(twiml('⚠️ Error técnico: ' + (err.message || 'desconocido')));
  }
}
