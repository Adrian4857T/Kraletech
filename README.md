# KraleTech

1. Neon → SQL Editor → pegar `schema.sql` → Run (opcional: la app crea las tablas sola).
2. Subir esta carpeta (sin node_modules) a un repositorio de GitHub.
3. Render → New → Blueprint → elegir el repositorio. Completar: DATABASE_URL (Neon → Connect), ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL.
4. Abrir la URL https://....onrender.com e iniciar sesión con ADMIN_EMAIL / ADMIN_PASSWORD.

Local: `npm install`, definir DATABASE_URL, `npm start` (http://localhost:3000).
Pruebas: `TEST_DATABASE_URL=postgres://... npm test` (base VACÍA de pruebas; se borran sus datos).
