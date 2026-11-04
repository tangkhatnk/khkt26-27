# Người bạn học Design

**Related issues:** [#76](https://github.com/tangkhatnk/khkt26-27/issues/76), [#72](https://github.com/tangkhatnk/khkt26-27/issues/72).

## Intent

Help secondary students (THCS–THPT) see a useful next step across grades and subjects, then try lessons and bounded AI assistance before creating an account. Keep the existing focus journey and its learning history as the center of the experience.

## Goals

- Add a path organized by grade and subject, with reviewed lesson batches, a learner companion, a current step, and first-use guidance that can be skipped or reopened.
- Publish curated content in versioned batches only after a maintainer checks the lesson text, answer keys, explanations, and grade fit. Do not imply external educator endorsement unless one is obtained.
- Present the path as vertically alternating lesson nodes with tactile depth, clear current/locked/completed states, an illustrated companion, and milestone markers in both light and dark themes.
- Remove legacy train artwork from primary learner surfaces while retaining internal route and session IDs for compatibility.
- Show daily activity and progress only when backed by recorded learner activity; do not invent progress or force a streak mechanic.
- Keep the learner's flow intact: goal → material → focus timer → retrieval → evaluation.
- Keep Nhật ký, Lịch sử, and Báo cáo visible and preserve existing focus, distraction, valid-time, points, session, and history behavior.
- Allow guest AI use with explicit limits, private state, and the same validation boundaries as account use. Preserve explicit consent before sending private material to AI.
- Support measurement and evaluation requested by #72 without presenting product instrumentation as learning-outcome evidence.

## Non-goals

- Replace the existing journey/session domain or move the application to a separate course product.
- Change focus-timer or valid-study-time semantics, public report exposure, or account-based behavior.
- Send learner material to AI without confirmation, or expose prompts and feedback in public guest history.
- Claim effectiveness, OCR accuracy, or AI quality without measured technical or participant evidence.
- Present a proposed human-study protocol as completed research or imply that participants have been recruited.

## Approaches considered

| Approach | Tradeoff |
|---|---|
| Replace the current home and session flow with a standalone curriculum | Makes a course map easy to shape, but breaks the requested goal-to-evaluation loop and existing navigation/history continuity. Rejected. |
| Add a separate AI tutor area beside the current journey | Keeps AI loosely coupled, but fragments the path from a learner's goal through material, focus, retrieval, and evaluation. Rejected. |
| Extend the existing `station` entry into a curated, versioned path that starts the current study flow | Preserves route compatibility and session rules while allowing reviewed content to ship in batches. Chosen. |

For account-free AI, browser-only simulation would not provide real provider limits, while requiring registration conflicts with the request. Use a scoped guest credential with server-side limits and keep account credentials/paths separate.

## Design decisions

- Retain the legacy `station` route key as the default path entry. Other route IDs remain available so saved links continue to resolve.
- Store curated content in reviewed, versioned lesson batches with stable lesson IDs. Scope learner progress locally to the existing owner; do not conflate private material with curated lessons.
- Use transparent, optional adaptation from assessed answers only: after at least three completed evaluations and ten scored answers for a concept, suggest one difficulty step up when the mean is at least 80%, suggest a worked review at 50% or below, and otherwise keep the current level. XP, session duration, and unassessed behavior do not count as mastery. With less evidence, show the curated default without a personalized claim. Suggest a focus duration from the median valid study time of the last three completed sessions in that subject, rounded to five minutes and bounded to 5–25 minutes; without three sessions, use the curated lesson estimate. Learners can change every suggestion, and progress is never automatically moved backward.
- Keep private source extraction local until the learner confirms an AI action. Preserve current material-review and source-grounding requirements.
- Issue a 256-bit opaque guest AI token from `POST /api/v1/ai/guest/credential`; use `Authorization: GuestAI <token>` only on `/api/v1/ai/guest/*`. The token has no account user ID or database foreign key and cannot authenticate account routes.
- Keep guest AI state (session, decks, answer keys, start proof, and exercise solutions) private to that token principal in Redis with a TTL. Public guest history remains summary metadata in the existing guest scope and must not contain prompts or feedback. Explain guest AI state expiry where the UI establishes the session.
- Use separate issuance/request gates, atomic per-principal task budgets, and a configurable provider spend cap. Do not trust forwarded client IP headers while `trustProxy` is disabled.
- Only an opted-in AI quiz/exercise needs explicit AI session start; ordinary personal focus remains usable offline. Material read/summarize still requires the current consent step.
- Define metrics from existing focus/session rules and label them as activity. Treat question quality and OCR as technical measurements with explicit input provenance, and learning retention as a future participant study.

## Constraints

- Use the current React/Vite, Fastify, and storage/API patterns. No new dependency is planned.
- Preserve account auth, ownership checks, validation, rate limiting, privacy, and current AI grounding.
- Validate UI at desktop, tablet, and mobile widths; review light/dark themes and long Vietnamese copy.
- Production data changes, merge, and deployment require root review and the repository's required CI and approvals.

## Evidence boundary for #72

Build a repeatable technical pilot and document how it is run. Use synthetic or de-identified JSON examples for functional and question-output checks. OCR evaluation must use a held-out source rather than existing regression fixtures and report CER/WER, language, printed/handwritten status, layout, versions, limits, and failures. Compare repeatable tasks with a 25-minute timer plus ordinary review and one existing tool; use primary sources and verify current capabilities before describing them. Document independent human review for subjective question quality. A 7/30-day comparison needs stratified assignment, equal study time/materials, defined outcomes, uncertainty, attrition handling, real participants, and permissions. Leave participant results unreported until actually collected.
