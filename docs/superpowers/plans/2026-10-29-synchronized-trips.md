# Implementation plan: synchronized trip sessions

Scope: issue [#71](https://github.com/tangkhatnk/khkt26-27/issues/71), building on [#65](https://github.com/tangkhatnk/khkt26-27/issues/65) and [PR #66](https://github.com/tangkhatnk/khkt26-27/pull/66), against the approved [design](../specs/2026-10-29-viendu-study-trip-design.md).

## 1. Domain lifecycle and shared clock

- Add failing domain tests for plan lock, ready roster of 2–6, departure only when all currently joined roster members are ready (unused invitations do not block departure), no post-departure join, common server start/end and break schedule, and closure at the shared end.
- Extend the existing trip state narrowly with authoritative start/end scheduling. Keep existing group/history records readable and preserve owner, membership, expiry, and idempotent settlement invariants.
- Test independent early completion, already-bound late settlement after closure, and reconnect snapshots. Unobserved focus intervals must not be fabricated or credited.

## 2. API, persistence, and privacy

- Add route/service regressions for authentication, owner controls, ready transitions, single common departure time, post-start rejection, closure, and legacy-group explicit leave.
- Expose only shared trip metadata in roster snapshots. Keep goals, source text, answers, and solutions owner-private.
- Preserve each member's existing focus/distraction/break/device-clock rules and session binding. Ensure late uploads settle only against the bound member session and remain idempotent.

## 3. Lobby and active trip UI

- Add focused UI regressions for lobby readiness, locked plan, common countdown/remaining time, closed trip, and each participant finishing early.
- Implement the “Chuyến đi chung” one-trip flow using the existing snapshot/refresh mechanisms; no new realtime transport. Show that all invitees must be ready and that late joins are unavailable after departure.
- Keep solo journeys and old trip history available. Require a member to leave a legacy persistent group before starting or joining a new trip.

## 4. Validation and handoff

- Run relevant trip/domain/API/frontend tests, backend typecheck/build, web lint/typecheck/build, and database validation if schema changes.
- Inspect changed trip UI at 1440, 768, and 390 pixels in light/dark themes, including waiting, ready, error, active, reconnect, and closed states. Use two synthetic users to verify the same server start/end and late-sync behavior when the local environment permits.
- Review the final lane diff for private-field projection, no invented offline focus, unchanged legacy history, and idempotent settlement. Record test commands, exits, screenshots, and any two-user environment limit.

## Interface map

- Create a tagged synchronized trip at `POST /api/v1/adventure/trips/synchronized`; the shared record stores `mode`, `target`, optional `breakPlan`, and participant readiness, with no shared goal or topic.
- A joined member reserves their own `sessionId` via `POST /api/v1/adventure/trip/ready`. The owner launches through `POST /api/v1/adventure/trip/start`; the atomic response returns `tripStart: { sessionId, startedAt, endsAt }` and freezes every joined ready member's reservation.
- Snapshots return current `serverNow`, immutable shared `startedAt`/`endsAt`, and caller-only `ownSessionId`. Client clock conversion is bounded and preserves unobserved intervals as uncredited focus.
- The legacy `POST /api/v1/adventure/trips` and legacy trip start/settlement payloads continue to serve #66 records.

## Interfaces and ownership

- Keep lifecycle and settlement rules in `backend/src/adventure` and API boundaries in existing routes/services. Keep presentation in focused `src/adventure` helpers/components; touch `AdventureApp.tsx` only for trip/group regions and avoid quiz/exercise regions.
- Prefer optional/versioned lifecycle metadata or a narrow additive migration if persistence requires it. Do not replace the aggregate model or rewrite unrelated trip behavior.
