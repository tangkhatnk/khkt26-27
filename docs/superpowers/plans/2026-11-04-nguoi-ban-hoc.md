# Người bạn học Implementation Plan

> **For agentic workers:** Use the assigned frontend or backend lane below. Checkboxes track delivery gates; do not merge or deploy from a worker lane.

**Goal:** Add a grade- and subject-based learning path with a companion, preserve the existing study loop, and let guests use bounded AI features without an account.

**Architecture:** Keep the current `station` route as the default path entry and build the path in the existing adventure surface. The frontend owns versioned curated lessons and learner progress; the backend owns guest authorization, AI limits, and API contracts. Connect the lanes only after the backend contract is reviewed.

**Tech Stack:** Existing React/Vite frontend, Fastify backend, local browser storage, and current AI providers; no new dependency is planned.

**Spec:** [2026-11-04-nguoi-ban-hoc-design.md](../specs/2026-11-04-nguoi-ban-hoc-design.md)

**Research protocol:** [2026-11-04-nguoi-ban-hoc-evaluation-protocol.md](../../research/2026-11-04-nguoi-ban-hoc-evaluation-protocol.md)

**Related issues:** [#76](https://github.com/tangkhatnk/khkt26-27/issues/76), [#72](https://github.com/tangkhatnk/khkt26-27/issues/72).

## Global constraints

- Keep the `station` route key, existing session semantics, signed-in behavior, and legacy route IDs.
- Keep private source confirmation before AI transmission; keep learner data private to its owner scope.
- Do not expose provider credentials, log private material, or claim measured outcomes that have not been collected.
- Use the existing frontend/backend dependencies and validate the final exact head.
- Show difficulty and duration as optional recommendations with explicit cold-start defaults; never claim mastery from XP or time spent.

## Review focus

- A returning learner whose lesson batch was updated keeps progress associated with stable lesson IDs and versions.
- A guest token cannot authenticate an account route or read another token's AI state.
- Quota rejection occurs before a provider call; per-principal accounting is atomic.
- A guest AI exercise/quiz requires explicit AI session start, while a normal focus session still works offline.
- The UI remains usable with long Vietnamese lesson names, missing network, an expired guest token, and history links using legacy route keys.

## Scope and decisions

- Audience: secondary learners (THCS–THPT), with a multi-grade, multi-subject catalog. Publish reviewed lessons in versioned batches; private learner materials remain separate from curated lesson content.
- Preserve the existing sequence: goal → material → focus timer → retrieval → evaluation. Keep Nhật ký, Lịch sử, and Báo cáo reachable throughout the experience.
- Make the first-use tour optional and reopenable. Keep existing route identifiers and focus, distraction, session, and history semantics.
- Use a vertically alternating path with tactile depth, clear current/locked/completed states, an illustrated companion and milestones in light/dark themes; remove legacy train artwork from primary learner surfaces while retaining internal IDs. Show daily activity only from recorded sessions, with no forced streak.
- Base optional difficulty recommendations only on assessed concept outcomes: after at least three completed evaluations and ten scored answers, suggest one step up at mean correctness ≥80%, a worked review at ≤50%, and otherwise keep the level. Before enough evidence, use the curated default and make no personalized claim. Never use XP or session duration as mastery.
- Suggest duration from the median valid study time in the last three completed same-subject sessions, rounded to five minutes and bounded to 5–25 minutes; otherwise use the curated estimate. Let the learner override it.
- Permit guest AI use through a bounded guest capability with explicit limits and the same request validation as signed-in use. Keep materials and results private to their learner scope; retain explicit confirmation before sending material to AI.
- Treat metrics as observed activity, not evidence that learning improved. Do not publish effectiveness, OCR, or AI-quality claims until the relevant benchmark or human study has produced real results.
- Root review and the repository's required CI and approvals gate merge and deployment.

## Requirements traceability

| Requirement | Owner / gate | Acceptance evidence |
|---|---|---|
| Grade and subject path, alternating vertical nodes, current/locked/completed states, illustrated companion and milestones, optional/reopenable tour | Frontend lane | UI and focused tests cover empty, started, completed, and returning learners; nodes remain legible in light/dark themes and at desktop/tablet/mobile sizes; existing `station` deep links still open the path. |
| Versioned curated lessons and private learner progress | Frontend lane | Lesson IDs and content versions are stable; progress survives reload and remains scoped to the current learner. Daily activity appears only when backed by real sessions, with no forced streak. |
| Goal → material → focus → retrieval → evaluation; history, journal, and reports remain visible | Frontend lane and integration | Existing focus/session behavior is preserved; end-to-end flow reaches the current evaluation/summary and navigation retains all three destinations. |
| Evidence-based difficulty and focus-duration suggestions | Frontend lane | Unit tests prove the 3-evaluation/10-answer thresholds, 80%/50% bands, curated cold start, median valid-time duration, bounds, and learner override; the live path uses the suggestions. |
| Bounded AI use without an account, with private materials/results and explicit send confirmation | Backend contract, then integration | Guest authorization and quota tests; request/response contract reviewed before frontend wiring; ownership and consent behavior covered. |
| Focus time, distractions, valid study time, and points | Metrics checkpoint | Values are defined against current session rules and labeled as activity measurements; no outcome claim is inferred from them. |
| AI question quality, independent OCR accuracy, comparison benchmark, and statistical protocol in #72 | Research checkpoint after feature lanes | Runnable synthetic/de-identified benchmark, input and scoring documentation, OCR results on a held-out source, and a controlled-study protocol; report actual limitations and leave unmeasured results blank. |

## Delivery sequence

### 1. Frontend path

- [ ] Build the default path inside the existing adventure navigation, retaining the `station` route key.
- [ ] Use a vertically alternating path with tactile depth, clear current/locked/completed labels, an illustrated companion, and milestone markers in light and dark themes. Remove legacy train artwork from primary learner surfaces while retaining internal route/session IDs.
- [ ] Add reviewed, versioned lesson batches for multiple grades and subjects; scope progress by learner and lesson version.
- [ ] Display daily activity only from stored completed sessions; do not manufacture progress or require a streak.
- [ ] Recommend one difficulty step up only after at least three completed evaluations and ten scored answers for the concept when mean assessed correctness is at least 80%; recommend a worked review at 50% or below; otherwise retain the current level. Use curated defaults before evidence is sufficient. Do not use XP, duration, or unassessed behavior as mastery evidence.
- [ ] Recommend focus duration from the median valid study time of the last three completed same-subject sessions, rounded to five minutes and clamped to 5–25 minutes; otherwise use the curated lesson estimate. Keep recommendations optional and editable.
- [ ] Test that the path actually displays and applies these recommendations, including insufficient evidence, thresholds, bounds, and learner override.
- [ ] Preserve the existing study sequence and keep Nhật ký, Lịch sử, and Báo cáo easy to reach.
- [ ] Add a first-use tour with skip and reopen actions.
- [ ] Validate first-visit skip/replay, resume, current/locked/completed nodes, old custom material and new curated lessons, and bad-network guest consent at desktop/tablet/mobile in both light and dark themes.

### 2. Guest AI contract

- [ ] Issue the opaque guest token through `POST /api/v1/ai/guest/credential` and accept it only as `Authorization: GuestAI <token>` under `/api/v1/ai/guest/*`.
- [ ] Match current schemas for `/sessions/start`, `/materials/read`, `/materials/summarize`, `/study-guides/generate`, `/quizzes/generate`, `/quizzes/:quizId/grade`, and exercise prepare/retrieve/cancel/solution routes.
- [ ] Keep token-private state in Redis with its TTL; store only allowed summary history outside it, with no prompts or feedback in public guest history.
- [ ] Apply issuance/request gates, atomic per-token task budgets, and the configured provider spend cap before provider calls. Do not trust forwarded-for headers.
- [ ] Add tests for guest credential scope, account-route rejection, quota exhaustion before provider use, malformed input, token expiry, and cross-principal isolation.
- [x] Root approved the guest credential and quota direction. FE has the exact lane contract and may integrate under it; final test evidence remains a gate.

### 3. Integration

- [ ] Connect the frontend to the guest token contract without changing account-based behavior; make token/session expiry understandable, preserve ordinary offline focus sessions, and require consent before AI reads private material.
- [ ] Verify the full goal-to-evaluation path and that the same learner can return to journal, history, and reports.
- [ ] Review the combined diff and resolve any cross-lane conflicts before running exact-head validation.
- [ ] On the exact final BE SHA, run the quota/reservation paths against a genuine Redis service when available, as `ioredis-mock` may not match Lua/transaction behavior. In Codex browser, exercise both guest and account flows with synthetic content and a synthetic/mock provider; a mock result is not evidence that real Gemini succeeded.

### 4. #72 evaluation and research checkpoint

- [ ] Map each #72 suggestion to a measured implementation, a runnable technical benchmark, a research protocol, or an explicitly unmeasured item.
- [ ] Provide a repeatable benchmark with synthetic/de-identified JSON inputs for question schema, source evidence, correctness, answer-key agreement, distractor quality, and clarity. Require independent human review for subjective quality; do not fabricate reviewer scores.
- [ ] Measure OCR CER/WER on an independent held-out source, reporting language, printed/handwritten status, layout strata, versions, limits, and failures. Evaluate VietOCR and PP-StructureV3 only in an optional offline pilot if the corpus justifies them.
- [ ] Run the app's existing local Tesseract path on all 40 pinned CC0 `vn-synthetic-ocr` rows (revision `7c1c9114c610150b8b36783f089199eee62348b2`; [SHA-256 manifest](../../research/vn-synthetic-ocr-7c1c9114.sha256)) as a synthetic smoke/CER regression check. Add natural rows only after license, provenance, and held-out split are confirmed; keep synthetic and natural results separate and store only permitted result metadata.
- [ ] Compare reproducible tasks against a 25-minute timer plus ordinary review and one existing study tool. Keep conclusions descriptive unless measured evidence supports more.
- [ ] Document a preregisterable 7- and 30-day recall study with stratified assignment, equal study time/materials, outcome definitions, uncertainty, and attrition handling. Do not imply it has run without participants, permission, and collected data.
- [ ] Keep #72 open until longitudinal results exist; report technical-pilot findings separately from participant outcomes.
- [ ] Prepare the PR after root review and exact-head local evidence; close #76 when its software criteria pass, and reference rather than close #72 while participant follow-up remains.

## Checkpoint (2026-11-04)

- Base for all three task branches: `origin/main` at `9dbec2683dd43f1f4249dd7bddebc5cdf0d9929f`.
- Frontend and backend work are in progress; FE has cleared its API-contract wait and is integrating guest routing in its own lane. Research protocol/dataset preparation is underway; benchmark implementation starts after both feature checkpoints are reviewed. No code is integrated yet.
