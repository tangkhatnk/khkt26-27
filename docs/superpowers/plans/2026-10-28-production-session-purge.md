# Production Test Session Purge Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. The manager owns this operational lane; no worker deletes production data.

**Goal:** Remove only clearly identified test-session content from production while preserving real sessions, replay protection, journey progress and XP.

**Architecture:** Start with read-only aggregates. Build a private exact-ID/hash manifest and an encrypted, restorable backup of only the affected records. After root reviews the candidate evidence and restore proof, run one transaction-based one-off purge and verify each dependency.

**Tech Stack:** Railway PostgreSQL, existing Prisma schema/domain, private encrypted backup, one-off SQL/Node/Prisma maintenance code as justified by the discovered production shape.

**Spec:** `docs/superpowers/specs/2026-10-28-study-exercises-and-access-design.md` (section 6).

## Global Constraints

- User authorized analysis and deletion of selected test sessions; do not ask for credentials or expose IDs, goal text, emails, source text or secrets.
- Never infer “test” from a short duration or high distraction count alone; keep ambiguous sessions.
- No mutation until root reviews the exact private candidate manifest, dependencies and successful isolated restore evidence.
- The admin tombstone endpoint is not physical deletion. Remove exact session content and sensitive copies; retain only minimal owner/session replay metadata if required.
- Do not alter completed journey progress or XP. Do not delete active or genuine study data.
- No generic public/admin deletion endpoint; use a private one-off transaction with exact IDs and snapshot hashes.

## Review Focus

- Session content in `adventure_state.state.sessions` and `sessionOverrides` is addressed exactly once.
- `tester_runs`, public shares, admin audit snapshots and legacy relational session/quiz rows are checked by exact session ID.
- If content is physically removed, owner-scoped tombstone notification still blocks stale client replay without retaining a `Session` stub.
- Restore evidence reproduces the deleted state in an isolated database before production changes.
- Before/after counts distinguish physically deleted, already hidden, skipped and ambiguous records without outputting IDs.

---

### Task 1: Establish read-only production access and candidate aggregates

**Files/artifacts:** no repository changes; private notes/aggregate report outside Git only.

- [ ] Inspect available authenticated Railway connection methods; disclose only variable names and sanitized endpoint class, never values.
- [ ] In a read-only transaction/query, collect aggregate counts by actual study seconds, elapsed seconds, and distractions. Do not retrieve or print individual session rows.
- [ ] Compare the metric distribution with the request and define a conservative candidate rule. If metrics cannot distinguish a test from a short real session, leave it ambiguous.
- [ ] Privately prepare an exact candidate ID/hash manifest and dependency counts. No delete yet.

### Task 2: Backup and restore proof

**Files/artifacts:** encrypted backup and restore transcript stored outside the repository; maintenance script only in ignored/private scratch unless root approves keeping it.

- [ ] Back up the exact JSONB session state and all matching dependent rows identified by the manifest.
- [ ] Restore into an isolated database and verify hashes, counts, content and relational consistency.
- [ ] Give root the aggregate evidence, dependency map and restore result for review. Stop here until root approves the concrete deletion transaction.

### Task 3: Exact transaction purge and replay protection

**Files:** private one-off purge script; only add a minimal typed owner/session deletion ledger to the repo if the current snapshot/replay code cannot safely notify the correct owner after session removal.

- [ ] In one transaction, lock the AdventureState row and verify every manifest session hash/version before changing anything; abort on any mismatch.
- [ ] Remove the exact session object, sensitive override/audit/share copies, and matching `tester_runs`/legacy relational records. Preserve journey/person/group aggregates and XP.
- [ ] Preserve stale-client protection with an owner-scoped ID/removal ledger that contains no session metrics, goal, material or raw `Session` stub. Verify snapshot notification and save/grade rejection for the correct owner.
- [ ] Make reruns idempotent; write a minimal deletion receipt, never the removed content.
- [ ] Verify production after commit: deleted content absent, dependent row counts zero, ledger contains only approved metadata, progress/XP unchanged, and restore backup remains usable.

## Stop conditions and evidence

If safe read-only access cannot be established, finish other work and report the exact access blocker. If backup/restore or any candidate is ambiguous, do not execute its deletion. The final report includes only aggregate counts and verification evidence; private manifest and backup remain outside public GitHub and chat.
