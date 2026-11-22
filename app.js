'use strict';
const app = document.getElementById('app'), toasts = document.getElementById('toasts');
let csrf = '', user = null, introDone = false, reload = () => {};
const ST = { recibido: 'Recibido', diagnostico: 'En diagnóstico', reparacion: 'En reparación', listo: 'Listo para retirar', entregado: 'Entregado', cancelado: 'Cancelado' };
const ROLE = { admin: 'Administrador', tech: 'Técnico', client: 'Cliente' };
const DEV = ['Celular', 'Tablet', 'Laptop', 'Consola', 'Otro'];
const PWPAT = '(?=.*[A-Za-z])(?=.*\\d).{8,72}', PWHINT = 'Entre 8 y 72 caracteres, con al menos una letra y un número.';
const fmt = t => new Date(t).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' });

// Crea elementos con textContent (nunca innerHTML con datos) → sin XSS
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const spinner = () => h('span', { class: 'spinner-border spinner-border-sm d-none', 'aria-hidden': 'true' });
const loader = txt => h('div', { class: 'text-center py-5 text-body-secondary', role: 'status' }, h('div', { class: 'spinner-border text-primary mb-3' }), h('div', {}, txt));
function toast(m, ok = true) {
  const t = h('div', { class: 'toast show align-items-center border-0 text-bg-' + (ok ? 'primary' : 'danger'), role: ok ? 'status' : 'alert' },
    h('div', { class: 'd-flex' }, h('div', { class: 'toast-body fw-semibold' }, m), h('button', { class: 'btn-close me-2 m-auto', type: 'button', 'aria-label': 'Cerrar', onclick: () => t.remove() })));
  toasts.append(t); setTimeout(() => t.remove(), 5500);
}
async function api(path, { method = 'GET', body, form } = {}) {
  const o = { method, headers: {}, credentials: 'same-origin' };
  if (method !== 'GET') o.headers['x-csrf-token'] = csrf;
  if (body) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(body); }
  if (form) o.body = form;
  let r; try { r = await fetch('/api' + path, o); } catch { throw new Error('No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && user) { user = null; location.hash = '#/login'; } throw new Error(d.error || 'Ocurrió un error inesperado.'); }
  return d;
}
async function busy(btn, fn) {
  const sp = btn.querySelector('.spinner-border'); btn.disabled = true; sp && sp.classList.remove('d-none');
  try { return await fn(); } catch (e) { toast(e.message, false); } finally { btn.disabled = false; sp && sp.classList.add('d-none'); }
}
function modal(...kids) {
  const d = h('dialog', { class: 'kt-dialog' }, h('div', { class: 'p-4' }, ...kids)); d.addEventListener('close', () => d.remove());
  document.body.append(d); d.showModal(); return d;
}
function confirmBox(msg) {
  return new Promise(res => {
    let r = false;
    const d = modal(h('h2', { class: 'h5' }, '¿Confirmas esta acción?'), h('p', { class: 'text-body-secondary' }, msg), h('div', { class: 'd-flex justify-content-end gap-2 mt-3' },
      h('button', { class: 'btn btn-outline-secondary', onclick: () => d.close() }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: () => { r = true; d.close(); } }, 'Sí, continuar')));
    d.addEventListener('close', () => res(r));
  });
}
function field(label, name, type = 'text', a = {}) {
  const { options, hint, ...rest } = a, id = 'f-' + name;
  const ctl = type === 'textarea' ? h('textarea', { id, name, class: 'form-control', rows: 4, ...rest })
    : type === 'select' ? h('select', { id, name, class: 'form-select', ...rest }, options.map(([v, t]) => h('option', { value: v }, t)))
    : h('input', { id, name, type, class: 'form-control', ...rest });
  return h('div', { class: 'mb-3' }, h('label', { class: 'form-label fw-semibold', for: id }, label), ctl, hint && h('div', { class: 'form-text' }, hint));
}
function form(fields, text, onSubmit) {
  const btn = h('button', { class: 'btn btn-primary w-100 mt-2 d-flex align-items-center justify-content-center gap-2', type: 'submit' }, spinner(), text);
  const f = h('form', { onsubmit: e => { e.preventDefault(); if (!f.reportValidity()) return; busy(btn, () => onSubmit(Object.fromEntries(new FormData(f)), f)); } }, ...fields, btn);
  return f;
}
const pwFields = cur => [
  ...(cur ? [field('Contraseña actual', 'current', 'password', { required: true, autocomplete: 'current-password' })] : []),
  field(cur ? 'Contraseña nueva' : 'Contraseña', 'password', 'password', { required: true, pattern: PWPAT, title: PWHINT, hint: PWHINT, autocomplete: 'new-password' }),
  field('Repite la contraseña', 'password2', 'password', { required: true, autocomplete: 'new-password' })];
const same = d => { if (d.password !== d.password2) throw new Error('Las contraseñas no coinciden.'); };

// ---------- escena de entrada: lámpara animada que enciende y revela el acceso ----------
const LAMP = `<svg class="lamp-svg" viewBox="0 0 320 440" aria-hidden="true" focusable="false">
<defs><linearGradient id="cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#28AFCB" stop-opacity=".5"/><stop offset="1" stop-color="#28AFCB" stop-opacity="0"/></linearGradient>
<linearGradient id="shade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d4a62"/><stop offset="1" stop-color="#03202c"/></linearGradient></defs>
<g class="litg back"><polygon class="cone" points="95,138 255,138 380,440 -30,440" fill="url(#cone)"/>
<g class="dust"><circle class="d1" cx="140" cy="380" r="2.5"/><circle class="d2" cx="190" cy="400" r="2"/><circle class="d3" cx="230" cy="360" r="3"/><circle class="d4" cx="110" cy="330" r="2"/><circle class="d5" cx="170" cy="350" r="2.5"/><circle class="d6" cx="260" cy="390" r="2"/></g></g>
<ellipse cx="160" cy="418" rx="82" ry="13" fill="#02141c" stroke="#0a6285" stroke-width="2"/>
<path d="M160 412 L112 270 L172 150" fill="none" stroke="#0a4a63" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="112" cy="270" r="9" fill="#0a6285"/>
<path d="M95 138 C95 76 135 48 175 48 C215 48 255 76 255 138 Z" fill="url(#shade)" stroke="#0a6285" stroke-width="2"/>
<ellipse cx="175" cy="138" rx="80" ry="9" fill="#0a4a63"/><circle cx="175" cy="141" r="15" fill="#154457"/>
<g class="litg front"><ellipse cx="175" cy="138" rx="80" ry="9" fill="#28AFCB"/><circle cx="175" cy="141" r="15" fill="#effcff"/><circle cx="205" cy="418" r="4" fill="#FF3D8E"/></g></svg>`;

function buildScene() {
  const lamp = h('div', { class: 'lamp mx-auto' }); lamp.innerHTML = LAMP; // SVG estático, sin datos del usuario
  const card = h('section', { class: 'auth card shadow-lg border-0', 'aria-live': 'polite' }, h('div', { class: 'card-body p-4 p-md-5' }));
  const sc = h('main', { class: 'scene' }, h('div', { class: 'container' }, h('div', { class: 'row align-items-center justify-content-center g-4 g-lg-5' },
    h('div', { class: 'col-6 col-md-4 col-lg-4' }, lamp), h('div', { class: 'col-12 col-md-8 col-lg-5' }, card))));
  const finish = () => {
    if (introDone) return; introDone = true; sc.classList.remove('play'); sc.classList.add('on'); card.inert = false;
    const i = card.querySelector('input'); if (i) i.focus({ preventScroll: true });
  };
  if (introDone || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) { introDone = true; sc.classList.add('on'); }
  else {
    sc.classList.add('play'); card.inert = true;
    setTimeout(() => { card.inert = false; }, 2400); setTimeout(finish, 3400);
    sc.addEventListener('click', finish, { once: true }); // tocar la pantalla salta la animación
  }
  return sc;
}
function pubPage(title, ...kids) {
  let sc = app.querySelector(':scope > .scene');
  if (!sc) { sc = buildScene(); app.replaceChildren(sc); }
  sc.querySelector('.card-body').replaceChildren(h('a', { class: 'brand d-block text-center mb-1', href: '#/login' }, 'Krale', h('b', {}, 'Tech')), h('h1', { class: 'h4 text-center mb-4' }, title), ...kids);
}

// ---------- estructura con sesión ----------
function shell(title, ...kids) {
  const links = user.role === 'client' ? [['#/orders', 'Mis reparaciones'], ['#/new', 'Nueva reparación']]
    : user.role === 'tech' ? [['#/orders', 'Mis trabajos']] : [['#/orders', 'Reparaciones'], ['#/users', 'Usuarios']];
  links.push(['#/account', 'Mi cuenta']);
  const cur = location.hash.split('?')[0];
  app.replaceChildren(
    h('header', { class: 'kt-top sticky-top' }, h('div', { class: 'container d-flex flex-wrap align-items-center gap-2 py-2' },
      h('a', { class: 'brand me-3', href: '#/orders' }, 'Krale', h('b', {}, 'Tech')),
      h('nav', { class: 'nav nav-pills flex-grow-1', 'aria-label': 'Principal' }, links.map(([href, t]) => h('a', { href, class: 'nav-link' + (cur === href ? ' active' : ''), 'aria-current': cur === href ? 'page' : false }, t))),
      h('div', { class: 'd-flex align-items-center gap-2 small text-body-secondary' }, h('span', {}, user.name + ' · ' + ROLE[user.role]), h('button', { class: 'btn btn-outline-primary btn-sm', onclick: logout }, 'Cerrar sesión')))),
    h('main', { class: 'container py-4' }, h('h1', { class: 'h3 mb-4' }, title), ...kids));
}
async function logout() {
  if (!await confirmBox('Se cerrará tu sesión en este dispositivo.')) return;
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) { toast(e.message, false); }
  user = null; csrf = (await api('/me')).csrf; location.hash = '#/login'; toast('Sesión cerrada. ¡Hasta pronto!');
}

// ---------- vistas públicas ----------
function login() {
  pubPage('Inicia sesión', form([
    field('Correo electrónico', 'email', 'email', { required: true, maxlength: 120, autocomplete: 'username' }),
    field('Contraseña', 'password', 'password', { required: true, autocomplete: 'current-password' })], 'Entrar', async d => {
    const r = await api('/auth/login', { method: 'POST', body: d }); csrf = r.csrf; user = r.user;
    toast('¡Bienvenido, ' + user.name + '!'); location.hash = '#/orders';
  }), h('div', { class: 'd-flex justify-content-between flex-wrap gap-2 mt-4 small' }, h('a', { href: '#/forgot' }, '¿Olvidaste tu contraseña?'), h('a', { href: '#/register' }, 'Crear una cuenta')));
}
function register() {
  pubPage('Crea tu cuenta', form([
    field('Nombre completo', 'name', 'text', { required: true, minlength: 2, maxlength: 80, autocomplete: 'name' }),
    field('Correo electrónico', 'email', 'email', { required: true, maxlength: 120, autocomplete: 'email' }), ...pwFields(false)], 'Registrarme', async d => {
    same(d); const r = await api('/auth/register', { method: 'POST', body: d }); csrf = r.csrf; user = r.user;
    toast('Cuenta creada. ¡Bienvenido!'); location.hash = '#/orders';
  }), h('p', { class: 'mt-4 mb-0 small' }, h('a', { href: '#/login' }, 'Ya tengo cuenta')));
}
function forgot() {
  const box = h('div');
  pubPage('Recuperar contraseña', h('p', { class: 'text-body-secondary' }, 'Escribe tu correo y te enviaremos un enlace para crear una contraseña nueva.'), box);
  box.append(form([field('Correo electrónico', 'email', 'email', { required: true, maxlength: 120 })], 'Enviar enlace', async d => {
    await api('/auth/forgot', { method: 'POST', body: d });
    box.replaceChildren(h('div', { class: 'alert alert-info', role: 'status' }, 'Si ese correo está registrado, recibirás un enlace válido por 30 minutos.'), h('a', { class: 'btn btn-primary', href: '#/login' }, 'Volver a iniciar sesión'));
  }), h('p', { class: 'mt-4 mb-0 small' }, h('a', { href: '#/login' }, 'Volver')));
}
function reset() {
  const token = new URLSearchParams(location.hash.split('?')[1] || '').get('token') || '';
  pubPage('Nueva contraseña', form(pwFields(false), 'Guardar contraseña', async d => {
    same(d); await api('/auth/reset', { method: 'POST', body: { token, password: d.password } });
    toast('Contraseña actualizada. Ya puedes iniciar sesión.'); location.hash = '#/login';
  }));
}

// ---------- reparaciones ----------
async function orders() {
  const title = { client: 'Mis reparaciones', tech: 'Mis trabajos', admin: 'Reparaciones' }[user.role];
  shell(title, loader('Cargando reparaciones…'));
  const [{ orders: list }, { users }] = await Promise.all([api('/orders'), user.role === 'admin' ? api('/users') : { users: [] }]);
  const techs = users.filter(u => u.role === 'tech' && u.active);
  let f = 'all'; const box = h('div', { class: 'row g-3' }), chips = h('div', { class: 'd-flex flex-wrap gap-2 mb-4', role: 'group', 'aria-label': 'Filtrar por estado' });
  const draw = () => {
    chips.replaceChildren(...['all', ...Object.keys(ST)].map(k => h('button', { class: 'btn btn-sm rounded-pill ' + (f === k ? 'btn-primary' : 'btn-outline-primary'), 'aria-pressed': f === k, onclick: () => { f = k; draw(); } },
      (k === 'all' ? 'Todas' : ST[k]) + ' (' + (k === 'all' ? list.length : list.filter(o => o.status === k).length) + ')')));
    const v = list.filter(o => f === 'all' || o.status === f);
    box.replaceChildren(...(v.length ? v.map(o => orderCard(o, techs)) : [h('div', { class: 'col-12' }, h('div', { class: 'text-center p-5 border rounded-4 text-body-secondary d-flex flex-column align-items-center gap-3' },
      list.length ? 'No hay reparaciones con este estado.' : user.role === 'client' ? 'Todavía no tienes reparaciones. Registra tu primer equipo.' : 'No hay reparaciones para mostrar.',
      user.role === 'client' && !list.length && h('a', { class: 'btn btn-primary', href: '#/new' }, 'Nueva reparación')))]));
  };
  reload = orders; draw(); shell(title, chips, box);
}
function orderCard(o, techs) {
  const text = o.issue.length > 110 ? o.issue.slice(0, 110) + '…' : o.issue;
  return h('div', { class: 'col-12 col-md-6 col-xl-4' }, h('article', { class: 'card h-100' }, h('div', { class: 'card-body d-flex flex-column gap-2' },
    h('h2', { class: 'h5 mb-0' }, `#${o.id} · ${o.device} ${o.brand}`), h('span', { class: 'badge rounded-pill align-self-start st-' + o.status }, ST[o.status]),
    h('p', { class: 'mb-0 text-body-secondary text-break' }, text),
    h('div', { class: 'small text-body-secondary' }, user.role !== 'client' && `Cliente: ${o.client_name} · `, `Técnico: ${o.tech_name || 'sin asignar'} · ${fmt(o.updated_at)}`),
    h('button', { class: 'btn btn-primary btn-sm mt-auto align-self-start', onclick: () => detail(o, techs) }, 'Ver detalle'))));
}
function detail(o, techs) {
  const row = (t, v) => [h('dt', { class: 'col-4 text-body-secondary fw-normal' }, t), h('dd', { class: 'col-8 text-break' }, v)];
  const parts = [h('h2', { class: 'h5' }, `Reparación #${o.id}`),
    h('dl', { class: 'row mb-2' }, row('Equipo', `${o.device} ${o.brand}`), row('Estado', h('span', { class: 'badge rounded-pill st-' + o.status }, ST[o.status])),
      user.role !== 'client' && row('Cliente', o.client_name), row('Técnico', o.tech_name || 'Sin asignar'), row('Recibido', fmt(o.created_at)), row('Problema', o.issue),
      user.role === 'client' && o.notes && row('Notas del técnico', o.notes)),
    o.hasPhoto && h('img', { class: 'img-fluid rounded border mb-3 kt-photo', src: `/api/orders/${o.id}/photo`, alt: 'Foto del equipo' })];
  let d;
  const done = m => { toast(m); d.close(); reload(); };
  if (user.role !== 'client') {
    const sf = form([
      field('Estado', 'status', 'select', { options: Object.entries(ST) }),
      ...(user.role === 'admin' ? [field('Técnico asignado', 'tech_id', 'select', { options: [['', 'Sin asignar'], ...techs.map(t => [t.id, t.name])] })] : []),
      field('Notas', 'notes', 'textarea', { maxlength: 1000 })], 'Guardar cambios', async v => {
      if (!await confirmBox('Se actualizará esta reparación.')) return;
      const body = { status: v.status, notes: v.notes }; if (user.role === 'admin') body.tech_id = v.tech_id || null;
      await api('/orders/' + o.id, { method: 'PATCH', body }); done('Cambios guardados.');
    });
    sf.elements.status.value = o.status; sf.elements.notes.value = o.notes; if (sf.elements.tech_id) sf.elements.tech_id.value = o.tech_id || '';
    parts.push(sf);
  } else if (o.status === 'recibido') {
    const b = h('button', { class: 'btn btn-outline-danger d-flex align-items-center gap-2', onclick: async () => {
      if (await confirmBox('La reparación se cancelará y no podrás reactivarla.')) busy(b, async () => { await api('/orders/' + o.id, { method: 'PATCH', body: { status: 'cancelado' } }); done('Reparación cancelada.'); });
    } }, spinner(), 'Cancelar reparación');
    parts.push(h('div', { class: 'mt-2' }, b));
  }
  parts.push(h('div', { class: 'd-flex justify-content-end mt-3' }, h('button', { class: 'btn btn-outline-secondary', onclick: () => d.close() }, 'Cerrar')));
  d = modal(...parts);
}
function newOrder() {
  shell('Nueva reparación', h('div', { class: 'card kt-narrow' }, h('div', { class: 'card-body p-4' }, form([
    field('Tipo de equipo', 'device', 'select', { required: true, options: DEV.map(x => [x, x]) }),
    field('Marca y modelo', 'brand', 'text', { required: true, minlength: 2, maxlength: 40, hint: 'Ejemplo: Samsung Galaxy A54' }),
    field('¿Qué le pasa al equipo?', 'issue', 'textarea', { required: true, minlength: 10, maxlength: 1000, hint: 'Cuéntanos con detalle qué falla (mínimo 10 caracteres).' }),
    field('Foto del equipo (opcional)', 'photo', 'file', { accept: 'image/jpeg,image/png', hint: 'JPG o PNG, máximo 2 MB.' })], 'Enviar solicitud', async (d, f) => {
    const file = f.elements.photo.files[0];
    if (file && (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 2 * 1024 * 1024)) throw new Error('La foto debe ser JPG o PNG de hasta 2 MB.');
    await api('/orders', { method: 'POST', form: new FormData(f) }); toast('¡Solicitud enviada! Verás el avance aquí.'); location.hash = '#/orders';
  }))));
}

// ---------- usuarios (admin) ----------
async function users() {
  shell('Usuarios', loader('Cargando usuarios…'));
  const { users: list } = await api('/users');
  const rows = list.map(u => {
    const me = u.id === user.id;
    const sel = h('select', { class: 'form-select form-select-sm w-auto', 'aria-label': 'Rol de ' + u.name, disabled: me, onchange: async () => {
      if (!await confirmBox(`¿Cambiar a ${u.name} a ${ROLE[sel.value]}?`)) { sel.value = u.role; return; }
      try { await api('/users/' + u.id, { method: 'PATCH', body: { role: sel.value } }); toast('Rol actualizado.'); users(); } catch (e) { toast(e.message, false); sel.value = u.role; }
    } }, Object.entries(ROLE).map(([v, t]) => h('option', { value: v }, t)));
    sel.value = u.role;
    const act = h('button', { class: 'btn btn-sm d-inline-flex align-items-center gap-2 ' + (u.active ? 'btn-outline-danger' : 'btn-outline-primary'), disabled: me, onclick: async () => {
      if (await confirmBox(u.active ? `${u.name} ya no podrá iniciar sesión.` : `${u.name} podrá volver a iniciar sesión.`))
        busy(act, async () => { await api('/users/' + u.id, { method: 'PATCH', body: { active: !u.active } }); toast('Usuario actualizado.'); users(); });
    } }, spinner(), u.active ? 'Desactivar' : 'Activar');
    return h('tr', {}, h('td', {}, u.name + (me ? ' (tú)' : '')), h('td', { class: 'text-break' }, u.email), h('td', {}, sel),
      h('td', {}, h('span', { class: 'badge rounded-pill ' + (u.active ? 'st-listo' : 'st-cancelado') }, u.active ? 'Activo' : 'Desactivado')), h('td', {}, act));
  });
  shell('Usuarios', h('p', { class: 'text-body-secondary' }, 'Para crear un técnico: la persona se registra y aquí le cambias el rol a «Técnico».'),
    h('div', { class: 'card' }, h('div', { class: 'table-responsive' }, h('table', { class: 'table table-hover align-middle mb-0' },
      h('thead', {}, h('tr', {}, ['Nombre', 'Correo', 'Rol', 'Estado', 'Acción'].map(t => h('th', { scope: 'col' }, t)))), h('tbody', {}, rows)))));
}

// ---------- cuenta ----------
function account() {
  const row = (t, v) => [h('dt', { class: 'col-4 text-body-secondary fw-normal' }, t), h('dd', { class: 'col-8 text-break' }, v)];
  shell('Mi cuenta', h('div', { class: 'row g-4' },
    h('div', { class: 'col-12 col-lg-5' }, h('div', { class: 'card h-100' }, h('div', { class: 'card-body p-4' }, h('h2', { class: 'h5 mb-3' }, 'Mis datos'),
      h('dl', { class: 'row mb-0' }, row('Nombre', user.name), row('Correo', user.email), row('Rol', ROLE[user.role]))))),
    h('div', { class: 'col-12 col-lg-7' }, h('div', { class: 'card' }, h('div', { class: 'card-body p-4' }, h('h2', { class: 'h5 mb-3' }, 'Cambiar contraseña'),
      form(pwFields(true), 'Cambiar contraseña', async (d, f) => {
        same(d); if (!await confirmBox('Se cerrarán tus otras sesiones abiertas.')) return;
        await api('/auth/change-password', { method: 'POST', body: { current: d.current, password: d.password } }); f.reset(); toast('Contraseña actualizada.');
      }))))));
}

// ---------- router con protección de rutas ----------
const routes = { '/login': login, '/register': register, '/forgot': forgot, '/reset': reset, '/orders': orders, '/new': newOrder, '/users': users, '/account': account };
const PUBLIC = ['/login', '/register', '/forgot', '/reset'], ONLY = { '/new': ['client'], '/users': ['admin'] };
async function nav() {
  const p = location.hash.slice(1).split('?')[0] || '/orders';
  if (!routes[p]) { location.hash = user ? '#/orders' : '#/login'; return; }
  if (!user && !PUBLIC.includes(p)) { location.hash = '#/login'; return; }
  if (user && PUBLIC.includes(p)) { location.hash = '#/orders'; return; }
  if (ONLY[p] && !ONLY[p].includes(user.role)) { toast('No tienes acceso a esa sección.', false); location.hash = '#/orders'; return; }
  try { await routes[p](); app.focus({ preventScroll: true }); } catch (e) { toast(e.message, false); }
}
addEventListener('hashchange', nav);
(async () => { try { const d = await api('/me'); csrf = d.csrf; user = d.user; } catch (e) { toast(e.message, false); } nav(); })();
