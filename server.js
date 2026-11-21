const express = require('express'), helmet = require('helmet'), session = require('express-session'),
  rate = require('express-rate-limit'), bcrypt = require('bcryptjs'), crypto = require('crypto'),
  multer = require('multer');
const { q, one, all, init } = require('./db');

const PROD = process.env.NODE_ENV === 'production';
if (PROD && !process.env.SESSION_SECRET) throw new Error('Define SESSION_SECRET en producción.');
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const path = require('path');
const pid = v => { const n = +v; return Number.isSafeInteger(n) && n > 0 && n < 2 ** 31 ? n : 0; };

// ---------- utilidades ----------
class Bad extends Error { constructor(m, s = 400) { super(m); this.status = s; } }
const wrap = f => (q, s, n) => Promise.resolve(f(q, s, n)).catch(n);
const clean = (v, max) => typeof v === 'string'
  ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '';
const need = (v, min, label) => { if (v.length < min) throw new Bad(`${label}: mínimo ${min} caracteres.`); return v; };
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const PW = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;
const PWMSG = 'La contraseña debe tener entre 8 y 72 caracteres, con al menos una letra y un número.';
const STATUS = ['recibido', 'diagnostico', 'reparacion', 'listo', 'entregado', 'cancelado'];
const DEVICES = ['Celular', 'Tablet', 'Laptop', 'Consola', 'Otro'];
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const DUMMY = bcrypt.hashSync('contraseña-falsa-1', 12);

// ---------- sesiones en PostgreSQL ----------
class PgStore extends session.Store {
  constructor() { super(); setInterval(() => q('DELETE FROM sessions WHERE expires<$1', [Date.now()]).catch(() => {}), 36e5).unref(); }
  get(sid, cb) { one('SELECT data FROM sessions WHERE sid=$1 AND expires>$2', [sid, Date.now()]).then(r => cb(null, r ? r.data : null), cb); }
  set(sid, s, cb) { const exp = s.cookie.expires ? new Date(s.cookie.expires).getTime() : Date.now() + 864e5;
    q('INSERT INTO sessions(sid,data,expires) VALUES($1,$2,$3) ON CONFLICT (sid) DO UPDATE SET data=$2,expires=$3', [sid, JSON.stringify(s), exp]).then(() => cb && cb(), e => cb && cb(e)); }
  destroy(sid, cb) { q('DELETE FROM sessions WHERE sid=$1', [sid]).then(() => cb && cb(), e => cb && cb(e)); }
}

// ---------- app y middlewares de seguridad ----------
const app = express();
if (PROD) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  hsts: PROD,
  contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(),
    'script-src': ["'self'"], 'upgrade-insecure-requests': PROD ? [] : null } },
}));
app.get('/healthz', (req, res) => res.type('text').send('ok')); // para el monitor del hosting (sin sesión)
app.use(express.json({ limit: '20kb' }));
app.use(session({ name: 'sid', secret: SECRET, store: new PgStore(), resave: false, saveUninitialized: false, rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 2 * 3600e3 } }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: PROD ? '1h' : 0 }));
app.use('/api', rate({ windowMs: 15 * 60e3, limit: 600, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.' } }));
const authLimit = rate({ windowMs: 15 * 60e3, limit: +process.env.AUTH_LIMIT || 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiados intentos desde tu conexión. Espera 15 minutos.' } });

// CSRF: token de sesión que el frontend envía en la cabecera x-csrf-token
app.use('/api', (req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const t = Buffer.from(req.get('x-csrf-token') || ''), s = Buffer.from(req.session.csrf);
  if (t.length !== s.length || !crypto.timingSafeEqual(t, s))
    return res.status(403).json({ error: 'Tu sesión de seguridad no es válida. Recarga la página e inténtalo otra vez.' });
  next();
});

// RBAC: auth() exige sesión; auth('admin','tech') además restringe por rol
const auth = (...roles) => wrap(async (req, res, next) => {
  const u = req.session.uid && await one('SELECT id,name,email,role,active FROM users WHERE id=$1', [req.session.uid]);
  if (!u || !u.active) return res.status(401).json({ error: 'Tu sesión expiró. Inicia sesión nuevamente.' });
  if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
  req.user = u; next();
});
const pub = u => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const startSession = (req, uid) => new Promise((ok, no) => req.session.regenerate(e => {
  if (e) return no(e); req.session.uid = uid; req.session.csrf = crypto.randomBytes(24).toString('hex'); ok(); }));

// ---------- autenticación ----------
app.get('/api/me', wrap(async (req, res) => {
  const u = req.session.uid && await one('SELECT id,name,email,role,active FROM users WHERE id=$1', [req.session.uid]);
  res.json({ csrf: req.session.csrf, user: u && u.active ? pub(u) : null });
}));

app.post('/api/auth/register', authLimit, wrap(async (req, res) => {
  const name = need(clean(req.body.name, 80), 2, 'Nombre'), email = clean(req.body.email, 120).toLowerCase(), pw = req.body.password;
  if (!EMAIL.test(email)) throw new Bad('Escribe un correo electrónico válido.');
  if (typeof pw !== 'string' || !PW.test(pw)) throw new Bad(PWMSG);
  if (await one('SELECT 1 FROM users WHERE email=$1', [email])) throw new Bad('Ese correo ya está registrado. Prueba iniciar sesión.', 409);
  const hash = await bcrypt.hash(pw, 12);
  const { id } = await one('INSERT INTO users(name,email,hash,role,created_at) VALUES($1,$2,$3,$4,$5) RETURNING id', [name, email, hash, 'client', Date.now()]); // rol siempre "client"
  await startSession(req, id);
  res.status(201).json({ csrf: req.session.csrf, user: pub({ id, name, email, role: 'client' }) });
}));

app.post('/api/auth/login', authLimit, wrap(async (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase(), pw = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';
  const u = await one('SELECT * FROM users WHERE email=$1', [email]), now = Date.now();
  if (u && u.locked_until > now) throw new Bad(`Cuenta bloqueada por demasiados intentos. Inténtalo en ${Math.ceil((u.locked_until - now) / 60000)} min.`, 429);
  const ok = await bcrypt.compare(pw, u ? u.hash : DUMMY);   // tiempo constante aunque el usuario no exista
  if (!u || !ok) {
    if (u) { const f = u.failed + 1; await q('UPDATE users SET failed=$1,locked_until=$2 WHERE id=$3', [f >= 5 ? 0 : f, f >= 5 ? now + 15 * 60e3 : 0, u.id]); }
    throw new Bad('Correo o contraseña incorrectos.', 401);
  }
  if (!u.active) throw new Bad('Tu cuenta está desactivada. Contacta al administrador.', 403);
  await q('UPDATE users SET failed=0,locked_until=0 WHERE id=$1', [u.id]);
  await startSession(req, u.id);
  res.json({ csrf: req.session.csrf, user: pub(u) });
}));

app.post('/api/auth/logout', (req, res) => req.session.destroy(() => { res.clearCookie('sid'); res.json({ ok: true }); }));

app.post('/api/auth/forgot', authLimit, wrap(async (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  const u = EMAIL.test(email) && await one('SELECT id FROM users WHERE email=$1 AND active=1', [email]);
  if (u) {
    const token = crypto.randomBytes(32).toString('hex');
    await q('DELETE FROM resets WHERE user_id=$1', [u.id]);
    await q('INSERT INTO resets VALUES($1,$2,$3)', [sha(token), u.id, Date.now() + 30 * 60e3]);
    // En producción, envía este enlace por correo (SMTP). Por ahora se imprime en el log del servidor.
    console.log(`[RECUPERACIÓN] ${email}: ${process.env.APP_URL || 'http://localhost:' + (process.env.PORT || 3000)}/#/reset?token=${token}`);
  }
  res.json({ ok: true }); // misma respuesta exista o no el correo (evita enumerar usuarios)
}));

app.post('/api/auth/reset', authLimit, wrap(async (req, res) => {
  const { token, password } = req.body;
  if (typeof password !== 'string' || !PW.test(password)) throw new Bad(PWMSG);
  const r = typeof token === 'string' && await one('SELECT * FROM resets WHERE token_hash=$1 AND expires>$2', [sha(token), Date.now()]);
  if (!r) throw new Bad('El enlace no es válido o ya venció. Solicita uno nuevo.');
  await q('UPDATE users SET hash=$1,failed=0,locked_until=0 WHERE id=$2', [await bcrypt.hash(password, 12), r.user_id]);
  await q('DELETE FROM resets WHERE user_id=$1', [r.user_id]);
  await q("DELETE FROM sessions WHERE data->>'uid'=$1", [String(r.user_id)]);
  res.json({ ok: true });
}));

app.post('/api/auth/change-password', auth(), wrap(async (req, res) => {
  const { current, password } = req.body;
  if (typeof password !== 'string' || !PW.test(password)) throw new Bad(PWMSG);
  const u = await one('SELECT hash FROM users WHERE id=$1', [req.user.id]);
  if (typeof current !== 'string' || !(await bcrypt.compare(current, u.hash))) throw new Bad('La contraseña actual no es correcta.');
  await q('UPDATE users SET hash=$1 WHERE id=$2', [await bcrypt.hash(password, 12), req.user.id]);
  await q("DELETE FROM sessions WHERE data->>'uid'=$1 AND sid<>$2", [String(req.user.id), req.sessionID]); // cierra otras sesiones
  res.json({ ok: true });
}));

// ---------- reparaciones ----------
const up = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const imgExt = b => b.length > 8 && (b[0] === 0xff && b[1] === 0xd8 ? 'jpg'
  : b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png' : null); // valida firma real, no solo la extensión
const BASE = `SELECT o.id,o.client_id,o.tech_id,o.device,o.brand,o.issue,o.status,o.notes,o.created_at,o.updated_at,(o.photo_ext IS NOT NULL) AS "hasPhoto",c.name client_name,t.name tech_name
  FROM orders o JOIN users c ON c.id=o.client_id LEFT JOIN users t ON t.id=o.tech_id`;

app.get('/api/orders', auth(), wrap(async (req, res) => {
  const { role, id } = req.user;
  const rows = role === 'admin' ? await all(BASE + ' ORDER BY o.updated_at DESC')
    : await all(BASE + ` WHERE o.${role === 'client' ? 'client_id' : 'tech_id'}=$1 ORDER BY o.updated_at DESC`, [id]);
  res.json({ orders: rows });
}));

app.post('/api/orders', auth('client'), up.single('photo'), wrap(async (req, res) => {
  const device = clean(req.body.device, 20), brand = need(clean(req.body.brand, 40), 2, 'Marca y modelo'), issue = need(clean(req.body.issue, 1000), 10, 'Descripción del problema');
  if (!DEVICES.includes(device)) throw new Bad('Elige un tipo de equipo válido.');
  let photo = null, ext = null;
  if (req.file) { ext = imgExt(req.file.buffer); if (!ext) throw new Bad('La foto debe ser JPG o PNG.'); photo = req.file.buffer; }
  const now = Date.now();
  const { id } = await one('INSERT INTO orders(client_id,device,brand,issue,photo,photo_ext,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id',
    [req.user.id, device, brand, issue, photo, ext, now]);
  res.status(201).json({ id });
}));

const canSee = (u, o) => u.role === 'admin' || (u.role === 'client' ? o.client_id === u.id : o.tech_id === u.id);
app.get('/api/orders/:id/photo', auth(), wrap(async (req, res) => {
  const o = await one('SELECT client_id,tech_id,photo,photo_ext FROM orders WHERE id=$1', [pid(req.params.id)]);
  if (!o || !o.photo || !canSee(req.user, o)) return res.status(404).json({ error: 'Imagen no encontrada.' });
  res.type(o.photo_ext).set('Cache-Control', 'private, max-age=300').send(o.photo);
}));

app.patch('/api/orders/:id', auth(), wrap(async (req, res) => {
  const o = await one('SELECT * FROM orders WHERE id=$1', [pid(req.params.id)]), { role } = req.user;
  if (!o || !canSee(req.user, o)) throw new Bad('Reparación no encontrada.', 404);
  let { status, notes, tech_id } = req.body;
  if (role === 'client') {
    if (status !== 'cancelado' || o.status !== 'recibido') throw new Bad('Solo puedes cancelar una reparación que aún no ha sido atendida.', 403);
    notes = undefined; tech_id = undefined;
  }
  if (status !== undefined && !STATUS.includes(status)) throw new Bad('Estado inválido.');
  if (role !== 'admin') tech_id = undefined;
  if (tech_id !== undefined && tech_id !== null) {
    tech_id = pid(tech_id);
    if (!tech_id || !await one("SELECT 1 FROM users WHERE id=$1 AND role='tech' AND active=1", [tech_id])) throw new Bad('Técnico inválido.');
  }
  await q('UPDATE orders SET status=$1,notes=$2,tech_id=$3,updated_at=$4 WHERE id=$5',
    [status ?? o.status, notes !== undefined ? clean(notes, 1000) : o.notes, tech_id !== undefined ? tech_id : o.tech_id, Date.now(), o.id]);
  res.json({ ok: true });
}));

// ---------- administración de usuarios ----------
app.get('/api/users', auth('admin'), wrap(async (req, res) =>
  res.json({ users: await all('SELECT id,name,email,role,active,created_at FROM users ORDER BY created_at DESC') })));

app.patch('/api/users/:id', auth('admin'), wrap(async (req, res) => {
  const id = pid(req.params.id);
  if (id === req.user.id) throw new Bad('No puedes modificar tu propia cuenta.', 403);
  if (!id || !await one('SELECT 1 FROM users WHERE id=$1', [id])) throw new Bad('Usuario no encontrado.', 404);
  const { role, active } = req.body;
  if (role !== undefined) { if (!['admin', 'tech', 'client'].includes(role)) throw new Bad('Rol inválido.'); await q('UPDATE users SET role=$1 WHERE id=$2', [role, id]); }
  if (active !== undefined) await q('UPDATE users SET active=$1 WHERE id=$2', [active ? 1 : 0, id]);
  res.json({ ok: true });
}));

// ---------- errores ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Recurso no encontrado.' }));
app.use((err, req, res, next) => {
  if (err instanceof Bad) return res.status(err.status).json({ error: err.message });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'La foto supera los 2 MB.' });
  if (err.type === 'entity.parse.failed' || err.name === 'MulterError') return res.status(400).json({ error: 'Los datos enviados no son válidos.' });
  console.error(err); res.status(500).json({ error: 'Ocurrió un error interno. Inténtalo de nuevo en unos minutos.' });
});

// ---------- arranque y administrador inicial ----------
async function seed() {
  if (await one('SELECT 1 FROM users LIMIT 1')) return;
  const email = process.env.ADMIN_EMAIL || 'admin@kraletech.local', pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url') + '1a';
  await q('INSERT INTO users(name,email,hash,role,created_at) VALUES($1,$2,$3,$4,$5)', ['Administrador', email, bcrypt.hashSync(pw, 12), 'admin', Date.now()]);
  console.log(`[ADMIN INICIAL] correo: ${email}  contraseña: ${process.env.ADMIN_PASSWORD ? '(la definida en ADMIN_PASSWORD)' : pw}`);
}
app.ready = init(); app.seed = seed;
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.ready.then(seed).then(() => app.listen(PORT, () => console.log(`KraleTech en http://localhost:${PORT}`)))
    .catch(e => { console.error('No se pudo conectar a la base de datos:', e.message); process.exit(1); });
}
module.exports = app;
