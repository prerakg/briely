# Briefly AI contributor instructions

Work in this existing React/Vite repository. Preserve the original lecture workflows and localStorage key `kragle_transcripts`; do not automatically upload the local library. Never expose permanent provider keys through Vite `define`, `VITE_*`, browser storage, or client requests.

## Architecture
- React entry: `index.tsx`. Legacy study app: `App.tsx`, `components/TranscriptView.tsx`, `Recorder.tsx`, document parsers.
- New quiz experience: `components/quiz/`, contracts in `quizTypes.ts`, styling in `quiz.css`.
- Frontend API helpers: `services/api.ts`. `geminiService.ts` is a compatibility adapter to backend AI workflows.
- Backend: `backend/app/main.py` (HTTP boundary), `schemas.py` (validation), `models.py` (SQLAlchemy), `providers.py` (server-only gateway), `agents.py` (actual LangGraph), `quiz_service.py` (deterministic grading), `rooms.py` (authoritative round snapshots), `security.py` (identity and rate limits).
- Versioned API: `/api/v1`. Production uses one origin and can serve `dist/` through FastAPI. Vite proxies `/api` including WebSockets in development.

## Commands (PowerShell, repository root)
- Frontend: `npm ci`, `npm run dev`, `npm run typecheck`, `npm run build`.
- Backend: `.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000`.
- Tests: `.\.venv\Scripts\python.exe -m pytest backend/tests -q`; `npm run test:e2e` (requires `.venv` and installed Playwright Chromium).
- Browser test servers are isolated, use controlled AI fixtures, and refuse to reuse running servers. Normal startup MUST NOT import `backend.tests.e2e_server`.
- Migrations: `.\.venv\Scripts\python.exe -m alembic upgrade head` against a reviewed, explicitly selected database. Never change remote infrastructure or deploy without user authorization.

## Security and review requirements
Keep public quiz contracts explicit; never serialize a question model with answer keys to an unfinished participant. Publish immutable snapshots and grade exact answer sets in backend code. Respect guest cookies, owner filters, deadlines and unique submission constraints. Guest limits are per browser session, not per human. Avoid source text, provider response bodies and credentials in logs. AI verification is a fallible independent source review, not a guarantee of factual truth.

Production requires HTTPS, PostgreSQL and Supabase Auth. RLS denies direct client access to all learning tables; the backend enforces ownership. Use one API worker until a shared rate limiter and load testing are added. Do not claim hosted credentials, live microphone transcription or external providers were verified unless they actually were.

Run checks appropriate to changes; backend tests must never call real AI providers. Update `IMPLEMENTATION_PLAN.md` with completed work, checks, blockers and next steps. Existing folder is a download without `.git`; do not fabricate commits.

Place React.lazy component declarations after imports; a browser test caught Vite development initialization failing with a declaration before the React import. Shared routes must continue to avoid loading PDF/Mermaid bundles until needed.
