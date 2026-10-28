# Study Exercises Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Let signed-in learners prepare open-ended exercises before a focus session and receive AI solutions only after the persisted session completes.

**Architecture:** Bind an owner-scoped preparation to the existing planned session ID. Store the exact confirmed text snapshot privately (up to 20,000 characters), return question-only content before completion, and generate/cache the answer after a short server transaction verifies the persisted session.

**Tech Stack:** React 19, TypeScript, Fastify 5, Prisma 6, Gemini structured output, Vitest, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-28-study-exercises-and-access-design.md` (section 1; open-ended exercise ruling from root is binding).

## Global Constraints

- Only authenticated owners may save or read a preparation and solution; guests can focus without this feature.
- Preserve exact user-provided open-ended text; generated mode creates 1–5 open-ended exercises, default 3. Choices are optional, never mandatory MCQ.
- Limit selected source text to 20,000 JavaScript characters; allow request-body room for UTF-8 and JSON overhead.
- Before completion, no feature solution appears in question responses, snapshots, sync/bootstrap, or localStorage.
- Gate on persisted `effectiveMetrics.completed` and `isSessionRemoved`; await sync and recheck owner/session/source liveness before client reveal.
- Never hold `adventure_state` or exercise-table locks across Gemini calls. Lock order is world then exercise; use a short generation lease/token and revalidate before caching.
- Keep AI output structured and grounded. Do not alter existing quiz/study-guide behavior, OCR, session accounting, score, or XP.
- Include bounded client/server generation timeout; do not broaden all API timeouts or log source text.

## Review Focus

- Early-ended or foreign-owner session cannot unlock a solution; test both.
- A slow solver racing session removal returns no solution and writes no cache.
- A source/deck change during generation invalidates the old response and solution request.
- Provider output with extra answer fields in the pre-session schema is rejected.
- Unicode source near the character limit is accepted without truncation or accidental UTF-8 body-limit rejection.

---

### Task 1: Question-only contracts and preparation storage

**Files:**
- Create: `backend/src/studyExerciseSchemas.ts`
- Create: `backend/src/studyExercises.ts`
- Modify: `backend/prisma/schema.prisma`, new migration under `backend/prisma/migrations/`
- Modify: `backend/src/app.ts` (route registration; coordinate this import with the public-report route during integration)
- Test: `backend/tests/studyExercises.test.ts`

**Interface:**
- `POST /api/v1/study-exercises` accepts `{ plannedSessionId, mode, text, count? }`; `mode` is `provided | generated`, `text` is 1–20,000 characters, and `count` defaults to 3 and is limited to 1–5 for generated mode.
- Provided mode stores and returns the exact confirmed problem text as one open-ended prompt, preserving numbered subproblems.
- Generated mode returns 1–5 open-ended problem statements. Optional choices are allowed only when useful. Response is `{ id, plannedSessionId, mode, exercises }` with no answer/key/explanation.
- `GET /api/v1/study-exercises/:id` returns the same question-only DTO to its owner.
- Store owner, planned session, mode, exact private snapshot, fingerprint, question DTO, evidence excerpt, expiry/state, and a nullable solution cache in a purpose-built owner-scoped table; never add material to `AdventureState`.

- [ ] Add schema tests for exact provided text, open-ended generated content, 1–5 count, 20k-character cap, strict rejection of solution fields, and source-excerpt membership.
- [ ] Run the focused backend tests and confirm they fail for missing contracts.
- [ ] Implement the DTO/schema, owner-scoped persistence, route registration and question-only responses.
- [ ] Run `npm --prefix backend run db:generate` and focused tests; verify no answer fields in any response.
- [ ] Commit as `feat: prepare owner-bound study exercises`.

### Task 2: Post-completion solution release

**Files:**
- Modify: `backend/src/studyExercises.ts`, `backend/src/adventure/domain.ts` only if a focused completion/ledger helper is needed
- Modify: `backend/src/studyExerciseSchemas.ts`
- Test: `backend/tests/studyExercises.test.ts`

- [ ] Add failing route tests for unauthenticated/foreign owner, missing/early-ended/removed session, completed session, retry, duplicate request, stale source and provider response that arrives after removal.
- [ ] Run the focused backend tests and confirm the gate failures.
- [ ] Implement `POST /api/v1/study-exercises/:id/solution`: in a short transaction claim the generation token and verify owner + persisted completed live session; call Gemini outside the transaction using the stored snapshot; in a second short transaction revalidate token, owner, source/version, session completion and tombstone before caching/returning.
- [ ] Ensure no result or cache is returned if the owner/session/source changes during provider work. Repeated eligible requests return the cached structured answer and worked explanation.
- [ ] Run the focused backend tests, including a controlled provider barrier race; commit as `feat: gate study solutions on completed sessions`.

### Task 3: Optional preparation and gated reveal in the focus flow

**Files:**
- Create: `src/adventure/StudyExercisePreparation.tsx` and focused styles/tests as needed
- Create: `src/services/studyExercisesApi.ts` (keep distinct from auth edits in `src/services/api.ts`)
- Modify: `src/adventure/AdventureApp.tsx`, `src/adventure/storage.ts` only for question-only state
- Test: focused `tests/studyExercise*.test.mjs` plus existing material/storage tests

- [ ] Add failing UI/client tests for both modes, exact text preservation, explicit reviewed-source confirmation, guest sign-in prompt, source-change invalidation, and absence of solution data before completion.
- [ ] Run the focused web tests and confirm they fail.
- [ ] Add the optional ticket preparation and summary reveal. Bind the set to `draftTripId`; wait for `sync()` before requesting the solution, then recheck current account, session and request generation before displaying it.
- [ ] Render answer and worked explanation through the existing safe Markdown/math renderer; do not add grading or XP changes. Provide loading, cancel, retry and skip states.
- [ ] Add the exercise generation/solution endpoints to the existing bounded 100-second client timeout list only; verify ordinary API timeouts stay unchanged.
- [ ] Run focused tests and relevant existing `tests/materialSources.test.mjs`, `tests/quizStorage.test.mjs`, and `tests/quizPrefetch.test.mjs`; commit as `feat: add session-gated study exercise flow`.

## Final verification for this lane

Run backend `db:generate`, `typecheck`, full `test`, `build`; run web `lint`, `typecheck`, `test:web`, `build:web`; inspect the final lane diff. A fresh browser pass must cover 1440/768/390 px, light/dark, source review, loading/error/retry, early end and completed-session solution reveal.
