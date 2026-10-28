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

Start the app in one terminal:

```powershell
npm run dev
```

Open http://localhost:3000. API documentation: http://127.0.0.1:8000/docs. No API key is necessary to write a manual quiz, publish it, take it or run a battle. AI generation requires a configured provider. Real microphone transcription and image OCR require Gemini. Multilingual YouTube import requires the existing RapidAPI subtitle service.

`npm run dev` selects the project's `.venv` Python, starts the real API on port 8000, waits for its health check, then starts Vite on port 3000. Stop an older frontend-only Vite process before switching to this command. Ctrl+C stops both services. Missing Python/dependencies or an occupied port produce a startup error; Vite does not silently switch ports. Restart after changing backend code or environment settings.

On macOS/Linux:

```sh
python3.12 -m venv .venv # Any installed Python 3.11+ works.
.venv/bin/python -m pip install -r backend/requirements.txt
npm ci
npm run dev
```

`npm run backend` and `npm run test:backend` also select `.venv` automatically. Set `BRIEFLY_PYTHON` to an alternative Python executable if needed. To manage the servers separately, run `npm run backend` in one terminal and `npm run dev:frontend` in another. `dev:frontend` uses `BRIEFLY_API_PROXY_TARGET` when provided and otherwise proxies to port 8000. An `ECONNREFUSED 127.0.0.1:8000` error means the API process is absent or failed to start; check its terminal rather than changing provider credentials in frontend code.

YouTube accepts watch, youtu.be, Shorts, live and embed URLs. A video needs available captions; the API reports missing captions, denied provider access, quota limits and timeouts separately. Optional title lookup has a four-second timeout and falls back to the video ID. Provider credentials stay on the backend.

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
