-- KraleTech · esquema de base de datos (PostgreSQL / Neon)
-- Pégalo en Neon → SQL Editor → Run. Es seguro ejecutarlo varias veces (no borra datos).
-- La app también lo ejecuta sola al arrancar. El administrador se crea desde las
-- variables ADMIN_EMAIL / ADMIN_PASSWORD (no se guardan contraseñas en este archivo).

CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client' CHECK(role IN('admin','tech','client')),
  active INTEGER NOT NULL DEFAULT 1, failed INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT NOT NULL DEFAULT 0, created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS resets(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS orders(
  id SERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES users(id),
  tech_id INTEGER REFERENCES users(id), device TEXT NOT NULL, brand TEXT NOT NULL, issue TEXT NOT NULL,
  photo BYTEA, photo_ext TEXT, status TEXT NOT NULL DEFAULT 'recibido'
    CHECK(status IN('recibido','diagnostico','reparacion','listo','entregado','cancelado')),
  notes TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_tech ON orders(tech_id);
CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY, data JSONB NOT NULL, expires BIGINT NOT NULL);
