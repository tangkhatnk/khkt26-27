# Viễn Du study and trip improvements

## Goal

Improve the uploaded-material study flow, make post-session review optional, let learners choose an exact mix of AI exercise types, address the study-exercise Gemini failure, and make each shared trip one synchronized study session.

## Approved behavior

### Reviewed material

- Render extracted text with its available headings, lists, tables, spacing, and clear mathematical notation. Prefer the existing Markdown/LaTeX rendering path and KaTeX for supported formulas.
- Preserve the editable transcript and explicit user confirmation. Formatting must not mark uncertain extraction as reviewed. Editing continues to invalidate review and exercises prepared from that source.
- Preserve older saved transcripts. Do not guess ambiguous symbols or add unsupported content.

### Optional post-session review

- Let the learner skip post-session review questions or choose the existing 1–30 question range.
- Skipping must suppress quiz prefetch for that session while preserving focus, history, and material access. The learner can choose to generate questions from the later summary.
- Keep this control distinct from “Bỏ qua bài tập” in AI exercise preparation.

### Exercise composition and Gemini

- Let the learner choose 0–5 multiple-choice, true/false, short-answer, and essay questions independently; require a total of 1–20 and show the total before submission.
- Validate exact type counts, grounding, and the existing answer-privacy boundary. A changed composition under the same idempotency key must not return a set generated for a different mix.
- Preserve old exercise sets and scalar-count requests. Add only backward-compatible persistence needed to identify new compositions; keep existing source fingerprints unchanged.
- Diagnose the study-exercise provider path and fix confirmed causes. Use a bounded secondary model only for retryable failures. Do not retry permanent key, permission, model, or quota errors indiscriminately; keep cancellation, request limits, grounding checks, and atomic save behavior.
- Keep provider work bounded in batches of at most five questions under one request deadline. A failure or cancellation must not persist a partial exercise set.

### One shared trip session

- Each group trip is one session. The owner locks the destination, duration, and break schedule before inviting 2–6 participants. Each person prepares their own goal and material privately and marks ready.
- The trip can depart with at least two ready members only when every participant currently joined to the roster is ready. Unused invitation tokens do not block departure. The server freezes that roster and supplies a common start time and schedule. No participant can join after departure.
- The trip closes at the shared end time. A participant may finish early without ending anyone else's session. A participant reconnecting to an already-started trip sees the shared remaining time; time before the app can confirm focus is not credited.
- Preserve existing focus, distraction, scheduled-break, device-clock rollback, ownership, and settlement rules. Already-bound sessions may synchronize and settle idempotently after trip closure.
- Keep each person's goals, materials, answers, and solutions private. Preserve existing trip and group history. A member of a legacy persistent group must explicitly leave before creating or joining a new shared trip.

## Decisions and tradeoffs

- Extend the existing trip and AdventureState model instead of introducing a parallel group system. This reuses current invitations, membership checks, and history while keeping old records readable; synchronization state is limited to a trip's lifecycle.
- Use a server-authoritative start/end clock with the existing refresh/snapshot mechanisms. This provides a shared schedule without adding a separate realtime transport. Reconnects use the common remaining time and do not invent focus credit.
- Keep local extraction and review confirmation as the source of truth; AI may improve structure, but cannot silently certify OCR or repair ambiguous content.
- Store the selected exercise composition as backward-compatible request identity. A schema migration is justified only to distinguish exact mixes on retries while retaining old rows.
- Use bounded provider fallback based on classified errors. This improves transient failures without masking invalid credentials, permission, model, or quota problems.

## Issues

- [#67 — Render extracted image text as a structured reviewed document](https://github.com/tangkhatnk/khkt26-27/issues/67)
- [#68 — Make post-session review questions optional](https://github.com/tangkhatnk/khkt26-27/issues/68)
- [#69 — Diagnose and fix study-exercise Gemini failures](https://github.com/tangkhatnk/khkt26-27/issues/69)
- [#70 — Choose AI exercise counts independently by type](https://github.com/tangkhatnk/khkt26-27/issues/70)
- [#71 — Start group trips as one synchronized study session](https://github.com/tangkhatnk/khkt26-27/issues/71)
- Existing trip foundations: [#65](https://github.com/tangkhatnk/khkt26-27/issues/65) and merged [PR #66](https://github.com/tangkhatnk/khkt26-27/pull/66). Existing exercise-flow foundation: [#58](https://github.com/tangkhatnk/khkt26-27/issues/58).

## Validation

Add regression coverage for structured rendering without implicit review, skipped-review prefetch fencing, exact exercise composition and idempotency, provider classification/fallback/cancellation, synchronized departure and closure, reconnection without invented credit, early individual completion, late idempotent settlement, legacy compatibility, and privacy. Run the relevant frontend and backend validation, then inspect the changed UI at 1440, 768, and 390 pixels in light and dark themes, including loading, error, skipped, and populated states. Report live Gemini results separately from synthetic provider tests.
