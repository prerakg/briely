# Database and authentication

SQLite is the zero-service local default. Production uses PostgreSQL, including Supabase-hosted PostgreSQL through a backend connection string such as `postgresql+psycopg://...`. The pinned psycopg driver is installed with the backend. Alembic's initial migration is in `backend/migrations/versions/`.

Tables: `browser_sessions`, `study_materials`, `study_material_chunks`, `quizzes`, `quiz_versions`, `quiz_attempts`, `quiz_rooms`, `quiz_room_participants`, `quiz_room_answers`, `agent_runs`, `study_plans`. UUIDs identify domain rows. Separate snapshot JSON preserves question keys/settings exactly for historical attempts. Foreign keys, ownership indexes, unique share IDs, unique room membership and unique participant/round answers enforce core invariants.

For Supabase, configure `SUPABASE_URL` and `SUPABASE_ANON_KEY` on the backend. Login/signup/refresh use Supabase Auth; sensitive creator operations validate access tokens through the Auth user endpoint. Supabase must allow your desired email/password signup settings and email confirmation flow. New accounts can be created in AI Settings. Email confirmation behavior depends on the project's settings. The implementation does not need a service-role key. See [Supabase JWT documentation](https://supabase.com/docs/guides/auth/jwts).

The application tables are backend-only. The PostgreSQL migration enables RLS and revokes table access from PUBLIC and from Supabase anon/authenticated roles when present. No public read policies are created, including for published quizzes. The backend uses a dedicated secure database connection with appropriate table-owner privileges and enforces ownership in its API. Do not give its database password to a browser or configure a browser to query answer tables directly. This private-by-default approach is intentional; public participation is mediated by scoped APIs. Consult [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api) before changing grants.

Local development creates a random, HttpOnly browser identity with a hashed server record and 30-day lifetime. It is not a registered account. Clearing cookies loses access to that local creator identity; study material stored in localStorage remains separate. Use Supabase for durable cross-device creator access. Guest cookies are separate from creator authentication, opaque and scoped to attempts/room membership.

The Cloud Library uploads only a selected title and source text when the user clicks Save. Sources and chunks are owner-filtered. No automatic local-to-cloud migration occurs. Generated private notes are not silently bulk-uploaded. Semantic embeddings/pgvector are not enabled; owned lexical retrieval is implemented.

Optional local PostgreSQL:

```powershell
docker compose up -d db
# Set DATABASE_URL=postgresql+psycopg://briefly:briefly_local_only@localhost:5432/briefly
.\.venv\Scripts\python.exe -m alembic upgrade head
```

The Compose password is exclusively for isolated development. Back up production data before schema changes. Do not run migration downgrades or destructive database operations without explicit authorization.
