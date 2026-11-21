'use strict';
const app = document.getElementById('app'), toasts = document.getElementById('toasts');
let csrf = '', user = null;
const ST = { recibido: 'Recibido', diagnostico: 'En diagnóstico', reparacion: 'En reparación', listo: 'Listo para retirar', entregado: 'Entregado', cancelado: 'Cancelado' };
const ROLE = { admin: 'Administrador', tech: 'Técnico', client: 'Cliente' };
const DEV = ['Celular', 'Tablet', 'Laptop', 'Consola', 'Otro'];
const PWPAT = '(?=.*[A-Za-z])(?=.*\\d).{8,72}', PWHINT = 'Entre 8 y 72 caracteres, con al menos una letra y un número.';
const fmt = t => new Date(t).toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' });

// Crea elementos con textContent (nunca innerHTML) → sin XSS
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
function toast(m, ok = true) { const t = h('div', { class: 'toast ' + (ok ? 'ok' : 'bad'), role: ok ? 'status' : 'alert' }, m); toasts.append(t); setTimeout(() => t.remove(), 5500); }
async function api(path, { method = 'GET', body, form } = {}) {
  const o = { method, headers: {}, credentials: 'same-origin' };
  if (method !== 'GET') o.headers['x-csrf-token'] = csrf;
  if (body) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(body); }
  if (form) o.body = form;
  let r; try { r = await fetch('/api' + path, o); } catch { throw new Error('No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && user) { user = null; lit = false; location.hash = '#/login'; } throw new Error(d.error || 'Ocurrió un error inesperado.'); }
  return d;
}
async function busy(btn, fn) {
  btn.disabled = true; btn.classList.add('loading');
  try { return await fn(); } catch (e) { toast(e.message, false); } finally { btn.disabled = false; btn.classList.remove('loading'); }
}
function modal(...kids) {
  const d = h('dialog', { class: 'modal' }, ...kids); d.addEventListener('close', () => d.remove());
  document.body.append(d); d.showModal(); return d;
}
function confirmBox(msg) {
  return new Promise(res => {
    let r = false;
    const d = modal(h('h3', {}, '¿Confirmas esta acción?'), h('p', {}, msg), h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: () => d.close() }, 'Cancelar'),
      h('button', { class: 'btn pink', onclick: () => { r = true; d.close(); } }, 'Sí, continuar')));
    d.addEventListener('close', () => res(r));
  });
}
function field(label, name, type = 'text', a = {}) {
  const { options, hint, ...rest } = a, id = 'f-' + name;
  const ctl = type === 'textarea' ? h('textarea', { id, name, ...rest })
    : type === 'select' ? h('select', { id, name, ...rest }, options.map(([v, t]) => h('option', { value: v }, t)))
    : h('input', { id, name, type, placeholder: ' ', ...rest });
  return h('div', { class: 'field' }, h('label', { for: id }, label), ctl, hint && h('small', {}, hint));
}
function form(fields, text, onSubmit) {
  const btn = h('button', { class: 'btn pink', type: 'submit' }, h('span', { class: 'spin' }), text);
  const f = h('form', { onsubmit: e => { e.preventDefault(); if (!f.reportValidity()) return; busy(btn, () => onSubmit(Object.fromEntries(new FormData(f)), f)); } }, ...fields, btn);
  return f;
}
const pwFields = (cur) => [
  ...(cur ? [field('Contraseña actual', 'current', 'password', { required: true, autocomplete: 'current-password' })] : []),
  field(cur ? 'Contraseña nueva' : 'Contraseña', 'password', 'password', { required: true, pattern: PWPAT, title: PWHINT, hint: PWHINT, autocomplete: 'new-password' }),
  field('Repite la contraseña', 'password2', 'password', { required: true, autocomplete: 'new-password' })];
const same = d => { if (d.password !== d.password2) throw new Error('Las contraseñas no coinciden.'); };

// ---------- estructura ----------
let lit = false; // estado de la lámpara: se conserva entre login / registro / recuperar
const LAMP = `<svg class="lamp-svg" viewBox="0 0 320 440" aria-hidden="true" focusable="false">
<defs><linearGradient id="cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#28AFCB" stop-opacity=".5"/><stop offset="1" stop-color="#28AFCB" stop-opacity="0"/></linearGradient>
<linearGradient id="shade" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0d4a62"/><stop offset="1" stop-color="#03202c"/></linearGradient></defs>
<polygon class="cone" points="95,138 255,138 380,440 -30,440" fill="url(#cone)"/>
<ellipse cx="160" cy="418" rx="82" ry="13" fill="#02141c" stroke="#0a6285" stroke-width="2"/>
<path d="M160 412 L112 270 L172 150" fill="none" stroke="#0a4a63" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="112" cy="270" r="9" fill="#0a6285"/>
<g class="cord" role="button" tabindex="0" aria-label="Jalar la cuerda para encender o apagar la luz" aria-pressed="false">
<rect x="212" y="120" width="46" height="170" fill="transparent"/><line x1="235" y1="70" x2="235" y2="214" stroke="#28AFCB" stroke-width="3"/><circle class="bead" cx="235" cy="224" r="12" fill="#FF3D8E"/></g>
<path d="M95 138 C95 76 135 48 175 48 C215 48 255 76 255 138 Z" fill="url(#shade)" stroke="#0a6285" stroke-width="2"/>
<ellipse class="rim" cx="175" cy="138" rx="80" ry="9"/>
<circle class="bulb" cx="175" cy="141" r="15"/></svg>`;

function buildScene() {
  const lamp = h('div', { class: 'lamp' }), hint = h('p', { class: 'hint' }), btn = h('button', { class: 'btn ghost sm', type: 'button' });
  lamp.innerHTML = LAMP; // SVG estático, sin datos del usuario
  lamp.append(hint, btn);
  const card = h('section', { class: 'auth', 'aria-live': 'polite' }), sc = h('div', { class: 'scene', role: 'main' }, lamp, card);
  const cord = lamp.querySelector('.cord');
  const set = (v, focus) => {
    lit = v; sc.classList.toggle('on', v); card.inert = !v; cord.setAttribute('aria-pressed', v);
    btn.textContent = v ? 'Apagar la luz' : 'Encender la luz';
    hint.textContent = v ? '' : 'Jala la cuerda rosa para encender la luz';
    if (v && focus) { const i = card.querySelector('input'); if (i) i.focus({ preventScroll: true }); }
  };
  const tug = () => { cord.classList.add('tug'); setTimeout(() => cord.classList.remove('tug'), 220); set(!lit, true); };
  let y0 = null, dy = 0;
  cord.addEventListener('pointerdown', e => { y0 = e.clientY; dy = 0; cord.classList.add('drag'); cord.setPointerCapture && cord.setPointerCapture(e.pointerId); });
  cord.addEventListener('pointermove', e => { if (y0 == null) return; dy = Math.max(0, Math.min(40, e.clientY - y0)); cord.style.transform = `translateY(${dy}px)`; });
  cord.addEventListener('pointerup', () => { if (y0 == null) return; const m = dy; y0 = null; cord.classList.remove('drag'); cord.style.transform = ''; if (m > 14 || m < 4) set(!lit, true); });
  cord.addEventListener('pointercancel', () => { y0 = null; cord.classList.remove('drag'); cord.style.transform = ''; });
  cord.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tug(); } });
  btn.addEventListener('click', tug);
  set(lit, false); return sc;
}
function pubPage(title, ...kids) {
  let sc = app.querySelector(':scope > .scene');
  if (!sc) { sc = buildScene(); app.replaceChildren(sc); }
  sc.querySelector('.auth').replaceChildren(h('a', { class: 'brand', href: '#/login' }, 'Krale', h('b', {}, 'Tech')), h('h1', {}, title), ...kids);
}
function shell(title, ...kids) {
  const links = user.role === 'client' ? [['#/orders', 'Mis reparaciones'], ['#/new', 'Nueva reparación']]
    : user.role === 'tech' ? [['#/orders', 'Mis trabajos']] : [['#/orders', 'Reparaciones'], ['#/users', 'Usuarios']];
  links.push(['#/account', 'Mi cuenta']);
  const cur = location.hash.split('?')[0];
  app.replaceChildren(
    h('header', { class: 'top' }, h('a', { class: 'brand', href: '#/orders' }, 'Krale', h('b', {}, 'Tech')),
      h('nav', { 'aria-label': 'Principal' }, links.map(([href, t]) => h('a', { href, class: cur === href ? 'on' : '', 'aria-current': cur === href ? 'page' : false }, t))),
      h('div', { class: 'who' }, h('span', {}, user.name + ' · ' + ROLE[user.role]), h('button', { class: 'btn ghost sm', onclick: logout }, 'Cerrar sesión'))),
    h('main', {}, h('h1', {}, title), ...kids));
}
async function logout() {
  if (!await confirmBox('Se cerrará tu sesión en este dispositivo.')) return;
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) { toast(e.message, false); }
  user = null; lit = false; csrf = (await api('/me')).csrf; location.hash = '#/login'; toast('Sesión cerrada. ¡Hasta pronto!');
}

// ---------- vistas públicas ----------
function login() {
  pubPage('Inicia sesión', form([
    field('Correo electrónico', 'email', 'email', { required: true, maxlength: 120, autocomplete: 'username' }),
    field('Contraseña', 'password', 'password', { required: true, autocomplete: 'current-password' })], 'Entrar', async d => {
    const r = await api('/auth/login', { method: 'POST', body: d }); csrf = r.csrf; user = r.user;
    toast('¡Bienvenido, ' + user.name + '!'); location.hash = '#/orders';
  }), h('p', { class: 'links' }, h('a', { href: '#/forgot' }, '¿Olvidaste tu contraseña?'), h('a', { href: '#/register' }, 'Crear una cuenta')));
}
function register() {
  pubPage('Crea tu cuenta', form([
    field('Nombre completo', 'name', 'text', { required: true, minlength: 2, maxlength: 80, autocomplete: 'name' }),
    field('Correo electrónico', 'email', 'email', { required: true, maxlength: 120, autocomplete: 'email' }), ...pwFields(false)], 'Registrarme', async d => {
    same(d); const r = await api('/auth/register', { method: 'POST', body: d }); csrf = r.csrf; user = r.user;
    toast('Cuenta creada. ¡Bienvenido!'); location.hash = '#/orders';
  }), h('p', { class: 'links' }, h('a', { href: '#/login' }, 'Ya tengo cuenta')));
}
function forgot() {
  const box = h('div');
  pubPage('Recuperar contraseña', h('p', {}, 'Escribe tu correo y te enviaremos un enlace para crear una contraseña nueva.'), box);
  box.append(form([field('Correo electrónico', 'email', 'email', { required: true, maxlength: 120 })], 'Enviar enlace', async d => {
    await api('/auth/forgot', { method: 'POST', body: d });
    box.replaceChildren(h('p', { role: 'status' }, 'Si ese correo está registrado, recibirás un enlace válido por 30 minutos.'), h('a', { class: 'btn cyan', href: '#/login' }, 'Volver a iniciar sesión'));
  }), h('p', { class: 'links' }, h('a', { href: '#/login' }, 'Volver')));
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
  shell({ client: 'Mis reparaciones', tech: 'Mis trabajos', admin: 'Reparaciones' }[user.role], h('div', { class: 'loader', role: 'status' }, 'Cargando reparaciones…'));
  const [{ orders: list }, { users }] = await Promise.all([api('/orders'), user.role === 'admin' ? api('/users') : { users: [] }]);
  const techs = users.filter(u => u.role === 'tech' && u.active);
  let f = 'all'; const box = h('div', { class: 'grid' }), chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrar por estado' });
  const draw = () => {
    chips.replaceChildren(...['all', ...Object.keys(ST)].map(k => h('button', { class: 'chip' + (f === k ? ' on' : ''), 'aria-pressed': f === k, onclick: () => { f = k; draw(); } },
      (k === 'all' ? 'Todas' : ST[k]) + ' (' + (k === 'all' ? list.length : list.filter(o => o.status === k).length) + ')')));
    const v = list.filter(o => f === 'all' || o.status === f);
    box.replaceChildren(...(v.length ? v.map(o => card(o, techs)) : [h('div', { class: 'empty' },
      list.length ? 'No hay reparaciones con este estado.' : user.role === 'client' ? 'Todavía no tienes reparaciones. Registra tu primer equipo.' : 'No hay reparaciones para mostrar.',
      user.role === 'client' && !list.length && h('a', { class: 'btn pink', href: '#/new' }, 'Nueva reparación'))]));
  };
  const redraw = orders; card.refresh = redraw; draw();
  shell({ client: 'Mis reparaciones', tech: 'Mis trabajos', admin: 'Reparaciones' }[user.role], chips, box);
}
function card(o, techs) {
  return h('article', { class: 'card' },
    h('h2', {}, `#${o.id} · ${o.device} ${o.brand}`), h('span', { class: 'badge s-' + o.status }, ST[o.status]),
    h('p', {}, o.issue.length > 110 ? o.issue.slice(0, 110) + '…' : o.issue),
    h('div', { class: 'meta' }, user.role !== 'client' && `Cliente: ${o.client_name} · `, `Técnico: ${o.tech_name || 'sin asignar'} · ${fmt(o.updated_at)}`),
    h('button', { class: 'btn cyan sm', onclick: () => detail(o, techs) }, 'Ver detalle'));
}
function detail(o, techs) {
  const parts = [h('h3', {}, `Reparación #${o.id}`),
    h('dl', {}, h('dt', {}, 'Equipo'), h('dd', {}, `${o.device} ${o.brand}`), h('dt', {}, 'Estado'), h('dd', {}, ST[o.status]),
      user.role !== 'client' && [h('dt', {}, 'Cliente'), h('dd', {}, o.client_name)], h('dt', {}, 'Técnico'), h('dd', {}, o.tech_name || 'Sin asignar'),
      h('dt', {}, 'Recibido'), h('dd', {}, fmt(o.created_at)), h('dt', {}, 'Problema'), h('dd', {}, o.issue),
      user.role === 'client' && o.notes && [h('dt', {}, 'Notas del técnico'), h('dd', {}, o.notes)]),
    o.hasPhoto && h('img', { class: 'photo', src: `/api/orders/${o.id}/photo`, alt: 'Foto del equipo' })];
  let d;
  const done = m => { toast(m); d.close(); card.refresh(); };
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
    const b = h('button', { class: 'btn danger', onclick: async () => {
      if (await confirmBox('La reparación se cancelará y no podrás reactivarla.')) busy(b, async () => { await api('/orders/' + o.id, { method: 'PATCH', body: { status: 'cancelado' } }); done('Reparación cancelada.'); });
    } }, h('span', { class: 'spin' }), 'Cancelar reparación');
    parts.push(h('div', { class: 'row' }, b));
  }
  parts.push(h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: () => d.close() }, 'Cerrar')));
  d = modal(...parts);
}
function newOrder() {
  shell('Nueva reparación', h('div', { class: 'panel' }, form([
    field('Tipo de equipo', 'device', 'select', { required: true, options: DEV.map(x => [x, x]) }),
    field('Marca y modelo', 'brand', 'text', { required: true, minlength: 2, maxlength: 40, hint: 'Ejemplo: Samsung Galaxy A54' }),
    field('¿Qué le pasa al equipo?', 'issue', 'textarea', { required: true, minlength: 10, maxlength: 1000, hint: 'Cuéntanos con detalle qué falla (mínimo 10 caracteres).' }),
    field('Foto del equipo (opcional)', 'photo', 'file', { accept: 'image/jpeg,image/png', hint: 'JPG o PNG, máximo 2 MB.' })], 'Enviar solicitud', async (d, f) => {
    const file = f.elements.photo.files[0];
    if (file && (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 2 * 1024 * 1024)) throw new Error('La foto debe ser JPG o PNG de hasta 2 MB.');
    await api('/orders', { method: 'POST', form: new FormData(f) }); toast('¡Solicitud enviada! Te avisaremos del avance aquí.'); location.hash = '#/orders';
  })));
}

// ---------- usuarios (admin) ----------
async function users() {
  shell('Usuarios', h('div', { class: 'loader', role: 'status' }, 'Cargando usuarios…'));
  const { users: list } = await api('/users');
  const rows = list.map(u => {
    const me = u.id === user.id;
    const sel = h('select', { 'aria-label': 'Rol de ' + u.name, disabled: me, onchange: async () => {
      if (!await confirmBox(`¿Cambiar a ${u.name} a ${ROLE[sel.value]}?`)) { sel.value = u.role; return; }
      try { await api('/users/' + u.id, { method: 'PATCH', body: { role: sel.value } }); toast('Rol actualizado.'); users(); } catch (e) { toast(e.message, false); sel.value = u.role; }
    } }, Object.entries(ROLE).map(([v, t]) => h('option', { value: v }, t)));
    sel.value = u.role;
    const act = h('button', { class: 'btn sm ' + (u.active ? 'danger' : 'cyan'), disabled: me, onclick: async () => {
      if (await confirmBox(u.active ? `${u.name} ya no podrá iniciar sesión.` : `${u.name} podrá volver a iniciar sesión.`))
        busy(act, async () => { await api('/users/' + u.id, { method: 'PATCH', body: { active: !u.active } }); toast('Usuario actualizado.'); users(); });
    } }, u.active ? 'Desactivar' : 'Activar');
    return h('tr', {}, h('td', {}, u.name + (me ? ' (tú)' : '')), h('td', {}, u.email), h('td', {}, sel), h('td', {}, u.active ? 'Activo' : 'Desactivado'), h('td', {}, act));
  });
  shell('Usuarios', h('p', {}, 'Para crear un técnico: la persona se registra y aquí le cambias el rol a «Técnico».'),
    h('div', { class: 'tbl' }, h('table', {}, h('thead', {}, h('tr', {}, ['Nombre', 'Correo', 'Rol', 'Estado', 'Acción'].map(t => h('th', { scope: 'col' }, t)))), h('tbody', {}, rows))));
}

// ---------- cuenta ----------
function account() {
  shell('Mi cuenta', h('div', { class: 'panel' }, h('dl', {}, h('dt', {}, 'Nombre'), h('dd', {}, user.name), h('dt', {}, 'Correo'), h('dd', {}, user.email), h('dt', {}, 'Rol'), h('dd', {}, ROLE[user.role]))),
    h('div', { class: 'panel' }, h('h3', {}, 'Cambiar contraseña'), form(pwFields(true), 'Cambiar contraseña', async (d, f) => {
      same(d); if (!await confirmBox('Se cerrarán tus otras sesiones abiertas.')) return;
      await api('/auth/change-password', { method: 'POST', body: { current: d.current, password: d.password } }); f.reset(); toast('Contraseña actualizada.');
    })));
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
