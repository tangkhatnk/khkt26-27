# Access and Report UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Improve credential feedback, fullscreen recovery, anonymous aggregate reporting and trip-detail readability without opening admin data.

**Architecture:** Keep auth/session semantics and admin routes authoritative. Add a separate public aggregate projection, use an accessible native fullscreen failure dialog, and share one disclosure state between desktop table details and mobile cards.

**Tech Stack:** React 19, TypeScript, Fastify 5, CSS, Node test runner, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-study-exercises-and-access-design.md` (sections 2–5).

## Global Constraints

- No account enumeration: unknown email and wrong password keep the same 401.
- Login checks only empty and API max-72 length; registration requirements stay scoped to registration.
- Fullscreen request runs directly inside a user gesture; choosing to continue does not restart the session or change distraction accounting.
- Anonymous report uses its own allowlisted aggregate DTO and CSV. Account/group/session admin routes and filtered exports remain authenticated.
- Preserve the separate public `ExperimentResults` publication semantics; its layout change does not change shared data.
- Use semantic controls, visible focus, reduced-motion support, and natural Vietnamese copy.

## Review Focus

- Same neutral login message for both credential failures; distinct known rate/network/server states only.
- Fullscreen unsupported/rejected paths remain dismissible and do not repeat prompts.
- Public endpoint and CSV omit injected goal/topic/identity text and all direct identifiers.
- Unknown registered-topic values map to `Khác` without changing totals.
- Desktop, tablet, mobile, long Vietnamese details, and both themes render without column squeezing.

---

### Task 1: Password field guidance

**Files:**
- Modify: `src/adventure/AuthForm.tsx`, `src/adventure/authFormModel.ts`, `src/services/api.ts`
- Tests: `tests/authFormModel.test.mjs`, `tests/apiSession.test.ts` or existing frontend/API session tests

- [ ] Add failing tests for empty/over-72 login password, registration unmet rule labels (length, uppercase, digit, special, UTF-8 bytes), and neutral unknown-email/wrong-password feedback.
- [ ] Run focused tests and confirm they fail.
- [ ] Implement field-specific Vietnamese guidance and map only known API conditions; preserve identical 401 semantics and existing “Hiện mật khẩu” control.
- [ ] Run focused auth tests; commit as `fix: explain password field errors safely`.

### Task 2: Initial fullscreen failure dialog

**Files:**
- Create or modify: `src/adventure/FocusFullscreenRecovery.tsx`, `src/adventure/AdventureApp.tsx`, focused CSS
- Tests: `tests/focusFullscreenRecovery.test.mjs`, `tests/studyFullscreen.test.mjs`

- [ ] Add failing behavior tests for the initial rejected request, unsupported API, Escape, continue, retry gesture, and no repeated prompt.
- [ ] Run focused tests and confirm they fail.
- [ ] Use a native modal `<dialog>` with focus management, Escape and Continue dismissal, return focus, and direct click-triggered `requestFullscreen()`; preserve single timer/session and recovery flow.
- [ ] Run fullscreen tests; commit as `fix: offer a dismissible fullscreen fallback`.

### Task 3: Public report projection and CSV

**Files:**
- Create: `backend/src/publicReport.ts`, `src/services/publicReportApi.ts`, `src/adventure/PublicReport.tsx`
- Modify: `backend/src/app.ts`, navigation/view integration in `src/adventure/AdventureApp.tsx`
- Tests: public report API tests in `backend/tests/` and UI/client tests in `tests/`

- [ ] Add failing API/CSV tests with synthetic identities, goals, private material and free-form topics; assert only aggregate allowlist keys and `Khác` are returned.
- [ ] Run focused tests and confirm they fail.
- [ ] Implement an anonymous route that has no account/group filters, `no-store` and existing rate limits; keep all admin routes/exports behind current auth. Provide aggregate CSV matching the same public allowlist.
- [ ] Add the anonymous navigation entry and public report UI without altering the separate experiment-history route.
- [ ] Run focused frontend/backend tests; commit as `feat: publish a privacy-filtered aggregate report`.

### Task 4: Expand trip details

**Files:**
- Modify: `src/adventure/ExperimentResults.tsx`, `src/adventure/experimentResults.css`
- Tests: `tests/experimentResults.test.mjs`, `tests/themeAppearance.test.mjs`

- [ ] Add failing markup tests for a single disclosure control, full-width sibling row (`colSpan=7`), mobile card details and shared expanded state.
- [ ] Run focused tests and confirm they fail.
- [ ] Move desktop detail content out of the narrow code cell; reuse the same open-run state for mobile and preserve all current data.
- [ ] Run focused tests and visually inspect 1440/768/390 px in light/dark with long Vietnamese text; commit as `fix: expand trip details across the history row`.

## Final verification for this lane

Run web `lint`, `typecheck`, `test:web`, `build:web`; backend `typecheck`, full `test`, `build`; desktop `typecheck` and `test`. View the changed UI at 1440/768/390 px, light/dark, loading/error/populated states. Inspect public JSON and CSV as actual serialized responses.
