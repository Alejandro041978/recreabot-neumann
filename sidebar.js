// sidebar.js — Menú lateral compartido para todas las páginas de staff.
(function () {

  // ── 1. Inyectar CSS de layout SINCRÓNICAMENTE para evitar salto visual ──
  const layoutStyle = document.createElement('style');
  layoutStyle.id = 'ns-layout';
  layoutStyle.textContent = [
    'body{margin-left:240px !important}',
    '@media(max-width:780px){body{margin-left:0 !important;padding-top:52px !important}}',
  ].join('');
  document.head.appendChild(layoutStyle);

  // ── 2. Estructura de navegación 3 niveles ──
  const NAV = [
    { label: 'General', items: [
      { icon: '🏠', text: 'Dashboard Ejecutivo', href: '/ejecutivo', modulo: null },
    ]},
    { label: 'Servicios', items: [
      { icon: '🏃', text: 'Recreativos',  href: '/recreativos-dashboard', modulo: 'recreativos_panel' },
      { icon: '☕', text: 'Cafetería', group: true,
        anyModulo: ['cafeteria_dashboard','supervision_cafeteria'],
        children: [
          { icon: '📊', text: 'Dashboard',   href: '/cafeteria-dashboard',    modulo: 'cafeteria_dashboard' },
          { icon: '🍽️', text: 'Supervisión', href: '/supervision-cafeteria',  modulo: 'supervision_cafeteria' },
        ],
      },
      { icon: '🏛️', text: 'Museos',       href: '/cultura-dashboard',     modulo: 'cultura_dashboard' },
      { icon: '🚻', text: 'Baños',        href: '/bano-dashboard',        modulo: 'bano_dashboard' },
      // Grupos expandibles
      { icon: '🧠', text: 'Psicopedagógico', group: true,
        anyModulo: ['psico_dashboard','psico_gestion','psico_reservas_gestion','psico_disponibilidad','psico_seguimiento'],
        children: [
          { icon: '📊', text: 'Dashboard',      href: '/psicopedagogico-dashboard', modulo: 'psico_dashboard' },
          { icon: '📋', text: 'Reservas',        href: '/psico-reservas-gestion',    modulo: 'psico_reservas_gestion' },
          { icon: '🗓️', text: 'Sesiones',        href: '/psico-gestion',             modulo: 'psico_gestion' },
          { icon: '🔁', text: 'Seguimiento',     href: '/psico-seguimiento',         modulo: 'psico_seguimiento' },
          { icon: '⏰', text: 'Disponibilidad',  href: '/psico-disponibilidad',      modulo: 'psico_disponibilidad' },
          { icon: '📲', text: 'Códigos QR',      href: '/psico-qr',                  modulo: 'psico_qr' },
        ],
      },
      { icon: '🏥', text: 'Salud', group: true,
        anyModulo: ['salud_dashboard','salud_gestion'],
        children: [
          { icon: '📊', text: 'Dashboard',  href: '/salud-dashboard', modulo: 'salud_dashboard' },
          { icon: '🩺', text: 'Atenciones', href: '/salud-gestion',   modulo: 'salud_gestion' },
        ],
      },
    ]},
    { label: 'Estudiantes', items: [
      { icon: '🧑‍🎓', text: 'Base de Estudiantes', href: '/base-estudiantes',    modulo: 'base_estudiantes' },
      { icon: '🎓', text: 'Asistencia',    href: '/asistencia-dashboard', modulo: 'asistencia_dashboard' },
      { icon: '🏅', text: 'Becas', group: true,
        anyModulo: ['beca_dashboard','beca_periodos'],
        children: [
          { icon: '📊', text: 'Dashboard',  href: '/beca-dashboard', modulo: 'beca_dashboard' },
          { icon: '🗓️', text: 'Periodos',   href: '/beca-periodos',  modulo: 'beca_periodos' },
        ],
      },
      { icon: '🎭', text: 'Cultura',        href: '/cultura-dashboard',    modulo: 'cultura_dashboard' },
    ]},
    { label: 'Calidad', items: [
      { icon: '⭐', text: 'Dashboard Mes Calidad', href: '/calidad-dashboard', modulo: 'calidad_dashboard' },
      { icon: '🛠️', text: 'Configuración',         href: '/calidad-config',   modulo: 'calidad_config' },
    ]},
    { label: 'Administración', items: [
      { icon: '⚙️', text: 'Usuarios y Permisos', href: '/admin-usuarios', modulo: 'admin_usuarios' },
      { icon: '🤖', text: 'Bot John', group: true,
        anyModulo: ['bot_config','conocimientos','bot_supervisor','john_metrics'],
        children: [
          { icon: '⚙️', text: 'Configuración del Bot', href: '/bot-config',    modulo: 'bot_config' },
          { icon: '📚', text: 'Conocimientos',         href: '/conocimientos',  modulo: 'conocimientos' },
          { icon: '🕵️', text: 'Supervisor de John',    href: '/bot-supervisor', modulo: 'bot_supervisor' },
          { icon: '📈', text: 'Métricas de John',       href: '/john-metrics',   modulo: 'john_metrics' },
        ],
      },
    ]},
  ];

  // ── 3. CSS del sidebar ──
  const CSS = `
  #ns-sidebar{
    position:fixed;top:0;left:0;width:240px;height:100vh;
    background:#131b2a;border-right:1px solid #1e2d45;
    display:flex;flex-direction:column;overflow-y:auto;
    z-index:1000;font-family:'Inter',sans-serif;
    scrollbar-width:thin;scrollbar-color:#1e2d45 transparent;
  }
  #ns-sidebar *{box-sizing:border-box}
  #ns-sidebar::-webkit-scrollbar{width:4px}
  #ns-sidebar::-webkit-scrollbar-track{background:transparent}
  #ns-sidebar::-webkit-scrollbar-thumb{background:#1e2d45;border-radius:4px}

  .ns-brand{
    padding:18px 16px 14px;border-bottom:1px solid #1e2d45;
    display:flex;align-items:center;gap:10px;flex-shrink:0;
  }
  .ns-brand-logo{
    width:34px;height:34px;background:#6366f1;border-radius:8px;
    display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;
  }
  .ns-brand-name{font-size:0.88rem;font-weight:700;color:#e2e8f0;line-height:1.2}
  .ns-brand-sub{font-size:0.66rem;color:#4b6080;margin-top:1px}

  .ns-section{padding:10px 8px 4px}
  .ns-label{
    font-size:0.6rem;font-weight:700;color:#3d5470;letter-spacing:1.2px;
    text-transform:uppercase;padding:0 8px;margin-bottom:3px;
  }

  /* Ítem de nivel 2 (leaf) */
  .ns-item{
    display:flex;align-items:center;gap:9px;padding:7px 9px;
    border-radius:7px;cursor:pointer;font-size:0.8rem;color:#7a94b0;
    transition:all .12s;border:1px solid transparent;text-decoration:none;
  }
  .ns-item:hover{background:#192536;color:#c4d4e8}
  .ns-item.ns-active{background:rgba(99,102,241,.14);color:#a5b4fc;border-color:rgba(99,102,241,.35)}
  .ns-item .ns-icon{font-size:0.9rem;width:16px;text-align:center;flex-shrink:0;line-height:1}

  /* Ítem de nivel 2 que tiene hijos (grupo expandible) */
  .ns-group-header{
    display:flex;align-items:center;gap:9px;padding:7px 9px;
    border-radius:7px;cursor:pointer;font-size:0.8rem;color:#7a94b0;
    transition:all .12s;border:1px solid transparent;
    user-select:none;
  }
  .ns-group-header:hover{background:#192536;color:#c4d4e8}
  .ns-group-header.ns-group-open{color:#c4d4e8}
  .ns-group-header .ns-icon{font-size:0.9rem;width:16px;text-align:center;flex-shrink:0;line-height:1}
  .ns-group-chevron{
    margin-left:auto;font-size:0.6rem;color:#3d5470;
    transition:transform .15s;line-height:1;
  }
  .ns-group-header.ns-group-open .ns-group-chevron{transform:rotate(90deg);color:#6b7fa0}

  /* Contenedor de sub-ítems */
  .ns-children{
    overflow:hidden;max-height:0;transition:max-height .2s ease;
    padding-left:12px;
  }
  .ns-children.ns-open{max-height:420px}

  /* Sub-ítem de nivel 3 */
  .ns-child{
    display:flex;align-items:center;gap:8px;padding:5px 9px 5px 6px;
    border-radius:6px;cursor:pointer;font-size:0.75rem;color:#5d7a96;
    transition:all .12s;text-decoration:none;
    border-left:2px solid #1e2d45;margin-bottom:1px;
  }
  .ns-child:hover{color:#a0b8d0;border-left-color:#3d5470}
  .ns-child.ns-active{color:#a5b4fc;border-left-color:#6366f1;background:rgba(99,102,241,.08)}
  .ns-child .ns-icon{font-size:0.78rem;width:14px;text-align:center;flex-shrink:0}

  /* Footer */
  .ns-footer{margin-top:auto;padding:12px;border-top:1px solid #1e2d45;flex-shrink:0}
  .ns-user{font-size:0.72rem;color:#5d7a96;margin-bottom:7px;line-height:1.4}
  .ns-user strong{color:#c4d4e8;display:block;font-size:0.76rem;margin-bottom:1px}
  .ns-logout{
    width:100%;font-size:0.72rem;font-weight:600;color:#3d5470;
    background:none;border:1px solid #1e2d45;border-radius:6px;
    padding:6px 10px;cursor:pointer;transition:all .15s;font-family:'Inter',sans-serif;
  }
  .ns-logout:hover{border-color:#ef4444;color:#ef4444}

  /* Hamburguesa móvil */
  #ns-toggle{
    display:none;position:fixed;top:10px;left:10px;z-index:1001;
    width:36px;height:36px;background:#131b2a;border:1px solid #1e2d45;
    border-radius:7px;color:#e2e8f0;font-size:1rem;
    align-items:center;justify-content:center;cursor:pointer;
  }
  @media(max-width:780px){
    #ns-sidebar{transform:translateX(-100%);transition:transform .2s;box-shadow:4px 0 24px rgba(0,0,0,.5)}
    #ns-sidebar.ns-open{transform:translateX(0)}
    #ns-toggle{display:flex !important}
  }

  /* Estado de carga (skeleton) para que la columna nunca se vea vacía */
  .ns-loading{padding:14px 10px;display:flex;flex-direction:column;gap:8px}
  .ns-sk{height:30px;border-radius:7px;background:linear-gradient(90deg,#192536 25%,#22344d 50%,#192536 75%);background-size:200% 100%;animation:ns-shimmer 1.2s ease-in-out infinite}
  @keyframes ns-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
  `;

  // ── 4. Construcción del HTML ──
  function buildHtml(info, currentPath, isAdmin) {
    const allowed = (m) => !m || isAdmin || (info.modulos || []).includes(m);
    const allowedAny = (arr) => isAdmin || (arr || []).some(m => (info.modulos || []).includes(m));

    function isChildActive(children) {
      return children.some(c => c.href === currentPath);
    }

    const sections = NAV.map(sec => {
      const itemsHtml = sec.items.map(it => {
        if (it.group) {
          // Grupo expandible: visible si al menos un hijo está permitido
          const visibleChildren = it.children.filter(c => allowed(c.modulo));
          if (!visibleChildren.length && !isAdmin) return '';
          if (!allowedAny(it.anyModulo) && !isAdmin) return '';

          const open = isChildActive(it.children);
          const childrenHtml = (isAdmin ? it.children : visibleChildren).map(c => {
            const active = currentPath === c.href ? ' ns-active' : '';
            return `<a class="ns-child${active}" href="${c.href}"><span class="ns-icon">${c.icon}</span><span>${c.text}</span></a>`;
          }).join('');

          return `
            <div class="ns-group-header${open ? ' ns-group-open' : ''}" onclick="this.classList.toggle('ns-group-open');this.nextElementSibling.classList.toggle('ns-open')">
              <span class="ns-icon">${it.icon}</span>
              <span>${it.text}</span>
              <span class="ns-group-chevron">▶</span>
            </div>
            <div class="ns-children${open ? ' ns-open' : ''}">${childrenHtml}</div>
          `;
        }
        // Ítem normal
        if (!allowed(it.modulo)) return '';
        const active = currentPath === it.href ? ' ns-active' : '';
        return `<a class="ns-item${active}" href="${it.href}"><span class="ns-icon">${it.icon}</span><span>${it.text}</span></a>`;
      }).join('');

      if (!itemsHtml.trim()) return '';
      return `<div class="ns-section"><div class="ns-label">${sec.label}</div>${itemsHtml}</div>`;
    }).join('');

    return `
      <div class="ns-brand">
        <div class="ns-brand-logo">🏫</div>
        <div><div class="ns-brand-name">Instituto Neumann</div><div class="ns-brand-sub">Sistema de gestión</div></div>
      </div>
      ${sections}
      <div class="ns-footer">
        <div class="ns-user"><strong>${info.nombre || ''}</strong>${info.rol || ''}</div>
        <button class="ns-logout" id="ns-logout-btn">Cerrar sesión</button>
      </div>
    `;
  }

  // ── 5. Estado, cliente y estilos (síncrono) ──
  const currentPath = window.location.pathname.replace(/\/$/, '') || '/';
  const sb = window.supabase ? window.supabase.createClient(
    'https://exjaxhrylfdwehzjfjut.supabase.co',
    'sb_publishable_EP2Y83o7nj7CGCUd0pH3VA_vSNkeg99'
  ) : null;

  // Inyectar CSS del sidebar una sola vez, de inmediato
  if (!document.getElementById('ns-css')) {
    const style = document.createElement('style');
    style.id = 'ns-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function brandHtml() {
    return '<div class="ns-brand"><div class="ns-brand-logo">🏫</div><div>' +
      '<div class="ns-brand-name">Instituto Neumann</div>' +
      '<div class="ns-brand-sub">Sistema de gestión</div></div></div>';
  }
  function shellHtml() {
    return brandHtml() + '<div class="ns-loading">' + '<div class="ns-sk"></div>'.repeat(7) + '</div>';
  }

  function attach(aside) {
    const tgl = document.getElementById('ns-toggle');
    if (tgl) tgl.onclick = () => aside.classList.toggle('ns-open');
    const lo = document.getElementById('ns-logout-btn');
    if (lo && sb) lo.onclick = async () => {
      try { sessionStorage.removeItem(CACHE_KEY); } catch (e) {}
      await sb.auth.signOut();
      window.location.href = '/login';
    };
  }

  // Pinta el cascarón (fondo + marca + skeleton) de inmediato, sin esperar red
  function ensureShell() {
    let aside = document.getElementById('ns-sidebar');
    if (!aside) {
      aside = document.createElement('aside');
      aside.id = 'ns-sidebar';
      aside.innerHTML = shellHtml();
      document.body.insertBefore(aside, document.body.firstChild);
      if (!document.getElementById('ns-toggle')) {
        const toggle = document.createElement('button');
        toggle.id = 'ns-toggle';
        toggle.innerHTML = '☰';
        document.body.appendChild(toggle);
      }
      attach(aside);
    }
    return aside;
  }

  function render(info) {
    const isAdmin = info.rol === 'director';
    const aside = ensureShell();
    aside.innerHTML = buildHtml(info, currentPath, isAdmin);
    attach(aside);
  }

  // ── 6. Init: cascarón inmediato → caché de sesión → revalidación ──
  const CACHE_KEY = 'ns_staff_info';
  const TTL = 5 * 60 * 1000; // 5 minutos

  async function init() {
    ensureShell(); // aparece al instante, la columna nunca queda vacía

    // Render inmediato desde caché de sesión (sin red)
    let cache = null;
    try { cache = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null'); } catch (e) {}
    if (cache && cache.info && cache.info.rol) render(cache.info);

    // Revalidar solo si no hay caché o está vencida (evita el doble fetch al navegar)
    const fresca = cache && (Date.now() - (cache.ts || 0) < TTL);
    if (fresca || !sb) return;

    let session;
    try { ({ data: { session } } = await sb.auth.getSession()); } catch (e) { return; }
    if (!session) return;
    try {
      const r = await fetch('/api/staff-info', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      if (!r.ok) return;
      const info = await r.json();
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ info, ts: Date.now() }));
      render(info);
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
