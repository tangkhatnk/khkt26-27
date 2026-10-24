# Deploy Viễn Du to Railway

The root Dockerfile builds the Vite web app and Fastify API into one service. Railway can detect this Dockerfile at the repository root without a Config-as-code file. The API serves the built web files, binds to `PORT` on `0.0.0.0`, and exposes `/health`. The image runs database migrations and seeds the topic bank before starting the API.

`railway.json` is retained for compatibility with existing Railway Config-as-code projects. Do not rely on Railway applying it to a new service: the [current Railway infrastructure-as-code guide](https://docs.railway.com/infrastructure-as-code) says new services cannot opt in, and legacy `railway.json` support ends December 1, 2026. Use the dashboard settings below for a new service.

## Create the backing services

In the same Railway project, create PostgreSQL and Redis services. In the Viễn Du service's variables, add references to their connection URLs. For services named `Postgres` and `Redis`, the references are:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
```

Use the actual service names if yours differ. These are private service references; keep the connection values in Railway variables and do not add them to `VITE_` variables.

Generate a unique JWT secret locally, then add its output to the Viễn Du service's secret variables as `JWT_SECRET`:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

The launcher requires a PostgreSQL `DATABASE_URL`, a `redis://` or `rediss://` `REDIS_URL`, and a `JWT_SECRET` of at least 32 characters. If any is missing or invalid, startup stops with a configuration error. Production never starts PGlite or creates a local JWT secret.

Admin access is denied by default. Set `ADMIN_USER_IDS` in the backend service variables to comma-separated account UUIDs from `users.id` to establish protected bootstrap/recovery administrators. Keep this variable server-side; never expose it through `VITE_` or account registration. Bootstrap accounts cannot be modified through the admin panel. Administrators can grant persistent database roles to other accounts; removing an ID from this variable does not revoke a separate persistent grant. The API checks current role, suspension/deletion state, and token version on every authenticated request.

Account management requires `20261024120000_admin_account_management` and `20261024130000_admin_account_recovery`. The normal image startup applies pending migrations with `prisma migrate deploy` before starting the API. They add persistent grants, account state/version fields, a mutation lock, and append-only audit history. The panel supports display-name edits, roles, suspension/restore, and recoverable deletion. Deletion keeps study history while revoking admin access and login sessions; restoration requires fresh login and does not restore a revoked role. Bootstrap variables remain the recovery path if all persistent administrators become unavailable.

## Configure and deploy the service

Set Railway's **Root Directory** to `/` so the service builds from the repository root. Railway should detect the root `Dockerfile`; clear any custom **Build Command** and **Start Command** left by a frontend-only deployment. In particular, remove `npm ci --include=dev && npm run build:web` and `npm run preview -- --host 0.0.0.0 --port $PORT`; those commands bypass the image's API server. With the overrides cleared, Railway builds the Dockerfile and uses its `npm start` command.

In the service's **Variables**, set `PORT=8080` to match the existing domain configuration. Under **Deploy** settings, set the health check path to `/health`, the timeout to `300` seconds, the restart policy to `ON_FAILURE`, and maximum retries to `10`.

The Docker build leaves `VITE_API_URL` blank by default so the web app calls the API on the same origin. If you host the web app separately, set the Railway build variable `VITE_API_URL` to `https://YOUR-API-DOMAIN/api/v1` and rebuild. This value is public and embedded in the web bundle; never put secrets in a `VITE_` variable.

The launcher sets `HOST=0.0.0.0`, `NODE_ENV=production`, and `WEB_DIST_DIR=dist`; it uses the configured `PORT`. `STORAGE_DRIVER=disabled` is the default for this deployment, so document parsing stays in the browser and no S3 bucket or credentials are required. If you explicitly configure another storage driver, the launcher preserves it.

Optionally add `GEMINI_API_KEY` as a secret variable on the Viễn Du service to enable AI-generated quizzes. Keep it server-side; never set it as `VITE_GEMINI_API_KEY`. Without it, study sessions still work, but AI questions are unavailable; the app does not substitute a static question bank.

Handwritten PDF/image transcription uses `GEMINI_READING_MODEL` (default `gemini-3.5-flash-lite`) independently from the question model `GEMINI_MODEL`. The learner explicitly chooses AI reading before a file is sent to Google. PDFs over four pages are split into four-page groups, with at most two in flight under one bounded deadline; partial results mark unread pages for review. `GEMINI_FALLBACK_MODEL` is used only for explicit transient provider responses (503 UNAVAILABLE or 504 DEADLINE_EXCEEDED) while time remains. Authentication, quota and billing errors are reported directly.

The first deployment and each later container start run `prisma migrate deploy`, seed the study topics, and then start the API. The `/health` endpoint reports whether PostgreSQL and Redis are reachable. The service becomes healthy only after those dependencies are available.

## Build locally

The same build sequence can be run before deployment:

```bash
npm ci
npm --prefix backend ci
npm run build
```

To build the image locally for same-origin API calls:

```bash
docker build -t viendu .
```

## Where study history and AI questions are stored

The public **Lịch sử chuyến đi** reads the `sessions` object inside the `state` JSONB column of `adventure_state` (row `id = 1`). In Railway’s PostgreSQL Data view, open `adventure_state`, then expand `state` → `sessions`. Each session contains its goal/topic, timestamps, study/rest schedule, device category, distractions, and the server-graded `quiz` result when available. `tester_runs` is a legacy table and is not the source of the current trip-history page.

Migration `20261010120000_remove_static_quiz_bank` deletes the old `source = static` preset questions and renames `quiz_bank` to `ai_questions`. The new table stores questions generated by AI for an account; listing and grading require that account’s ownership. Previously graded static answers retain a `question_snapshot` in `quiz_sessions` with their selection, correctness, and timestamp; the retired question reference is cleared. AI question IDs, existing grades, and the Adventure history JSON are preserved. The migration runs automatically at deployment before the service starts.
