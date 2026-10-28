# Deployment guide (not deployed)

No remote project, billing configuration or hosted database has been changed. Obtain explicit authorization before deployment or applying hosted migrations.

Recommended topology: one HTTPS origin serving the Vite build, API and WebSockets. Build `dist/`, then run `uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --workers 1`. FastAPI serves static files and falls back to the SPA for `/quiz/...` and `/battle/...`. Configure a reverse proxy to forward `/api/v1/quiz-rooms/.../events` WebSocket upgrades and keep connections open. Use your host's assigned port when necessary.

Set `APP_ENV=production`, `FRONTEND_URL=https://your-domain.example`, a PostgreSQL `DATABASE_URL`, and Supabase Auth URL/anon key. Add server-only AI keys and current model IDs. Production startup refuses missing auth, SQLite and non-HTTPS frontend configuration. Apply `alembic upgrade head` to the explicitly approved empty/new production database before starting. Use reviewed backup/migration procedures for an existing database.

`Dockerfile` provides a multi-stage build. Supply configuration at runtime; `.dockerignore` excludes environment files, local databases, test artifacts and dependencies. Do not put keys into build args or the Vite environment. Verify [provider account quotas](https://console.groq.com/docs/rate-limits), email confirmation, HTTPS cookies, origin checks and PostgreSQL grants before inviting users.

The frontend and backend must share an origin under this setup. A static-only host needs `/api` reverse proxying and WebSocket support plus SPA rewrites; pointing it at an inaccessible localhost API will not work. `npm run preview` serves static assets only and is not the full-stack deployment command.

Remaining production hardening: use a shared rate limiter before multiple workers, add provider/database operational monitoring, move legacy Tailwind CDN styling to compiled assets for a restrictive CSP, validate PostgreSQL behavior against a real staging database, and load-test large histories and rooms. Back up the database and audit access before launch. Live external AI, Supabase, OCR, RapidAPI and microphone checks require actual configured services and were not represented by test fixtures as production successes.
