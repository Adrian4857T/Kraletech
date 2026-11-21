const pg = require('pg');
pg.types.setTypeParser(20, Number); // BIGINT -> number
if (!process.env.DATABASE_URL) { console.error('Falta DATABASE_URL (cadena de conexión de Neon).'); process.exit(1); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 30000 });
pool.on('error', e => console.error('Error de conexión BD:', e.message));
const q = (text, params = []) => pool.query(text, params);
const one = async (t, p) => (await q(t, p)).rows[0];
const all = async (t, p) => (await q(t, p)).rows;
const init = () => q(require('fs').readFileSync(require('path').join(__dirname, 'schema.sql'), 'utf8'));
module.exports = { q, one, all, init, pool };
