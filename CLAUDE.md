# RecreaBot — Instituto Superior Neumann
## Contexto para Claude Code

---

## ¿Qué es este proyecto?

RecreaBot es el primer agente de IA del Instituto Superior Neumann, un instituto superior licenciado del Perú que imparte dos carreras presenciales:
- **Administración de Negocios Internacionales**
- **Contabilidad**

Este agente gestiona las **reservas de espacios recreativos del campus** — es la primera función digitalizada de lo que será una organización inteligente completa.

---

## Stack tecnológico

| Componente | Tecnología | URL/Detalle |
|---|---|---|
| Frontend + Bot | HTML/CSS/JS vanilla | Archivos estáticos |
| Backend APIs | Node.js (Vercel Functions) | `/api/*.js` |
| Base de datos | Supabase (PostgreSQL) | `exjaxhrylfdwehzjfjut.supabase.co` |
| Deploy | Vercel | `recreabot-neumann.vercel.app` |
| Repositorio | GitHub | `github.com/Alejandro041978/recreabot-neumann` |
| IA conversacional | Claude API (claude-sonnet-4-5) | Via `/api/chat.js` |
| Email | Resend | Para confirmaciones y reportes |
| Automatización | N8N (self-hosted) | Sincronización ERP → Supabase |
| ERP | Microsoft SQL Server | `activa.education:1433` DB: `jvn-activa` |

---

## Estructura de archivos

```
recreabot-neumann/
├── index.html          # Panel de administración completo
├── bot.html            # Bot para estudiantes (vía QR)
├── eval.html           # Formulario de evaluación post-uso
├── config.html         # Configuración de horarios por área
├── qr.html             # Carteles QR para imprimir
├── vercel.json         # Rutas y configuración de Vercel
└── api/
    ├── _supabase.js    # Helper compartido para Supabase
    ├── chat.js         # Proxy Claude API (resuelve CORS)
    ├── sheets.js       # CRUD registros de reservas en Supabase
    ├── estudiantes.js  # Consulta base de estudiantes en Supabase
    ├── config.js       # Configuración de horarios por área
    ├── evaluacion.js   # Envío de email de confirmación (Resend)
    ├── evaluaciones.js # Guarda evaluaciones post-uso en Supabase
    └── reporte.js      # Reporte semanal automático (Resend + cron)
```

---

## URLs en producción

| URL | Qué es |
|---|---|
| `recreabot-neumann.vercel.app` | Panel de administración |
| `recreabot-neumann.vercel.app/bot` | Bot para estudiantes |
| `recreabot-neumann.vercel.app/bot?area=Canchita+A` | Bot con área preseleccionada por QR |
| `recreabot-neumann.vercel.app/config` | Configuración de horarios |
| `recreabot-neumann.vercel.app/qr` | Carteles QR para imprimir |
| `recreabot-neumann.vercel.app/eval` | Formulario de evaluación |
| `recreabot-neumann.vercel.app/api/sheets` | API registros |
| `recreabot-neumann.vercel.app/api/estudiantes` | API estudiantes |
| `recreabot-neumann.vercel.app/api/config` | API configuración horarios |

---

## Variables de entorno en Vercel

```
ANTHROPIC_API_KEY      = sk-ant-api03-...
SUPABASE_URL           = https://exjaxhrylfdwehzjfjut.supabase.co
SUPABASE_SECRET_KEY    = sb_secret_b9RTG...
RESEND_API_KEY         = re_UiYhTBg1_...
EMAIL_REPORTE          = director@neumann.education
EMAIL_FROM             = RecreaBot Neumann <onboarding@resend.dev>
CRON_SECRET            = recreabot-neumann-2026
GOOGLE_SHEET_ID        = 1tkr4mtSnQ8f6V9mniq4-n1BJwAASJXrYwa8i8Re6VN8 (legacy)
GOOGLE_SA_JSON         = {...} (legacy - ya no se usa activamente)
```

---

## Base de datos Supabase

### Tablas activas en RecreaBot

```sql
-- Reservas de espacios recreativos
registros (id, ts, codigo, carrera, area, participantes, 
           fecha_reserva, horario, estado, problema, calificacion)

-- Base de estudiantes (sincronizada desde ERP via N8N)
estudiantes (id, codigo UNIQUE, nombre, apellido, carrera, 
             email, whatsapp, activo)

-- Evaluaciones post-uso
evaluaciones (id, ts, codigo, area, fecha, horario, 
              calificacion, estado_equipo, volveria, comentario)

-- Configuración de horarios por área
config_horarios (id, area UNIQUE, slots TEXT[], dias, activa, tipo_slot)

-- Incidencias reportadas
incidencias (id, ts, area, descripcion, codigo_reportante, estado)
```

### Esquema maestro (futuro - ya creado)

```sql
-- Módulos preparados para futuros agentes:
personas, estudiantes, docentes        -- Identidad
carreras, cursos, matriculas, notas    -- Académico  
pagos, deudas, conceptos_pago          -- Finanzas
solicitudes_documentos                 -- Registros
espacios, config_horarios, registros   -- Campus (activo)
prospectos                             -- Admisión/CRM
tickets                                -- Servicio al estudiante
evaluaciones                           -- Satisfacción
incidencias                            -- Mantenimiento
logs_agentes                           -- Trazabilidad IA
```

---

## Áreas recreativas del campus

| Área | Tipo de slot | Slots disponibles |
|---|---|---|
| Canchita A | 2 horas | 8-10am, 10am-12pm, 12-2pm, 2-4pm, 4-6pm, 6-8pm, 8-10pm |
| Canchita B | 2 horas | 8-10am, 10am-12pm, 12-2pm, 2-4pm, 4-6pm, 6-8pm, 8-10pm |
| Taka Taka | 1 hora | 8-9am, 9-10am, 10-11am... hasta 9-10pm |
| Ajedrez | 1 hora | 8-9am, 9-10am, 10-11am... hasta 9-10pm |
| Sapito | 1 hora | 8-9am, 9-10am, 10-11am... hasta 9-10pm |

---

## Flujo del bot para estudiantes

```
1. Estudiante escanea QR del área
2. Abre recreabot-neumann.vercel.app/bot?area=X
3. Bot pregunta código de estudiante
4. Sistema verifica en Supabase tabla 'estudiantes'
   → Código no existe: bloquea con mensaje
   → Código inactivo: bloquea con mensaje
   → Código válido: saluda por nombre, conoce la carrera
5. Bot pregunta participantes, fecha y slot de horario
6. Bot confirma con resumen en formato EXACTO:
   Código: XXXXXX
   Carrera: Administración de Negocios Internacionales o Contabilidad
   Área: nombre exacto
   Participantes: número
   Fecha: fecha exacta
   Horario: slot exacto (ej: 8-9am)
   [REGISTRO COMPLETO ✅]
7. Sistema extrae datos del resumen → guarda en Supabase
8. Sistema envía email de confirmación + link de evaluación via Resend
```

---

## Sincronización ERP → Supabase (N8N)

**Carga inicial completada:** 14,057 estudiantes

**Workflow nocturno (2am Lima):**
```
Schedule Trigger (diario 2am)
→ Microsoft SQL Server query (solo registros últimas 25h)
→ Code JavaScript (deduplicar + lotes de 100)
→ HTTP Request POST Supabase (upsert en tabla estudiantes)
→ IF (¿hubo cambios?)
→ Email notificación via Resend
```

**Query SQL de sincronización incremental:**
```sql
SELECT DISTINCT
  p.idpersona AS codigo, p.Nombre AS nombre,
  p.[Apellido Paterno] AS apellido_paterno,
  p.[Apellido Materno] AS apellido_materno,
  pr.producto AS carrera,
  p.[Correo Electronico] AS email,
  p.[Teléfono1_Esa] AS whatsapp,
  CASE WHEN p.suspendido = 'true' THEN 0 ELSE 1 END AS activo
FROM persona p
INNER JOIN cliente cl ON p.idpersonaNew = cl.idpersonanew
INNER JOIN producto pr ON cl.idproducto = pr.idproducto
WHERE pr.producto IN (
  'Administración de Negocios Internacionales', 'Contabilidad'
)
AND (
  p.creación >= DATEADD(hour, -25, GETDATE())
  OR p.fechamodificacion >= DATEADD(hour, -25, GETDATE())
)
```

---

## Organización del Instituto Neumann

### Áreas operativas
- **Administración:** RRHH, mantenimiento, logística, contabilidad, pagos y cobranzas
- **CRM/Admisión:** Agencia externa + Bitrix24 para marketing y admisión
- **Servicio al Estudiante:** Atención a estudiantes y padres
- **Oficina de Registros:** Constancias, diplomas, MINEDU
- **Dirección Académica:** Docentes, planes de estudio, evaluaciones
- **Campus:** Recreación, laboratorios, sala de estudio, cafetería

### ERP
- **Sistema:** Microsoft SQL Server en `activa.education`
- **Base de datos:** `jvn-activa`
- **Tablas clave:** `persona`, `cliente`, `producto`, `alumno`
- **Acceso N8N:** Usuario `n8n` con permisos de solo lectura

---

## Hoja de ruta — Organización Inteligente

### Completado ✅
- Agente RecreaBot (gestión espacios recreativos)
- Base de datos Supabase con esquema maestro
- Sincronización ERP → Supabase via N8N

### Próximos módulos (en orden sugerido)
1. **Agente de Consulta de Notas** — estudiante consulta sus notas por WhatsApp/bot
2. **Agente de Estado de Cuenta** — consulta deudas y pagos pendientes
3. **Agente de Solicitud de Constancias** — solicita documentos sin ir a secretaría
4. **Agente de Matrícula** — asistente para proceso de matrícula
5. **Dashboard Ejecutivo** — consolida KPIs de todos los módulos

### Arquitectura objetivo
```
WhatsApp / Web / QR
        ↓
Orquestador Central (Claude API)
        ↓
Agentes especializados (uno por función)
        ↓
Supabase (base de datos centralizada)
        ↑
N8N (sincronización con ERP SQL Server)
```

---

## Notas importantes para desarrollo

1. **Deploy:** GitHub push → Vercel deploy automático (configurar webhook)
2. **Modelo Claude:** Siempre usar `claude-sonnet-4-5`
3. **Timezone:** Siempre usar `America/Lima` (UTC-5)
4. **Carrera:** El nombre completo es `Administración de Negocios Internacionales` — nunca abreviar a "Administración"
5. **Slots:** Los slots de Canchita A y B son de 2 horas; Taka Taka, Ajedrez y Sapito de 1 hora
6. **CORS:** Las APIs de Vercel resuelven el CORS — nunca llamar a Anthropic directamente desde el browser
7. **Supabase helper:** Siempre importar desde `./_supabase.js` para las consultas a la base de datos
