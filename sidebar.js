// sidebar.js — Menú lateral compartido para todas las páginas de staff.
// Se auto-inicializa: obtiene sesión + permisos y se inyecta en <body> sin que
// cada página tenga que hacer nada más que incluir este script.
(function () {
  const NAV = [
    { label: 'General', items: [
      { icon: '🏠', text: 'Dashboard Ejecutivo', href: '/ejecutivo', modulo: null },
    ]},
    { label: 'Campus', items: [
      { icon: '🏃', text: 'Recreativos',  href: '/recreativos-dashboard', modulo: 'recreativos_panel' },
      { icon: '☕', text: 'Cafetería',    href: '/cafeteria-dashboard',   modulo: 'cafeteria_dashboard' },
      { icon: '🚻', text: 'Baños',        href: '/bano-dashboard',        modulo: 'bano_dashboard' },
    ]},
    { label: 'Salud', items: [
      { icon: '🏥', text: 'Dashboard',           href: '/salud-dashboard', modulo: 'salud_dashboard' },
      { icon: '🩺', text: 'Gestión de atenciones', href: '/salud-gestion',  modulo: 'salud_gestion' },
    ]},
    { label: 'Psicopedagógico', items: [
      { icon: '🧠', text: 'Dashboard',            href: '/psicopedagogico-dashboard', modulo: 'psico_dashboard' },
      { icon: '🗓️', text: 'Gestión de sesiones',  href: '/psico-gestion',             modulo: 'psico_gestion' },
      { icon: '📋', text: 'Gestión de reservas',  href: '/psico-reservas-gestion',    modulo: 'psico_reservas_gestion' },
      { icon: '⏰', text: 'Disponibilidad',       href: '/psico-disponibilidad',      modulo: 'psico_disponibilidad' },
      { icon: '📲', text: 'Códigos QR',           href: '/psico-qr',                  modulo: 'psico_gestion' },
    ]},
    { label: 'Estudiantes', items: [
      { icon: '🎓', text: 'Asistencia',  href: '/asistencia-dashboard', modulo: 'asistencia_dashboard' },
      { icon: '🎓', text: 'Becas',       href: '/beca-dashboard',       modulo: 'beca_dashboard' },
      { icon: '🏛️', text: 'Cultura',     href: '/cultura-dashboard',    modulo: 'cultura_dashboard' },
      { icon: '📚', text: 'Conocimientos', href: '/conocimientos',      modulo: null },
    ]},
    { label: 'Calidad', items: [
      { icon: '⭐', text: 'Dashboard Mes Calidad', href: '/calidad-dashboard', modulo: 'calidad_dashboard' },
      { icon: '🛠️', text: 'Configuración',         href: '/calidad-config',   modulo: 'calidad_config' },
    ]},
    { label: 'Administración', items: [
      { icon: '⚙️', text: 'Usuarios y Permisos', href: '/admin-usuarios', modulo: 'admin_usuarios' },
    ]},
  ];

  const CSS = `
  #ns-sidebar{position:fixed;top:0;left:0;width:240px;min-width:240px;height:100vh;
    background:#1a2235;border-right:1px solid #2a3a52;display:flex;flex-direction:column;
    overflow-y:auto;z-index:1000;font-family:'Inter',sans-serif}
  #ns-sidebar *{box-sizing:border-box}
  .ns-brand{padding:20px 18px 14px;border-bottom:1px solid #2a3a52}
  .ns-brand-logo{width:36px;height:36px;background:#6366f1;border-radius:8px;display:flex;
    align-items:center;justify-content:center;font-size:1.2rem;margin-bottom:10px}
  .ns-brand-name{font-size:0.92rem;font-weight:700;color:#e2e8f0}
  .ns-brand-sub{font-size:0.7rem;color:#64748b;margin-top:2px;line-height:1.4}
  .ns-section{padding:14px 10px 6px}
  .ns-label{font-size:0.66rem;font-weight:600;color:#64748b;letter-spacing:1.1px;
    text-transform:uppercase;padding:0 8px;margin-bottom:4px}
  .ns-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;
    cursor:pointer;font-size:0.82rem;color:#94a3b8;transition:all .15s;border:1px solid transparent;
    text-decoration:none}
  .ns-item:hover{background:#212d42;color:#e2e8f0}
  .ns-item.ns-active{background:rgba(99,102,241,.12);color:#a5b4fc;border-color:#6366f1}
  .ns-item .ns-icon{font-size:0.95rem;width:18px;text-align:center;flex-shrink:0}
  .ns-footer{margin-top:auto;padding:14px 14px;border-top:1px solid #2a3a52}
  .ns-user{font-size:0.76rem;color:#94a3b8;margin-bottom:8px}
  .ns-user strong{color:#e2e8f0;display:block;font-size:0.8rem;margin-bottom:1px}
  .ns-logout{width:100%;font-size:0.74rem;font-weight:600;color:#64748b;background:none;
    border:1px solid #2a3a52;border-radius:6px;padding:7px 10px;cursor:pointer;transition:all .15s}
  .ns-logout:hover{border-color:#ef4444;color:#ef4444}
  @media(max-width:780px){
    #ns-sidebar{transform:translateX(-100%);transition:transform .2s;box-shadow:4px 0 24px rgba(0,0,0,.4)}
    #ns-sidebar.ns-open{transform:translateX(0)}
    #ns-toggle{display:flex !important}
  }
  #ns-toggle{display:none;position:fixed;top:14px;left:14px;z-index:1001;width:38px;height:38px;
    background:#1a2235;border:1px solid #2a3a52;border-radius:8px;color:#e2e8f0;font-size:1.1rem;
    align-items:center;justify-content:center;cursor:pointer}
  `;

  function buildHtml(info, currentPath, isAdmin) {
    const allowed = (m) => !m || isAdmin || (info.modulos || []).includes(m);
    const sections = NAV.map(sec => {
      const items = sec.items.filter(it => allowed(it.modulo));
      if (!items.length) return '';
      const itemsHtml = items.map(it => {
        const active = currentPath === it.href ? ' ns-active' : '';
        return `<a class="ns-item${active}" href="${it.href}"><span class="ns-icon">${it.icon}</span><span>${it.text}</span></a>`;
      }).join('');
      return `<div class="ns-section"><div class="ns-label">${sec.label}</div>${itemsHtml}</div>`;
    }).join('');

    return `
      <div class="ns-brand">
        <div class="ns-brand-logo">🏫</div>
        <div class="ns-brand-name">Instituto Neumann</div>
        <div class="ns-brand-sub">Sistema de gestión</div>
      </div>
      ${sections}
      <div class="ns-footer">
        <div class="ns-user"><strong>${info.nombre || ''}</strong>${info.rol || ''}</div>
        <button class="ns-logout" id="ns-logout-btn">Cerrar sesión</button>
      </div>
    `;
  }

  async function init() {
    if (!window.supabase) return;
    const sb = window.supabase.createClient(
      'https://exjaxhrylfdwehzjfjut.supabase.co',
      'sb_publishable_EP2Y83o7nj7CGCUd0pH3VA_vSNkeg99'
    );
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return; // la propia página ya redirige a /login

    let info;
    try {
      const r = await fetch('/api/staff-info', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      if (!r.ok) return;
      info = await r.json();
    } catch (e) { return; }

    const isAdmin = info.rol === 'director';
    const currentPath = window.location.pathname.replace(/\/$/, '') || '/';

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const toggle = document.createElement('button');
    toggle.id = 'ns-toggle';
    toggle.innerHTML = '☰';
    document.body.appendChild(toggle);

    const aside = document.createElement('aside');
    aside.id = 'ns-sidebar';
    aside.innerHTML = buildHtml(info, currentPath, isAdmin);
    document.body.insertBefore(aside, document.body.firstChild);

    const marginStyle = document.createElement('style');
    marginStyle.textContent = `body{margin-left:240px !important}@media(max-width:780px){body{margin-left:0 !important}}`;
    document.head.appendChild(marginStyle);

    toggle.addEventListener('click', () => aside.classList.toggle('ns-open'));

    document.getElementById('ns-logout-btn').addEventListener('click', async () => {
      await sb.auth.signOut();
      window.location.href = '/login';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
