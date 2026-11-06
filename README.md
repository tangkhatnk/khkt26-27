# Viễn Du

Viễn Du is a browser-first study app for secondary learners. Personal study starts with a learning goal, then moves through a plan, materials, focus, retrieval, and evaluation. AI can suggest plan steps, but learners choose what to use; manual focus works without an account or network. Electron packages the same web app for Windows.

## Goal-first personal study

Learners describe what they want to learn, review or edit a suggested plan, and optionally add reviewed study material. The revision library keeps notes, extracted text, file metadata, and review state in the current guest or account owner's local workspace. Original file binaries stay in browser memory and must be reimported after a reload before they can be sent for AI reading. Materials are not part of public session history; a file or text is sent for AI only after the learner explicitly chooses that action.

On first use, a short two-part survey records the learning goal, topic, preferred duration, and optional context, followed by a four-step guide to the actual workspace controls. Progress is saved locally and can be paused, resumed, or reopened. The guide works offline, does not trigger AI requests, and does not interrupt an active focus session or its timer.

Manual focus can be set from 1 to 240 minutes and started without an account, network connection, or generated plan. Focus keeps attention on the selected step and timer, respects reduced-motion preferences, and retains the existing rules for elapsed time, breaks, and time away. A private learning journal shows the current owner's session and assessment detail in a two-page spread on desktop and one page at a time on mobile; the public history continues to use its limited summary contract.

## Accounts, guest AI, and legacy groups

An account is for account sync and administration. New group management is retired; saved group data remains available under the compatibility rules below.

Guest AI is optional and can be used without an account when online. Each AI action is explicit; sending a document for AI reading also requires confirmation. AI plan drafts and other private responses do not become public session history.

Guest AI uses a short-lived private credential and Redis-backed session state. Private decks, answer keys, exercise state, and detailed feedback expire after seven days and are not transferred into an account. Existing anonymous history may store a limited session summary; it does not include AI prompts or detailed answer feedback. Guest requests are limited by configurable per-IP, per-credential, per-task, and global daily quotas before provider calls. Configure `GUEST_AI_*` limits in `backend/.env.example`; these internal usage units are not billed token counts. Production guest AI requires Redis and a backend `GEMINI_API_KEY`.

## Run locally

Use Node.js 24 LTS and npm 11, matching GitHub Actions. npm 10 may reject the lockfile while resolving peer dependencies.

```bash
npm ci
npm --prefix backend ci
npm --prefix backend run db:generate
npm start
```

`npm start` starts the local API/database and the web app at `http://localhost:8084` together. `npm run dev` and `npm run web` do the same thing. Healthy existing Viễn Du services are reused; occupied unrelated ports produce an actionable error. Keep the terminal open while the server runs. Manual personal study and local OCR work offline. Sign in when you need account sync or administration. Guest AI is optional and online-only; account-based and guest AI both require a backend `GEMINI_API_KEY`, which stays on the server. AI reads a document only after the learner explicitly chooses that action, and source-grounded questions use reviewed material.

## Session history and account features

Leaving the focus view counts once as a distraction under the existing session rules; returning resumes immediately. **Lịch sử phiên học** lists saved sessions, including guest summaries stored by the server. The anonymous projection includes HMAC trip and tester codes, a goal summary limited to 200 characters, topic, timing, breaks, coarse device category, distractions, and any session score allowed by the existing history contract. The summary is shown automatically, so do not put private details in the goal. Email, account identifiers, materials, and detailed answers are not sent as separate fields. Guest AI decks and detailed feedback stay in private Redis state and are not part of this projection. CSV exports up to the latest 10,000 saved sessions.

New group-management actions are retired and return HTTP `410 feature-retired`. Stored group and trip records are preserved; history and reads remain available, and a legacy group session that was already active can still complete and settle. No personal source material, prompt, answer, or detailed AI feedback is added to the public history projection.

### Admin reporting

Admin access is denied until a bootstrap account is configured in the backend `ADMIN_USER_IDS` variable or a persistent database grant exists. Set comma-separated account UUIDs from `users.id` only in backend configuration, then restart the API. Bootstrap administrators are protected recovery accounts; the panel cannot edit, demote, suspend, or delete them. They can grant persistent admin access to other accounts through the panel. Emptying the variable removes only bootstrap grants, not persistent grants. The server checks the live account on every admin request; client-supplied roles do not grant access.

Reports show study timing, progress, group summaries, and graded quiz totals. They exclude private goals, documents, and quiz feedback, use UTC, and analyze up to 20,000 recent sessions per selected window; capped results are marked. Account controls include display-name edits, role changes, suspension, and recoverable deletion. Each change requires a reason, rejects stale versions, and records an append-only audit entry. Deletion preserves study history, revokes persistent admin access and login sessions, and blocks login. Restoring an account requires a fresh login and does not reinstate admin access; a separate suspension remains in effect. Do not put learner content, private goals, documents, or quiz answers in audit reasons.

Open your profile using your name/avatar, then **Khu vực quản trị**. Confirmed administrators see **Mở khu vực quản trị**; other accounts can copy their account ID and recheck access after the server configuration changes. The profile also shows owner-scoped study totals, recent trips, personal journey progress, and sync status.

To preview account search, reports, pagination, mutations, audit history, CSV export, and failure states without connecting to a real API, follow [the isolated admin fixture guide](docs/ADMIN_FIXTURE.md). It binds only to loopback port 5194 and uses synthetic `example.invalid` accounts.

### Revision materials, OCR, and exercises

Import scanned PDFs or PNG/JPG/WebP/BMP images to recognize Vietnamese and English text with local OCR. Selectable PDF text is preserved; pages with little usable text are recognized individually. OCR workers, language data, and WebAssembly are bundled with the app and served from the same origin. Local OCR processes files on the device. A source remains in the owner's revision workspace until the learner explicitly chooses an AI action; reviewed material is required for source-grounded questions. Cancelling an import or switching owners discards unfinished work.

Google AI Studio keys, including newer `AQ` authorization keys, use the existing Gemini backend integration. Set `GEMINI_API_KEY` in the ignored `backend/.env` for local development and restart the API. For hosting, set the secret in the backend service environment. Local OCR does not need this key; optional AI reading sends the selected file to Gemini only after the learner chooses **Đọc bằng AI**. Never add the key to a `VITE_*` variable.

Imports allow 32 MiB per file, 10 files per study workspace, and 50,000 source characters. Images are limited to 20 megapixels. PDF reading is limited to 20 pages, with a 120-second local OCR budget per file; partial results identify the limit reached. Clear, upright scans give better recognition results. Unsupported or unreadable files still show their name and review status, and are not treated as reviewed material.

In the revision library, local extraction and OCR happen on the device; extracted text, file metadata, and review state persist in the owner's workspace. Original file binaries remain in browser memory and must be reimported after a reload before AI reading can use them. For difficult scans or handwriting, the learner can explicitly choose AI reading and confirm sending that file. Review and edit the returned transcription before marking it reviewed. AI reading may report unclear or missing content, and inferred text is not verified. Notes and files remain separate so editing notes does not replace a source; missing, unreadable, or unreviewed sources are not used as verified material.

An optional AI planner can draft a goal-first study plan from the learner's goal, with reviewed source material when available. AI can also help prepare revision material from a learner's request. Review and edit any generated draft before using it. AI-generated plans and drafts are private to the owner's workspace and are not added to public history. The current account and guest endpoints return their drafts without saving source text to public history. Contextual AI reading may propose blurred-text reconstructions as `[suy luận: ...]`; unsupported gaps remain `[không rõ]`, and inferred content still requires review.

**Giải bài tập bằng AI** accepts a typed exercise prompt or supported local files and images. Text extraction and OCR run on the device; the learner can edit the preview and explicitly replace or append it to the prompt. The prompt is limited to 20,000 characters, and only text confirmed for submission is sent to AI. Prepared exercises appear during focus; solutions are available only after the server confirms that the session is complete.

The focus view is intended to stay quiet around the current plan step and timer. Reduced-motion preferences are respected. Manual focus remains available offline; network-dependent AI actions do not block starting or completing an ordinary session.

Before starting, choose up to 10 **Trạm dừng chân**, each lasting 1–30 minutes. Breaks are spread evenly through the study time and start and end automatically. Their duration is added to the trip wall clock, excluded from focus quality and XP, and shown separately in the journal and trip history. There is no arbitrary pause; leaving during study still counts as a distraction, while an absence wholly inside a scheduled break does not.

### AI questions and learning journal

Retrieval and evaluation follow the selected plan and reviewed material. AI quiz generation and grading are optional; guests can use them without an account when the backend is online. Guest decks, answer keys, and detailed feedback remain private to the guest credential in Redis until expiry and are not stored in `Session.quiz` or the public history projection. The journal is owner-scoped and keeps session assessment separate from focus and distraction measures.

When an assessment includes its questions, wrong answers can identify **Kiến thức cần ôn** from the concepts tested. A perfect score only describes that set of questions. Older score-only assessments cannot reconstruct which answers were wrong.

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
