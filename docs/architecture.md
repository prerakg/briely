# Architecture

Briefly AI 2.0 extends the original React 19 / TypeScript / Vite app. Existing document parsers, lecture navigation, search, themes, flashcards, notes, practice quiz UI, recording and JSON library exchange remain in place. The same `kragle_transcripts` storage key is used; legacy rows without sessions/chunks are normalized only in memory. Import validates every row before writing. No library is uploaded automatically.

## Boundaries

Browser → same-origin `/api/v1` → FastAPI → validated domain operations → SQLAlchemy / SQLite locally, PostgreSQL in production. Creator operations require a local development browser identity or a Supabase access token checked against `/auth/v1/user`. Supabase login, signup and refresh use HttpOnly cookies. Production refuses local identity mode and requires HTTPS and PostgreSQL.

The backend owns permanent provider keys, published snapshots, guest identity, attempts, grading, analytics, room state and opt-in source persistence. The browser parses text-based documents locally. Image OCR and YouTube subtitle requests use authenticated backend adapters. Live audio retains the Gemini browser SDK using a one-use, short-lived, model-constrained token provisioned by the backend.

## Actual LangGraph

The typed state graph executes orchestrator → retrieval → one task agent → independent verification → END. Agents have distinct responsibilities:

| Agent | Behavior |
|---|---|
| Orchestrator | Selects the task path, carries authenticated ownership and limits recursion to 12 steps. |
| Retrieval | Builds overlapping source chunks; ranks tutor evidence lexically or samples distributed sections for whole-source tasks. |
| Content intelligence | Produces validated summaries, flashcards, topic boundaries, Markdown notes or Mermaid graphs. |
| Quiz generation | Produces Pydantic-validated questions, exact source quotes and complete requested question counts. |
| Verification | Makes a separate AI request to audit candidate answers and claims against evidence; rejects failed verdicts. |
| Tutor | Answers from retrieved source sections and cites their section numbers. |
| Planner | Uses real quiz statistics to produce a revision schedule; stores accepted plans by owner. |

The task paths invoke only necessary agents. Quiz generation requires two AI completions, plus retries only on appropriate provider failures. Objective scores never invoke an AI model. Workflow history stores step metadata, status and aggregate usage; it does not store original private source text.

Retrieval is lexical, not embedding/pgvector retrieval. Large inputs are bounded (250k source characters) and up to eight bounded distributed passages enter a generation prompt. Coverage is therefore sampled for long documents; a verified result is checked against selected evidence, not every possible source passage. There is no cross-user document index. The optional backend library has owned source rows and chunks with owner checks before retrieval. Semantic embeddings are not enabled.

## Persistence design

Separate tables represent source documents/chunks, draft quizzes, immutable published versions, attempts, rooms, participants, round answers, runs and plans. Question arrays and settings belong to the immutable JSON snapshot, keeping grading tied to exactly the version the guest received. Quiz editing never mutates a published snapshot. PostgreSQL RLS and revoked Data API grants deny direct browser table access; all public data goes through explicit sanitized API serializers.

## Operational constraints

Use one process/worker. SQLite and the built-in rate limiter support local/small-instance operation; the limiter is process-local. PostgreSQL row locks and unique constraints protect published actions, but multi-instance deployment needs a shared limiter, load testing and operational monitoring. WebSockets send current database state once per second; round timing and scoring remain server authoritative. Room state can resume after an API restart while the database remains intact.

Production static assets are served by FastAPI, with direct `/quiz/:shareId` and `/battle/:code` fallback routes. All generated/imported Markdown is sanitized with DOMPurify, and Mermaid uses strict mode. The original Tailwind CDN setup remains; new quiz screens have their own bundled CSS. A strict CSP and locally compiled Tailwind are future hardening work.
