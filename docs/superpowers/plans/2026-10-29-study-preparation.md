# Implementation plan: study preparation

Scope: issues [#67](https://github.com/tangkhatnk/khkt26-27/issues/67)–[#70](https://github.com/tangkhatnk/khkt26-27/issues/70), against the approved [design](../specs/2026-10-29-viendu-study-trip-design.md).

## 1. Structured reviewed-source rendering

- Add a failing regression around representative OCR text containing headings, lists, and unambiguous formulas; verify it renders as structured content while remaining in `needs-review` until confirmed.
- Add backend `materialReading.ts` prompt/output-contract coverage and update its transcription instructions/validation so image AI reading preserves supported Markdown/LaTeX structure. Keep uncertainty markers and avoid adding or repairing unsupported source content.
- Update the existing study-guide renderer/reader path to preserve the returned Markdown/LaTeX and use existing KaTeX support. Keep transcript editing, uncertain-content review, and confirmation invalidation intact.
- Verify older plain-text transcripts and extraction cancellation still work; do not infer ambiguous subscripts or alter source fingerprints.

## 2. Optional post-session review

- Add a failing test proving skip starts a focus session without requesting or accepting a prepared quiz.
- Add explicit skip/enable state to the existing count control. Fence stale in-flight prefetch results when the learner skips, while leaving summary opt-in available.
- Cover skip, re-enable, normal 1–30 selection, session persistence, and material availability in frontend tests.

## 3. Typed exercise counts

- Add red schema/service/API/UI regressions for independent counts, zero for omitted types, invalid negative/fractional/all-zero/over-limit input, exact distribution, and same-total/different-mix idempotency conflict.
- Extend request validation and the exercise form with four 0–5 counts and total 1–20. Preserve legacy scalar-count requests and existing saved sets.
- Persist the new request composition compatibly and add a Prisma migration if required. Keep source fingerprint behavior unchanged and keep answers/solutions out of public question DTOs.
- Generate and solve in bounded batches of at most five under one shared request deadline, with cancellation propagation and all-or-nothing persistence. Preserve provided-question mode and source grounding checks.

## 4. Gemini diagnosis and bounded fallback

- Reproduce against the study-exercise provider path using synthetic material and sanitized status/model/timing evidence; do not log keys, prompts, or source text.
- Add provider tests for retryable timeout/overload versus permanent authentication, permission, model, and quota failures. Add at most one eligible fallback within the shared request budget.
- Correct only confirmed behavior; keep provider output validation and cancellation. Report production credential/quota limits separately from mock-test results.

## 5. Validation and handoff

- Run relevant web tests, lint, typecheck, and web build; run backend tests, typecheck, build, and database generation/migration validation as required by touched files.
- Review the final lane diff for source fidelity, quiz fencing, exact composition, bounded deadline/cancellation, atomic persistence, and answer privacy. Record commands, exits, and any live-provider limits.

## Interfaces and ownership

- Keep domain/provider rules in existing `src/adventure`, `src/material`, `src/services`, and `backend/src` owners. Touch `AdventureApp.tsx` only for the post-session quiz controls; avoid trip/group regions.
- Maintain old request and stored-row compatibility. Do not weaken reviewed-source confirmation or grounding.
