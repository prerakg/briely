# Local backend setup

Requirements: Python 3.11+ (verified with 3.12), Node.js 22+, npm. Run commands from the repository root.

## PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm ci
# If .env does not already exist:
Copy-Item .env.example .env
```

Edit `.env` with a Groq key and optionally Gemini fallback. Do not overwrite an existing environment file. Backend settings also read the existing `.env.local`; `.env` takes precedence and process environment overrides both. The frontend does not read private keys.

For a new database, initialize migrations:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
```

Development startup also creates missing tables for convenience. If an existing development database was auto-created without migration history, inspect its schema before using `alembic stamp head`; never blindly stamp a different schema. Migration commands against a hosted database require explicit approval.

Start two terminals:

```powershell
# Terminal 1
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
# Terminal 2
npm run dev
```

Open http://localhost:3000. API documentation: http://127.0.0.1:8000/docs. No API key is necessary to write a manual quiz, publish it, take it or run a battle. AI generation requires a configured provider. Real microphone transcription and image OCR require Gemini. Multilingual YouTube import requires the existing RapidAPI subtitle service.

On macOS/Linux use `.venv/bin/python` in place of `.venv\Scripts\python.exe`. To use `npm run backend` or `npm run test:backend`, activate the virtual environment first; those convenience commands use the active `python`.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest backend/tests -q
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

The Playwright configuration starts isolated fixture servers and needs ports 3100/8100 free. It does not call real AI services or reuse running user servers. On Linux set its Python command to `.venv/bin/python` (or use `BRIEFLY_TEST_PYTHON`). The test database is disposable. Normal startup never enables fixture AI.

For two real LAN devices, set `FRONTEND_URL` to the computer's reachable LAN origin, bind both dev servers to reachable interfaces as needed, and ensure firewall access. A localhost link only works on the same computer. HTTPS is required for microphone access outside localhost. For deployment use the single-origin setup in deployment.md.
