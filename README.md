# Viễn Du

Viễn Du is a web learning adventure with a cartoon 2D train journey, personal progress, planned study trips, a journal, and optional AI learning tools. The browser app is the primary experience; Electron packages the same web app for Windows.

Preparation uses a compact tear-off train ticket in Viễn Du's cream, green, and terracotta palette. Its anonymous trip code comes from the server before departure and matches the code in saved trip history. Starting or resuming from a button requests fullscreen; Escape leaves fullscreen, and the visible control can enable it again. Learning still works when fullscreen is unavailable or declined.

## Run locally

Use Node.js 24 LTS and npm 11, matching GitHub Actions. npm 10 may reject the lockfile while resolving peer dependencies.

```bash
npm ci
npm --prefix backend ci
npm --prefix backend run db:generate
npm start
```

`npm start` starts the local API/database and the web app at `http://localhost:8084` together. `npm run dev` and `npm run web` do the same thing. Healthy existing Viễn Du services are reused; occupied unrelated ports produce an actionable error. Keep the terminal open while the server runs. Guest mode works offline. Create a backend account to try sync, planned study trips, and AI learning tools. AI reading, questions, study guides, and exercises require `GEMINI_API_KEY` on the backend; the key stays on the server. Printed documents can be read on the device. Handwriting can be read through Google Gemini after the learner explicitly chooses AI reading; questions use the reviewed source text.

Each departure is counted once as a distraction; returning resumes immediately. **Lịch sử chuyến đi** automatically lists saved sessions, including guest sessions after they sync to the server. The anonymous projection includes HMAC trip and tester codes, a goal summary limited to 200 characters, topic, timing, breaks, coarse device category, distractions, and server-graded quiz score. The summary is shown automatically, so do not put private details in the goal. Email, account identifiers, materials, and detailed answers are not sent as separate fields. CSV exports up to the latest 10,000 saved sessions.

Study groups are formed for a planned trip, with up to six people including the owner. Invite codes expire after 24 hours or are revoked when the trip departs. Each member starts and settles their own focus session; group membership and trip contribution progress are scoped to that trip, while personal journey progress persists. Trip members can see the shared goal, topic, and planned duration, while study sources, exercise prompts, and answers remain private. Starting a trip session requires an authenticated account and an online backend; after reload, each member can recover only their own in-progress reservation. The current app uses planned trips at `/api/v1/adventure/trips`; the older `/api/v1/adventure/groups` endpoint is deprecated compatibility. Existing legacy groups still support reading and resuming saved sessions, settling them, and leaving, but cannot create new invites or starts.

## Admin reporting

Admin access is denied until a bootstrap account is configured in the backend `ADMIN_USER_IDS` variable or a persistent database grant exists. Set comma-separated account UUIDs from `users.id` only in backend configuration, then restart the API. Bootstrap administrators are protected recovery accounts; the panel cannot edit, demote, suspend, or delete them. They can grant persistent admin access to other accounts through the panel. Emptying the variable removes only bootstrap grants, not persistent grants. The server checks the live account on every admin request; client-supplied roles do not grant access.

Reports show study timing, progress, group summaries, and graded quiz totals. They exclude private goals, documents, and quiz feedback, use UTC, and analyze up to 20,000 recent sessions per selected window; capped results are marked. Account controls include display-name edits, role changes, suspension, and recoverable deletion. Each change requires a reason, rejects stale versions, and records an append-only audit entry. Deletion preserves study history, revokes persistent admin access and login sessions, and blocks login. Restoring an account requires a fresh login and does not reinstate admin access; a separate suspension remains in effect. Do not put learner content, private goals, documents, or quiz answers in audit reasons.

Open your profile using your name/avatar, then **Khu vực quản trị**. Confirmed administrators see **Mở khu vực quản trị**; other accounts can copy their account ID and recheck access after the server configuration changes. The profile also shows owner-scoped study totals, recent trips, personal journey progress, and sync status.

To preview account search, reports, pagination, mutations, audit history, CSV export, and failure states without connecting to a real API, follow [the isolated admin fixture guide](docs/ADMIN_FIXTURE.md). It binds only to loopback port 5194 and uses synthetic `example.invalid` accounts.

## Scanned documents and exploration

Import scanned PDFs or PNG/JPG/WebP/BMP images to recognize Vietnamese and English text with local OCR. Selectable PDF text is preserved; pages with little usable text are recognized individually. OCR workers, language data, and WebAssembly are bundled with the app and served from the same origin. Local OCR processes files on the device. For signed-in trips, reviewed source text is sent to AI during focus to prepare questions; manual generation uses the same source. Progress and page indicators are shown during import. Cancelling, leaving the ticket, or switching accounts discards the unfinished import.

Google AI Studio keys, including newer `AQ` authorization keys, use the existing Gemini backend integration. Set `GEMINI_API_KEY` in the ignored `backend/.env` for local development and restart the API. For hosting, set the secret in the backend service environment. Local OCR does not need this key; optional AI reading sends the selected file to Gemini only after the learner chooses **Đọc bằng AI**. Never add the key to a `VITE_*` variable.

Imports allow 32 MiB per file, 10 files per trip, and 50,000 source characters. Images are limited to 20 megapixels. PDF reading is limited to 20 pages, with a 120-second local OCR budget per file; partial results identify the limit reached. Clear, upright scans give better recognition results. Unsupported or unreadable files still show their name and status.

In **Tài liệu học tập**, select **Ưu tiên dùng AI để đọc PDF/ảnh** when the file contains scans, handwriting, or text that cannot be read locally, then explicitly choose **Đọc bằng AI** on the imported file. This sends that PDF or PNG/JPG/WebP image through the authenticated backend to Google Gemini. The original file is kept in browser memory and is not stored on the server. Long PDFs are read in groups of up to four pages with at most two groups in flight. AI reading reports missing or unclear pages; review and edit the transcription before confirming it. Local OCR and partial imports also require source review. Verified file sources are stored separately from personal notes, so clearing notes cannot replace the source with generic topic questions. Files whose sources are missing or unreviewed block question generation.

The departure page offers **Dán nội dung**, **Tải tài liệu**, and **Nhờ AI soạn**. The last option uses the same Google AI Studio/Gemini key to draft revision material from a learner's free-form request when no notes or documents are present. The learner can ask for a format that fits the request, edit and review the draft, then explicitly confirm it as the trip's private source for later quiz questions. The authenticated `/api/v1/materials/generate` endpoint returns the draft without saving it. Contextual AI reading may propose blurred-text reconstructions inline as `[suy luận: ...]`; unsupported gaps remain `[không rõ]`, and all inferred content still requires review.

**Giải bài tập bằng AI** accepts a typed exercise prompt or supported local files and images. Text extraction and OCR run on the device; the learner can edit the preview and explicitly replace or append it to the prompt. The prompt is limited to 20,000 characters, and only text confirmed for submission is sent to AI. Prepared exercises appear during focus; solutions are available only after the server confirms that the session is complete.

The 2D journey map covers unexplored terrain and future stations with overlapping cartoon clouds. Clouds shrink as the train approaches; discovered regions remain clear. Rails stay continuous beneath the clouds. The timer keeps the train centered with moving 2D scenery. Personal trips preview active focus time and retain pending offline progress; group maps open terrain only after the server confirms the contribution and daily allowance. Time away and scheduled rest do not open new terrain. Unopened station names and stories remain hidden on the map.

Before starting, choose up to 10 **Trạm dừng chân**, each lasting 1–30 minutes. Breaks are spread evenly through the study time and start and end automatically. Their duration is added to the trip wall clock, excluded from focus quality and XP, and shown separately in the journal and trip history. There is no arbitrary pause; leaving during study still counts as a distraction, while an absence wholly inside a scheduled break does not.

## AI questions and learning journal

Before departure, choose 1–30 questions (default 3). Signed-in trips prepare them during focus using the trip topic, goal, and canonical reviewed source. The summary reuses ready or in-flight questions; ending early may still require waiting for the current request. Source or count changes invalidate old questions, while generation failures can be retried manually. There is no prebuilt question bank in the learning flow. Draft questions and answers stay in owner-scoped browser storage. Grading waits for the finished session to synchronize; the first submitted score and detailed answer feedback are saved by the server. Reopening the journal restores the assessment.

Wrong answers identify **Kiến thức cần ôn** from the concepts tested in that question set. **Ôn lại trong một phiên mới** opens a new ticket with those concepts and the previous material; the learner chooses when to start. A perfect score only describes this set of questions. Older score-only assessments cannot reconstruct knowledge gaps.

The journal shows distractions, valid focus time as a percentage of elapsed study time excluding scheduled rest, and the question score separately. Focus labels use descriptive thresholds: at least 80%, 50–79%, and below 50%; they are not a clinical assessment or a combined academic grade. **Kinh nghiệm toa** is accumulated valid study time: 60 seconds = 1 XP, with remaining seconds carried forward. Quiz scores and distraction counts do not directly add or subtract XP; time away from focus earns no XP.

## Preview a production web build

The preview server also requires port 8084. Stop the development server before starting it.

```bash
npm run build:web
npm run preview
```

The production files are written to `dist/`. See [web and Windows operations](docs/WEB_DESKTOP.md) for production hosting details.

For a single-service Railway deployment that serves both the web app and API, follow the [Railway setup guide](docs/RAILWAY.md).

## Package the Windows app

```bash
npm run build:web
npm --prefix desktop ci
npm --prefix desktop run package:win
```

The Windows installer is in `desktop/release/`. For a local desktop build, set `VITE_API_URL` in the root `.env` or build environment for an online backend. GitHub Actions defaults to `https://viendu.up.railway.app/api/v1`; the repository variable `VITE_API_URL` can override it. Actions builds the installer and a ZIP of the web app on pushes to `main`; download them from the `Vien-Du-Windows` artifact in the **Build Windows app** workflow.

To launch the desktop build locally after creating `dist/` and installing desktop dependencies, run this separately. It stays open until you close the Electron app:

```bash
npm --prefix desktop start
```

See [web and Windows operations](docs/WEB_DESKTOP.md) for backend deployment and cross-packaging from macOS.
