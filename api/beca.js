// api/beca.js — Sistema de becas asistenciales
import { query } from './_supabase.js';

// ── RÚBRICA DE EVALUACIÓN ──
function calcularPuntaje(p) {
  let c1, c2, c3, c4, c5, c6, c7, c8, c9;

  // C1: Ingreso mensual familiar
  const ing = Number(p.ingreso_mensual);
  if      (ing > 1500)             c1 = 1;
  else if (ing >= 1201)            c1 = 2;
  else if (ing >= 901)             c1 = 3;
  else if (ing >= 501)             c1 = 4;
  else                             c1 = 5;

  // C2: Carga familiar
  const cf = p.carga_familiar;
  if      (cf === 'ninguna')           c2 = 1;
  else if (cf === 'esposo')            c2 = 2;
  else if (cf === '1_hijo')            c2 = 3;
  else if (cf === 'mas_hijos')         c2 = 4;
  else if (cf === 'hijos_familiares')  c2 = 5;
  else                                 c2 = 1;

  // C3: Notas último ciclo (provisto por el sistema)
  const nota = Number(p.promedio_notas || 0);
  if      (nota >= 18) c3 = 3;
  else if (nota >= 14) c3 = 2;
  else                 c3 = 1;

  // C4: Situación de salud (0 si buena salud)
  const sal = p.salud;
  if      (sal === 'incapacidad_permanente') c4 = 5;
  else if (sal === 'incapacidad_temporal')   c4 = 4;
  else                                       c4 = 0;

  // C5: SISFOH
  const sisfoh = p.sisfoh;
  if      (sisfoh === 'pobre_extremo') c5 = 5;
  else if (sisfoh === 'pobre')         c5 = 4;
  else                                 c5 = 3;

  // C6: Deudas bancarias
  c6 = (p.tiene_deuda === true || p.tiene_deuda === 'true') ? 1 : 0;

  // C7: Evidencias
  const ev = p.evidencias;
  if      (ev === 'sisfoh_completo')    c7 = 5;
  else if (ev === 'boletas_contrato')   c7 = 4;
  else if (ev === 'contrato_recibos')   c7 = 3;
  else if (ev === 'recibos_fotos')      c7 = 2;
  else if (ev === 'fotos')              c7 = 1;
  else                                  c7 = 0;

  // C8: Becas anteriores
  const ba = Number(p.becas_anteriores || 0);
  if      (ba === 0) c8 = 5;
  else if (ba === 1) c8 = 4;
  else if (ba === 2) c8 = 3;
  else if (ba === 3) c8 = 2;
  else               c8 = 1;

  // C9: Tipo de domicilio
  const dom = p.tipo_domicilio;
  if      (dom === 'propia_noble_cercado') c9 = 1;
  else if (dom === 'propia_noble_cono')    c9 = 2;
  else if (dom === 'familiar')             c9 = 3;
  else if (dom === 'alquilada_alejada')    c9 = 4;
  else if (dom === 'precaria_alejada')     c9 = 5;
  else                                     c9 = 1;

  const total = c1+c2+c3+c4+c5+c6+c7+c8+c9;
  return { total, detalle: {c1,c2,c3,c4,c5,c6,c7,c8,c9}, descalificado: c7 === 0 };
}

// ── EMAIL CONFIRMACIÓN RECEPCIÓN ──
async function enviarEmailRecepcion(email, nombre, semestre) {
  const KEY  = process.env.RESEND_API_KEY;
  const FROM = process.env.EMAIL_FROM || 'Instituto Neumann <onboarding@resend.dev>';
  if (!KEY || !email) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [email],
      subject: '🎓 Recibimos tu postulación a Beca Asistencial — Instituto Neumann',
      html: `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:520px;margin:30px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#1e3a5f,#0f1117);padding:28px 32px">
    <div style="font-size:28px;margin-bottom:8px">🎓</div>
    <h1 style="margin:0;color:#60a5fa;font-size:20px">Postulación recibida</h1>
    <p style="margin:6px 0 0;color:#94a3b8;font-size:14px">Beca Asistencial · Semestre ${semestre}</p>
  </div>
  <div style="padding:28px 32px">
    <p style="font-size:15px;color:#334155">Hola <strong>${nombre}</strong>,</p>
    <p style="font-size:14px;color:#334155;line-height:1.6">
      Hemos recibido correctamente tu postulación a la Beca Asistencial para el semestre <strong>${semestre}</strong>.
    </p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px 20px;margin:20px 0">
      <p style="margin:0;font-size:13px;color:#1e40af;font-weight:600">📅 ¿Cuándo conoces el resultado?</p>
      <p style="margin:8px 0 0;font-size:13px;color:#334155">
        Una vez cerrado el período de postulaciones, evaluaremos todas las solicitudes y recibirás el resultado por este mismo correo en un plazo de <strong>3 días hábiles</strong>.
      </p>
    </div>
    <p style="font-size:12px;color:#94a3b8;text-align:center;margin-top:24px">
      Recuerda que toda la información declarada es bajo juramento y sujeta a verificación posterior.
    </p>
  </div>
</div></body></html>`,
    }),
  });
}

// ── EMAIL RESULTADO ──
async function enviarEmailResultado(email, nombre, estado, porcentaje, justificacion, semestre) {
  const KEY  = process.env.RESEND_API_KEY;
  const FROM = process.env.EMAIL_FROM || 'Instituto Neumann <onboarding@resend.dev>';
  if (!KEY || !email) return;

  const aprobada = estado === 'aprobada';
  const color    = aprobada ? '#10b981' : '#ef4444';
  const icon     = aprobada ? '✅' : '❌';
  const titulo   = aprobada ? `Beca Asistencial ${porcentaje}% aprobada` : 'Postulación no seleccionada';

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [email],
      subject: `${icon} Resultado de tu postulación — Beca Asistencial ${semestre}`,
      html: `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:520px;margin:30px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#1e3a5f,#0f1117);padding:28px 32px">
    <div style="font-size:28px;margin-bottom:8px">${icon}</div>
    <h1 style="margin:0;color:${color};font-size:20px">${titulo}</h1>
    <p style="margin:6px 0 0;color:#94a3b8;font-size:14px">Beca Asistencial · Semestre ${semestre}</p>
  </div>
  <div style="padding:28px 32px">
    <p style="font-size:15px;color:#334155">Hola <strong>${nombre}</strong>,</p>
    <p style="font-size:14px;color:#334155;line-height:1.6">${justificacion}</p>
    ${aprobada ? `<div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:10px;padding:16px 20px;margin:20px 0;text-align:center">
      <p style="margin:0;font-size:22px;font-weight:800;color:#10b981">Beca del ${porcentaje}%</p>
      <p style="margin:6px 0 0;font-size:13px;color:#065f46">El ajuste se aplicará en tu estado de cuenta para el semestre ${semestre}.</p>
    </div>` : `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:16px 20px;margin:20px 0">
      <p style="margin:0;font-size:13px;color:#991b1b">Podrás volver a postular en el siguiente período de becas una vez que hayas recibido esta notificación.</p>
    </div>`}
    <p style="font-size:12px;color:#94a3b8;text-align:center;margin-top:24px">Instituto Superior Neumann · Servicio al Estudiante</p>
  </div>
</div></body></html>`,
    }),
  });
}

async function verificarDirector(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) { res.status(401).json({ error: 'Token requerido' }); return null; }
  const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': process.env.SUPABASE_SECRET_KEY },
  });
  if (!userRes.ok) { res.status(401).json({ error: 'Sesión inválida' }); return null; }
  const user = await userRes.json();
  const staff = (await query('staff', 'GET', null, `?auth_user_id=eq.${user.id}&select=*,roles(nombre)&limit=1`))?.[0];
  if (!staff || !staff.activo) { res.status(403).json({ error: 'Sin acceso' }); return null; }
  if (staff.roles?.nombre !== 'director') { res.status(403).json({ error: 'Solo el director puede gestionar periodos' }); return null; }
  return staff;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    // ── GET: cronograma activo ──
    if (req.method === 'GET' && req.query?.accion === 'cronograma') {
      const data = await query('cronograma_becas', 'GET', null, '?activo=eq.true&order=fecha_inicio.desc&limit=1');
      res.json({ cronograma: data?.[0] || null }); return;
    }

    // ── GET: lista de cronogramas (público, sin datos personales) ──
    if (req.method === 'GET' && req.query?.accion === 'cronograma-lista') {
      const data = await query('cronograma_becas', 'GET', null, '?order=fecha_inicio.desc');
      res.json(data || []); return;
    }

    // ── GET: lista de todos los periodos (admin) ──
    if (req.method === 'GET' && req.query?.accion === 'periodos') {
      const director = await verificarDirector(req, res);
      if (!director) return;
      const data = await query('cronograma_becas', 'GET', null, '?order=fecha_inicio.desc');
      res.json(data || []); return;
    }

    // ── POST: crear/actualizar periodo (admin) ──
    if (req.method === 'POST' && (req.body?.accion === 'crear-periodo' || req.body?.accion === 'actualizar-periodo')) {
      const director = await verificarDirector(req, res);
      if (!director) return;
      const { id, semestre, fecha_inicio, fecha_cierre, fecha_resultados, activo } = req.body;
      if (!semestre || !fecha_inicio || !fecha_cierre) {
        res.status(400).json({ error: 'Semestre, fecha de inicio y fecha de cierre son obligatorios' }); return;
      }
      // Solo un periodo activo a la vez: si este queda activo, desactivar los demás
      if (activo) {
        await query('cronograma_becas', 'PATCH', { activo: false }, '?activo=eq.true');
      }
      const row = {
        semestre,
        fecha_inicio,
        fecha_cierre,
        fecha_resultados: fecha_resultados || null,
        activo: !!activo,
      };
      if (req.body.accion === 'actualizar-periodo' && id) {
        await query('cronograma_becas', 'PATCH', row, `?id=eq.${id}`);
      } else {
        await query('cronograma_becas', 'POST', row);
      }
      res.json({ ok: true }); return;
    }

    // ── GET: estado de postulación de un estudiante ──
    if (req.method === 'GET' && req.query?.accion === 'estado') {
      const { codigo, semestre } = req.query;
      if (!codigo) { res.status(400).json({ error: 'Código requerido' }); return; }
      const filtro = semestre
        ? `?codigo=eq.${codigo}&semestre=eq.${semestre}&limit=1`
        : `?codigo=eq.${codigo}&order=ts.desc&limit=1`;
      const data = await query('postulaciones_beca', 'GET', null, filtro);
      res.json({ postulacion: data?.[0] || null }); return;
    }

    // ── GET: dashboard (admin) ──
    if (req.method === 'GET' && req.query?.accion === 'dashboard') {
      const { semestre } = req.query;
      const filtro = semestre
        ? `?semestre=eq.${semestre}&order=puntaje.desc.nullslast,ts.asc`
        : `?order=ts.desc&limit=200`;
      const data = await query('postulaciones_beca', 'GET', null, filtro);
      const postulaciones = data || [];
      const resumen = {
        total:          postulaciones.length,
        recibidas:      postulaciones.filter(p => p.estado === 'recibida').length,
        en_evaluacion:  postulaciones.filter(p => p.estado === 'en_evaluacion').length,
        aprobadas:      postulaciones.filter(p => p.estado === 'aprobada').length,
        rechazadas:     postulaciones.filter(p => p.estado === 'rechazada').length,
        descalificadas: postulaciones.filter(p => p.estado === 'descalificada').length,
      };
      res.json({ postulaciones, resumen }); return;
    }

    // ── POST: nueva postulación ──
    if (req.method === 'POST' && req.body?.accion === 'postular') {
      const { codigo, nombre, carrera, email, semestre,
              ingreso_mensual, carga_familiar, salud, sisfoh,
              tiene_deuda, evidencias, tipo_domicilio, motivo } = req.body;

      if (!codigo || !nombre || !semestre || !ingreso_mensual || !carga_familiar ||
          !salud || !sisfoh || !evidencias || !tipo_domicilio) {
        res.status(400).json({ error: 'Campos obligatorios faltantes' }); return;
      }

      // Verificar período activo
      const cronData = await query('cronograma_becas', 'GET', null,
        `?activo=eq.true&fecha_inicio=lte.${new Date().toISOString().split('T')[0]}&fecha_cierre=gte.${new Date().toISOString().split('T')[0]}&limit=1`);
      if (!cronData || !cronData[0]) {
        res.status(400).json({ error: 'No hay un período de postulaciones abierto actualmente.' }); return;
      }

      // Verificar que no tenga postulación activa en este semestre
      const existe = await query('postulaciones_beca', 'GET', null,
        `?codigo=eq.${codigo}&semestre=eq.${semestre}&limit=1`);
      if (existe && existe[0]) {
        const est = existe[0].estado;
        if (est !== 'rechazada' && est !== 'descalificada') {
          res.status(409).json({ error: 'Ya tienes una postulación activa para este semestre.', estado: est }); return;
        }
      }

      const row = {
        ts: new Date().toISOString(), semestre, codigo, nombre, carrera, email,
        ingreso_mensual: Number(ingreso_mensual), carga_familiar, salud, sisfoh,
        tiene_deuda: tiene_deuda === true || tiene_deuda === 'true',
        evidencias, tipo_domicilio, motivo: motivo || '',
        estado: 'recibida',
      };

      const data = await query('postulaciones_beca', 'POST', row);
      const id   = data?.[0]?.id;

      await enviarEmailRecepcion(email, nombre, semestre);

      res.json({ ok: true, id }); return;
    }

    // ── POST: evaluar semestre (llamado por N8N tras cierre del período) ──
    if (req.method === 'POST' && req.body?.accion === 'evaluar') {
      const authHeader = req.headers['authorization'] || '';
      const CRON_SECRET = process.env.CRON_SECRET || 'recreabot-neumann-2026';
      if (authHeader !== `Bearer ${CRON_SECRET}`) {
        res.status(401).json({ error: 'No autorizado' }); return;
      }

      const { semestre } = req.body;
      if (!semestre) { res.status(400).json({ error: 'Semestre requerido' }); return; }

      // Obtener todas las postulaciones del semestre en estado 'recibida'
      const postulaciones = await query('postulaciones_beca', 'GET', null,
        `?semestre=eq.${semestre}&estado=eq.recibida&order=ts.asc`);

      if (!postulaciones || postulaciones.length === 0) {
        res.json({ ok: true, mensaje: 'No hay postulaciones pendientes', semestre }); return;
      }

      const resultados = [];

      for (const p of postulaciones) {
        // Obtener promedio de notas del ERP (si existe en supabase como campo calculado)
        // Por ahora se usa el campo declarado o se deja en 0 para que Claude lo maneje
        const puntaje = calcularPuntaje(p);

        resultados.push({
          id:           p.id,
          codigo:       p.codigo,
          nombre:       p.nombre,
          email:        p.email,
          ts:           p.ts,
          puntaje:      puntaje.total,
          detalle:      puntaje.detalle,
          descalificado: puntaje.descalificado,
        });
      }

      // Separar descalificados
      const descalificados = resultados.filter(r => r.descalificado);
      const calificados    = resultados.filter(r => !r.descalificado && r.puntaje >= 20)
                              .sort((a,b) => b.puntaje - a.puntaje || new Date(a.ts) - new Date(b.ts));
      const sinMinimo      = resultados.filter(r => !r.descalificado && r.puntaje < 20);

      // Asignar becas: top 10 → 50%, sig 10 → 25%
      const aprobados50 = calificados.slice(0, 10);
      const aprobados25 = calificados.slice(10, 20);
      const rechazados  = [...calificados.slice(20), ...sinMinimo];

      // Actualizar estados y enviar emails
      const SUPABASE_URL = process.env.SUPABASE_URL;
      const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
      const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      };

      const ahora = new Date().toISOString();

      const actualizarYNotificar = async (lista, estado, porcentaje) => {
        for (const r of lista) {
          const justificacion = estado === 'aprobada'
            ? `Tu postulación fue evaluada y obtuvo un puntaje de ${r.puntaje} sobre 39. Felicitaciones, has sido seleccionado/a para recibir la Beca Asistencial del ${porcentaje}% para el semestre ${semestre}.`
            : estado === 'descalificada'
            ? `Tu postulación fue descalificada porque no se declararon evidencias de respaldo. Este requisito es obligatorio para participar en el proceso.`
            : `Tu postulación obtuvo un puntaje de ${r.puntaje} sobre 39. Lamentablemente, en esta oportunidad no alcanzaste los requisitos de puntaje mínimo (20 pts) o los cupos disponibles (10 becas del 50% y 10 del 25%) ya fueron cubiertos por postulantes con mayor puntaje. Puedes volver a postular en el siguiente período.`;

          await fetch(`${SUPABASE_URL}/rest/v1/postulaciones_beca?id=eq.${r.id}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({
              estado, puntaje: r.puntaje, puntaje_detalle: r.detalle,
              porcentaje_beca: porcentaje || null,
              justificacion_ia: justificacion,
              evaluado_ts: ahora, notificado_ts: ahora,
            }),
          });

          await enviarEmailResultado(r.email, r.nombre, estado, porcentaje, justificacion, semestre);
        }
      };

      await actualizarYNotificar(aprobados50,    'aprobada',      50);
      await actualizarYNotificar(aprobados25,    'aprobada',      25);
      await actualizarYNotificar(rechazados,     'rechazada',     null);
      await actualizarYNotificar(descalificados, 'descalificada', null);

      res.json({
        ok: true, semestre,
        aprobados_50: aprobados50.length,
        aprobados_25: aprobados25.length,
        rechazados:   rechazados.length,
        descalificados: descalificados.length,
      }); return;
    }

    res.status(400).json({ error: 'Acción no válida' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
}
