# AGENTS.md

This file defines the working rules for coding agents operating in the Viễn Du repository.

It is a durable repository policy, not a task prompt and not a complete product specification. Follow it together with the current task, the repository's code, tests, schemas, CI, and accepted maintainer decisions.

---

## 1. Authority, scope, and source of truth

Use the following order when resolving ambiguity:

1. The current maintainer-approved task or explicit instruction.
2. Current code, tests, schemas, contracts, and CI behavior.
3. Repository documentation that matches the current implementation.
4. Accepted issues, pull requests, and recorded project decisions.
5. Older comments, historical notes, or assumptions.

Do not infer authority from an unrelated request.

- A review request is not permission to implement changes.
- A bug-fix request is not permission to redesign the system.
- A UI request is not permission to change product semantics.
- A research request is not permission to mutate the repository.
- A request to change one subsystem is not permission to clean up adjacent technical debt.
- An accepted change in one task does not automatically become authorization for unrelated future changes.

When current code and written documentation disagree, investigate before changing behavior. Do not silently choose whichever source is easier.

If a problem is outside the approved task, report it or open a separate issue when policy allows. Do not silently expand scope.

---

## 2. Project overview

Viễn Du is a learning and focus application built around a 2D train-journey experience.

The current product consists of:

- a React + Vite web application as the primary user experience;
- an Electron Windows package using the same built web application;
- a Fastify backend;
- PostgreSQL and Redis in production;
- PGlite and an in-process Redis mock for local development;
- Prisma for database access and migrations;
- Gemini-backed AI features for quiz generation, study-guide generation, and optional document/image reading;
- local document parsing and OCR for supported files.

Do not treat historical mobile/Expo code or naming as the current architecture unless the current repository still uses it.

---

## 3. Repository map

Use the existing ownership boundaries before creating new ones.

### Frontend

- `src/main.tsx`
  - application entry point;
  - mounts the adventure application.

- `src/adventure/`
  - journey UI;
  - focus/session presentation;
  - navigation;
  - profile/admin/history UI;
  - browser-side study flow;
  - local presentation and interaction state.

- `src/material/`
  - local material extraction;
  - OCR;
  - document-reading helpers.

- `src/services/`
  - browser credentials;
  - shared API contracts;
  - network/API access.

### Backend

- `backend/src/`
  - Fastify server;
  - authentication;
  - API routes;
  - AI providers;
  - storage;
  - realtime behavior.

- `backend/src/adventure/`
  - journey/group/session domain behavior;
  - domain invariants;
  - trip settlement and progress rules.

- `backend/prisma/`
  - schema;
  - migrations;
  - seed data.

### Desktop

- `desktop/`
  - Electron shell;
  - desktop security policy;
  - `viendu://app` protocol;
  - Windows packaging.

### Tooling

- `scripts/`
  - local startup;
  - production startup;
  - web post-build;
  - PDF/OCR worker preparation.

- `tests/`
  - frontend/web tests using Node's test runner.

- `backend/tests/`
  - backend tests using Vitest.

- `desktop/tests/`
  - desktop tests using Node's test runner.

Do not place business logic in a component or layer merely because it is convenient. Prefer the natural owner that already exists.

---

## 4. Canonical toolchain

The repository currently uses separate dependency trees for the root app, backend, and desktop package.

It is not a single npm workspace.

Use the corresponding install commands:

```bash
npm ci
npm --prefix backend ci
npm --prefix desktop ci
```

Canonical runtime/tooling expectations:

- Node.js 24 for CI and normal repository validation;
- npm;
- React 19;
- Vite 8;
- TypeScript with strict checking;
- Fastify 5;
- Prisma 6;
- Vitest for backend tests;
- Node's built-in test runner for web and desktop tests;
- Electron 44 for desktop packaging.

Do not switch package managers without an explicit task.

Do not add a repository-wide formatter merely because one is absent.

Do not run broad formatting tools over unrelated files.

---

## 5. Mandatory Git workflow

All repository changes must go through:

```text
branch -> pull request -> review/CI -> merge
```

Direct commits or pushes to `main` are not allowed.

Every task must use a short-lived branch created from an up-to-date `main`.

Preferred branch names:

```text
fix/<short-description>
feat/<short-description>
docs/<short-description>
test/<short-description>
ci/<short-description>
refactor/<short-description>
chore/<short-description>
```

Do not use AI-branded branch names such as:

```text
claude/*
codex/*
chatgpt/*
agent/*
ai/*
```

Do not force-push `main`.

Do not delete or rewrite shared history outside an explicitly authorized history-cleanup task.

Delete short-lived task branches after merge when repository workflow permits.

---

## 6. Issue policy

Open or link an issue before implementing:

- confirmed bugs;
- features;
- enhancements;
- security-sensitive changes;
- authentication changes;
- privacy/data-flow changes;
- API-contract changes;
- database-schema changes;
- architecture changes;
- significant infrastructure changes.

A separate issue is usually not required for:

- small documentation corrections;
- test-only maintenance;
- CI maintenance with a clear, narrow scope;
- tiny internal refactors that do not change behavior;
- dependency maintenance already represented by an automated dependency PR.

Check for an existing issue before opening a duplicate.

An issue should describe the problem or desired behavior before prescribing a large implementation unless the implementation itself is the approved requirement.

---

## 7. Commit policy

Use Conventional Commit-style subjects where practical:

```text
feat: add ...
fix: preserve ...
docs: clarify ...
test: cover ...
ci: validate ...
refactor: extract ...
chore: update ...
```

A commit should represent a logical change, not an iteration of agent work.

Avoid subjects such as:

```text
fix
fix2
oops
wip
try again
misc changes
improvements
final
final fix
```

Do not preserve meaningless repair commits merely because they happened during development.

Before PR review, squash/fixup local task-branch noise when appropriate.

Do not combine unrelated changes in one commit just to reduce commit count.

Do not invent artificial commit boundaries to make a trivial task look substantial.

---

## 8. Scope discipline

Prefer the smallest correct patch.

Do not:

- refactor adjacent modules without a task need;
- rename legacy identifiers just because they look old;
- upgrade dependencies as side work;
- rewrite architecture because a local implementation feels inelegant;
- convert a narrow UI task into a design-system migration;
- normalize all styling while fixing one component;
- change API or database contracts as collateral work;
- remove legacy paths merely because they appear unused without proving they are safe to remove;
- change deployment behavior as part of unrelated work.

Known technical debt is not standing authorization to fix it.

If a task exposes an unrelated problem, report it separately.

---

## 9. Read before editing

Before meaningful changes:

1. Read the directly relevant implementation.
2. Read the relevant tests.
3. Read schemas/contracts when data or APIs are involved.
4. Look for an existing implementation pattern before introducing a new one.
5. Inspect history only when needed to understand a regression, compatibility constraint, or previous decision.

Do not require reading the entire repository for a small task.

Do not guess an API or behavior when the repository already contains the answer.

---

# Engineering rules

## 10. Frontend architecture

The browser application is the primary product surface.

Electron packages the same built application and therefore shares most frontend behavior.

Keep presentation, state, and domain concerns separated where the repository already has natural boundaries.

`AdventureApp.tsx` is already very large. Do not continue adding unrelated business/domain logic to it when a clear existing helper, service, domain module, or focused component is the better owner.

However, do not perform a broad `AdventureApp.tsx` rewrite merely because the file is large. Extraction must serve the current task or a separately approved refactor.

Prefer reusable components when a real repeated interaction or presentation pattern exists.

Do not create speculative abstractions for one-off elements.

Use semantic HTML first. ARIA supplements semantic elements; it does not replace them.

A visual change must not silently alter:

- focus timing;
- distraction accounting;
- study/session persistence;
- material-review state;
- quiz ownership;
- authentication;
- sync behavior;
- group behavior.

---

## 11. Visual design quality

Existing UI behavior is authoritative where it represents product behavior.

Existing visual styling is not automatically a quality target.

Agents may improve visual quality within an approved UI task without preserving clearly weak presentation patterns.

Aim for:

- clear hierarchy;
- readable typography;
- deliberate spacing;
- consistent control sizing;
- clear primary/secondary/destructive actions;
- coherent empty/loading/error/success states;
- layouts that are intentionally responsive rather than merely wrapping;
- restrained use of gradients, shadows, radii, and decoration;
- visual consistency across related surfaces.

Avoid "card soup": not every piece of information needs a rounded card.

Do not create multiple competing visual systems inside the same feature.

Reuse existing semantic tokens when they are suitable. Introduce new tokens when they represent a real reusable role, not just to avoid typing a literal twice.

Do not blindly preserve weak hard-coded styling when a UI task explicitly asks for improvement.

Do not turn Viễn Du into a generic SaaS dashboard unless the task explicitly calls for that direction.

Keep the train/journey identity where it supports the product, but do not use theme language or decoration everywhere.

---

## 12. Iconography

Do not use Unicode glyphs, emoji, or arbitrary font characters as replacement UI icons.

Examples of patterns not to add:

```text
▥
▣
♧
⌁
◷
✎
```

Use a real icon system when icons are appropriate.

Agents may choose a suitable library such as:

- Lucide;- Phosphor Icons;
- another maintained equivalent.

No single icon library is mandatory.

When choosing one:

- prefer a library already used by the relevant surface;
- keep one coherent icon language inside the same feature/surface;
- avoid mixing several icon libraries without a clear reason;
- import icons individually when possible;
- preserve tree shaking;
- avoid runtime CDN icon dependencies;
- keep offline web and Electron packaging in mind;
- consider maintenance, license, bundle size, and browser support.

Custom SVG is appropriate for:

- product illustrations;
- logos;
- train/map/domain-specific artwork;
- visual assets that general icon libraries do not express well.

Decorative icons must be hidden from assistive technology when appropriate.

Icon-only controls must have an accessible name.

Do not rely on an icon alone to communicate critical state when text or another accessible signal is needed.

---

## 13. Typography and spacing

Use a coherent typography hierarchy.

Avoid producing a page where every section invents a new font size and weight.

Do not overuse very small text for meaningful content.

Uppercase text should be limited to appropriate labels, eyebrows, or metadata.

Use natural Vietnamese line lengths and line heights.

Test long Vietnamese text, not only short English-like labels.

Avoid unnecessary truncation of information the user needs.

Use a consistent spacing rhythm instead of arbitrary values scattered through each new component.

Do not introduce a full CSS framework solely to obtain spacing consistency.

---

## 14. Frontend libraries

Agents may introduce a frontend dependency when it solves a real requirement better than custom code.

Examples that may be reasonable:

- icon libraries;
- accessibility primitives;
- charting libraries;
- focused parsing/formatting utilities.

Do not automatically introduce large UI frameworks such as:

- Material UI;
- Ant Design;
- Chakra;
- Bootstrap;
- a full Tailwind migration;
- a repository-wide shadcn migration;

merely to make an isolated screen look better.

If a large UI/design-system dependency would materially benefit a broad approved redesign, propose it explicitly and explain the tradeoffs before treating it as authorized.

For every new dependency consider:

- maintenance quality;
- bundle impact;
- tree shaking;
- browser support;
- Electron compatibility;
- offline behavior;
- existing dependency overlap;
- license.

Do not add a large dependency to solve a trivial problem.

---

## 15. Interaction quality and accessibility

Interactive controls must have appropriate:

- hover state;
- focus state;
- active state;
- disabled state.

Do not remove visible keyboard focus indicators for aesthetic reasons.

Do not use clickable `div` elements when `button`, `a`, or another semantic element is appropriate.

Do not make essential interaction hover-only.

Touch controls must remain usable on mobile-sized screens.

Respect `prefers-reduced-motion`.

Animation should support:

- state transition;
- spatial continuity;
- meaningful feedback;
- the journey experience.

Avoid decorative motion that continuously pulses, bounces, floats, or distracts without purpose.

Do not use animation to hide missing loading/error feedback.

---

## 16. Visual validation

A UI task is not fully validated merely because TypeScript and unit tests pass.

When tooling permits, verify the changed UI at representative widths, including approximately:

```text
1440px desktop
768px tablet
390px mobile
```

Check relevant states such as:

- light theme;
- dark theme;
- empty state;
- populated state;
- loading state;
- error state;
- disabled state;
- long Vietnamese content.

Do not claim visual correctness if the UI was not actually viewed.

If visual verification was not possible, state that clearly in the PR.

---

## 17. Focus and session invariants

Do not change focus/session semantics outside an explicit task.

Current important behavior includes:

- wall-clock time continues while away;
- scheduled breaks are distinct from distractions;
- leaving the focus surface counts as a distraction according to the current event-deduplication rules;
- scheduled break time does not count as valid study time;
- valid study time determines focus contribution/XP behavior;
- returning from an away state resumes according to the current session rules;
- device-clock rollback handling must not silently corrupt a session.

Do not simplify these rules because a UI change appears easier with different semantics.

Use current tests and domain logic as the detailed authority.

---

## 18. Material, PDF, and OCR invariants

The web build uses local/same-origin document-processing assets.

Preserve:

- same-origin PDF.js worker behavior;
- local OCR worker/WASM/language data;
- Vietnamese and English OCR support;
- file/page/size limits unless explicitly changed;
- cancellation behavior;
- reviewed-source state;
- the distinction between local extraction, AI reading, and user-confirmed source text.

`scripts/prepare-material-worker.mjs` verifies important version coupling.

Do not upgrade `pdfjs-dist`, Tesseract, related core packages, or OfficeParser independently without validating the complete material pipeline.

Do not send files or extracted content to an AI provider unless the current product flow explicitly allows it.

A source that still requires review must not silently become a verified quiz source.

---

## 19. AI/provider rules

AI provider output is untrusted external input.

Validate structured output.

Do not weaken schema or grounding checks merely to accept more provider responses.

For source-grounded quizzes, preserve the current requirement that questions be grounded in the reviewed source.

Do not silently add unsupported facts from model knowledge when the product expects source grounding.

Do not expose provider keys to frontend code.

Do not log private study material, credentials, or full sensitive prompts merely for debugging convenience.

Provider fallback behavior must remain bounded and explicit.

Do not claim AI-generated study material is verified unless the user/product flow actually verified it.

---

## 20. Backend and API rules

Keep validation at external boundaries.

Preserve:

- authentication;
- ownership checks;
- authorization;
- rate limiting;
- request validation;
- error contracts;
- account scoping.

Do not bypass auth or owner checks to make a test easier.

Do not broaden CORS, permissions, or public API exposure as unrelated work.

Do not change API request/response contracts without an issue and explicit task scope.

WebSocket authentication and rate-limiting behavior must not be weakened silently.

Use the existing domain layer when the rule belongs to the domain.

Do not duplicate critical domain rules independently in several routes.

---

## 21. Database and migration rules

Use Prisma migrations for production schema changes.

Do not use `prisma db push` as a production migration mechanism.

Do not modify an already-applied historical migration merely to make migration history look cleaner.

Create a new migration for a new schema change.

Preserve existing data unless data removal is explicitly part of an approved migration.

Treat changes to the current AdventureState aggregate and session/history persistence as architecture/data changes, not incidental refactors.

Do not normalize or replace the current aggregate model in unrelated work.

Migration changes require appropriate database/backend validation.

---

## 22. Electron and desktop security

The desktop shell is a security boundary.

Preserve unless explicitly authorized:

```text
nodeIntegration: false
contextIsolation: true
sandbox: true
webSecurity: true
```

Also preserve the security intent of:

- the `viendu://app` custom protocol;
- protocol path validation;
- navigation restrictions;
- denied unexpected permissions;
- CSP;
- blocked arbitrary window creation.

Do not add Node access, IPC bridges, relaxed CSP, remote navigation, or new permissions merely because they simplify implementation.

Desktop behavior must continue to work offline where the packaged web bundle currently permits it.

---

## 23. Secrets and privacy

Treat every `VITE_*` variable as public build-time configuration.

Never place secrets in frontend/Vite variables.

Backend secrets remain backend-only.

Do not commit:

- `.env` files;
- API keys;
- JWT secrets;
- access tokens;
- private keys;
- user credentials.

Do not place real user study materials, email addresses, account IDs, or other private data into:

- tests;
- fixtures;
- screenshots;
- issues;
- pull requests;
- logs;
- documentation.

Use synthetic data.

Do not expand what becomes public in trip history or reports without explicit product approval.

---

## 24. Dependency policy

Prefer existing dependencies and platform APIs when they are sufficient.

Do not add a dependency solely to avoid writing a few clear lines of code.

Do not upgrade unrelated dependencies as part of a feature or bug fix.

Dependency changes must include the relevant lockfile.

For dependencies tied to build workers, Electron, OCR, PDF handling, database generation, or production runtime, validate the complete affected pipeline.

Do not remove a dependency until usage, generated assets, build tooling, tests, and production paths have been checked.

---

# Testing and validation

## 25. Validation matrix

Run validation appropriate to the changed area.

### Frontend

```bash
npm run lint
npm run typecheck
npm run test:web
```

Run:

```bash
npm run build:web
```

when the change can affect:

- production web output;
- assets;
- material workers;
- service worker behavior;
- desktop web packaging;
- Vite build behavior.

### Backend

```bash
npm --prefix backend run db:generate
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run build
```

### Desktop

When desktop behavior or shared packaged behavior is affected:

```bash
npm --prefix desktop run typecheck
npm --prefix desktop test
```

Package the Windows app when the task specifically affects packaging/release behavior or when required by the task.

### Cross-layer changes

Run both sides when changing:

- shared contracts;
- auth flows;
- session semantics;- quiz behavior;
- persistence;
- material flow;
- API integration.

Do not perform expensive unrelated validation merely as ritual.

Do not omit relevant validation merely because the change looks small.

---

## 26. Bug-fix policy

Confirm the bug before fixing it.

Prefer root-cause fixes over symptom masking.

Add or update a regression test when practical.

A useful regression test should fail against the buggy behavior and pass after the fix.

Do not change a correct test merely to make incorrect code pass.

Do not weaken assertions to make CI green.

Do not fix speculative bugs without evidence.

If the bug cannot be reproduced, say so and document what was checked.

---

## 27. Test quality

Test observable contracts and important domain behavior.

Avoid tests that merely mirror implementation details.

Do not mock the exact function whose behavior the test is supposed to validate.

Do not add meaningless assertions for coverage.

Avoid giant snapshots when focused assertions express the contract better.

Do not use fixed sleeps to hide a race condition when proper synchronization is available.

Do not silently update expected output when the implementation may be wrong.

Test security/privacy invariants when the task touches them.

---

## 28. CI policy

CI failures must be investigated.

Do not:

- disable a failing test;
- skip a required check;
- mark a test as flaky without evidence;
- weaken lint/typecheck rules solely to merge;
- change CI to stop running the failing area;
- merge known failing code.

The final commit/HEAD presented for review should be the code that was actually validated.

Do not claim checks passed if they were run against an earlier commit before later edits.

---

# Code quality rules

## 29. Avoid speculative abstraction

Do not build a framework for requirements that do not exist.

A small amount of clear duplication is often better than a premature generic abstraction.

Extract code when it:

- has real reuse;
- clarifies the domain;
- isolates an important boundary;
- materially simplifies the current task.

Do not create generic factories/managers/providers merely to make code look architected.

Do not add configuration options "for the future" without a current requirement.

Do not generalize public APIs for hypothetical callers.

---

## 30. Avoid defensive-code spam

Validate untrusted/external input at the correct boundary.

Once an internal invariant is established, do not repeat redundant null/type checks through every layer.

Do not swallow errors with empty `catch` blocks when the error matters.

Do not convert programmer errors into silent fallback behavior.

Fallbacks must be intentional and observable when failure matters.

---

## 31. Comment quality

Comments should explain why, constraints, or non-obvious behavior.

Avoid comments that merely translate the next line of code.

Bad:

```ts
// Increment count
count++;
```

Useful:

```ts
// Count one departure even when blur and visibilitychange fire together.
```

Avoid vague comments such as:

```text
Handle edge cases
Improve robustness
Optimize performance
```

unless they explain the concrete edge case, invariant, or performance constraint.

---

# Human-facing writing rules

## 32. Product copy

User-facing Vietnamese should sound natural and direct.

Functional copy should prioritize clarity over theme.

Prefer:

```text
Tải tài liệu
Thử lại
Đăng nhập
Xóa tài liệu
```

over forced thematic wording for routine actions.

Journey/train language is appropriate for:

- journey presentation;
- onboarding;
- selected headings;
- empty states;
- map/trip concepts.

Do not force every button, error, or system message into train metaphors.

Avoid:

- excessive exclamation marks;
- unnecessary ellipses;
- decorative emoji;
- motivational filler;
- overly cute wording in error states;
- claims of certainty that the system cannot support.

Error messages should explain what failed and, when possible, what the user can do next.

Do not blame the user.

Do not describe unverified AI output as accurate, verified, or authoritative.

---

## 33. Human GitHub writing style

Public repository text should read like it was written by a competent maintainer, not generated from an agent transcript.

This applies to:

- commit messages;
- pull requests;
- issues;
- issue comments;
- review replies;
- release notes;
- changelogs;
- documentation.

Prefer concrete statements about behavior.

Avoid generic AI-style phrases such as:

```text
This change introduces a comprehensive solution...
This implementation enhances the robustness...
I investigated the codebase and identified...
This provides a seamless experience...
This creates a more maintainable and scalable architecture...
Successfully implemented...
All requested changes have been completed...
```

Words such as the following are not banned, but should be used only when they add concrete meaning:

```text
robust
comprehensive
seamless
streamlined
enhanced
powerful
intuitive
scalable
maintainable
future-proof
production-ready
holistic
leverages
significantly
optimized
modern
clean
```

Prefer:

```text
Fall back to the secondary Gemini model when the primary request times out.
```

over:

```text
Improve quiz generation with a robust and streamlined fallback mechanism.
```

Write what changed, not how impressive the change is.

---

## 34. Do not narrate agent work

Do not publish the agent's internal workflow.

Avoid public text such as:

```text
First I inspected...
Then I searched...
I noticed...
I tried...
After several attempts...
The agent...
```

Do not include:

- chain-of-thought;
- tool logs;
- search narration;
- failed approaches that no longer matter;
- progress diaries;
- meta discussion about being an AI.

Public text should describe the final problem, decision, change, and validation.

---

## 35. Pull request writing

Keep PRs concise.

Default structure:

```text
## What

## Why

## Linked issue

Closes #

## Validation

## Risk / notes
```

Omit empty sections when the repository template permits it.

`What` describes the final diff.

`Why` describes the real problem or requirement.

`Validation` lists only checks that actually ran.

Do not write a long chronological story.

Do not claim:

```text
all tests pass
```

unless all relevant tests actually ran and passed.

For UI changes, include screenshots or state that visual verification was not performed when appropriate.

---

## 36. Issue writing

Describe the problem before prescribing an unnecessary implementation.

A bug issue should normally include:

- summary;
- affected area;
- current behavior;
- expected behavior;
- reproduction/evidence;
- environment when relevant;
- acceptance criteria.

An enhancement should normally include:

- problem/user need;
- desired behavior;
- why it matters;
- acceptance criteria;
- non-goals when useful.

Do not inflate small issues into multi-page design documents.

Do not paste private data into issues.

---

## 37. Commit-message wording

Commit subjects should describe the actual logical change.

Good:

```text
fix: preserve reviewed material when notes change
feat: prepare quiz questions during focus
test: cover expired refresh token rotation
docs: clarify local OCR limits
ci: validate desktop changes on pull requests
```

Avoid vague subjects:

```text
feat: implement comprehensive enhancements
fix: improve robustness and reliability
refactor: streamline application architecture
chore: miscellaneous improvements
```

Do not use:

```text
successfully
complete
comprehensive
final
perfect
```

as filler.

Use a commit body only when the reason or compatibility constraint is not clear from the subject/diff.

---

# History rules

## 38. Normal task-branch history cleanup

Agents may clean up the history of the current unmerged task branch.

The goal is for the final branch history to represent logical changes, not every failed attempt made during development.

Example development history:

```text
fix quizfix test
oops
fix lint
try again
```

may be rewritten into:

```text
fix: invalidate prepared quiz after source edits
test: cover quiz invalidation after source edits
```

or one logical commit if that better represents the change.

Permitted targets:

- local commits for the current task;
- the current unmerged task branch;
- a PR branch when rewriting that branch is allowed by the repository workflow.

Do not rewrite:

- `main`;
- tags;
- release commits;
- another person's active branch;
- shared history outside the task.

When rewriting an already-pushed task branch, use:

```bash
git push --force-with-lease
```

not plain `--force`.

Preserve real authorship where practical.

Do not add fabricated AI attribution such as:

```text
Co-authored-by: ChatGPT
Co-authored-by: Claude
Generated-by: ...
```

unless the maintainers explicitly require it.

---

## 39. One-time repository history cleanup

The repository may undergo an explicitly approved one-time cleanup because the existing commit history is noisy or poorly structured.

This is fundamentally different from ordinary task-branch cleanup.

Do not begin a repository-wide history rewrite unless the repository maintainer explicitly authorizes the rewrite and its intended scope.

Before any destructive rewrite:

1. Fetch all remote refs.
2. Ensure the working tree is clean.
3. Record the original `main` commit SHA.
4. Create a durable backup reference, tag, or backup branch that points to the original history.
5. Record existing release tags and important branch heads.
6. Identify commits that represent real product milestones, migrations, releases, security changes, or externally referenced work.
7. Decide what should be preserved, combined, renamed, or dropped before executing the rewrite.

The objective is not to make history artificially perfect.

The objective is to remove meaningless development noise while preserving truthful project evolution.

### Preserve meaningful milestones

Prefer to retain logical milestones such as:

- major feature introductions;
- database migrations;
- meaningful architectural transitions;
- mobile removal or platform transitions;
- public-history changes;
- authentication/security changes;
- release/version milestones;
- behavior changes that matter for regression archaeology.

Do not collapse the entire project into one "initial commit" merely to make the graph look clean.

Do not create dozens of fictional historical commits that never existed as logical development stages.

### Do not falsify history

Never invent:

- fake implementation dates;
- fake authors;
- fake review events;
- fake issue references;
- fake release events;
- fake test results;
- fake historical motivations.

Rewritten commit messages may clarify what a real historical change did, but they must not fabricate events or intent that cannot be supported by the original history/diff.

### Preserve authorship and provenance

Preserve original authorship where reasonably possible.

If several commits from different people are combined, do not silently assign all historical work to the agent performing the rewrite.

If preserving exact author metadata is impractical for a particular squash, document the mapping/decision before finalizing the rewrite.

### Maintain a mapping

For a substantial rewrite, produce a temporary mapping outside the permanent public history or in an explicitly approved migration note that records:

```text
old commit -> new commit/logical milestone
```

for important commits.

This is especially useful when old commit SHAs appear in:

- issues;
- documentation;
- deployment records;
- discussions;
- bug reports;
- external links.

Do not permanently clutter the repository with rewrite-planning files unless maintainers want them retained.

### Tags and releases

Do not silently move existing release tags.

If a rewrite requires retagging, that must be explicitly approved.

Record the old tag target before moving any tag.

Do not rewrite published release history casually.

### Force update

Only after the cleaned history has been reviewed locally and validated should the authorized maintainer update the remote history.

Use lease-protected force updates where Git permits:

```bash
git push --force-with-lease
```

Never use a blind force push when a safer lease-protected update is possible.

After the rewrite, verify:

- `main` points to the intended cleaned history;
- required files are present;
- tags point where intended;
- builds/tests still work;
- no required migration or artifact was lost;
- branch protection/CI still behaves correctly;
- collaborators know they must rebase/reclone/reset old local clones.

A repository-history rewrite is complete only when the cleaned graph is both truthful and operationally safe.

---

## 40. Known technical debt is not automatic scope

The repository contains historical or legacy details that may be imperfect.

Examples may include:

- old `pomodoro-*` naming;
- legacy provider paths;
- CORS/config inconsistencies;
- version-number inconsistencies;
- large modules;
- the current adventure-state aggregate;
- old template/license remnants.

Do not treat this list as a backlog you are automatically authorized to fix.

Each change still requires the appropriate task/issue.

---

# Self-review and completion

## 41. Mandatory final self-review

Before marking a PR ready, read the complete final diff.

Check for:

- scope creep;
- unrelated formatting;
- accidental generated files;
- dead code;
- debug logging;
- temporary comments;
- stale TODOs;
- security regressions;
- privacy regressions;
- weakened tests;
- missing validation;
- documentation that no longer matches behavior;
- dependency changes that were not required.

Do not consider incremental review while coding a substitute for final-diff review.

---

## 42. Definition of done

A task is done when:

- the approved scope is implemented;
- relevant tests pass;
- relevant type/lint/build checks pass;
- known in-scope bugs are resolved or explicitly documented;
- the final diff has been self-reviewed;
- required documentation/contracts are updated;
- required CI is green on the final code;
- unverified areas are honestly identified;
- the PR is concise and ready for human review.

Do not claim work is complete when relevant validation has not happened.

---

## 43. Forbidden actions

Do not:

- push directly to `main`;
- force-push `main` outside an explicitly authorized repository-history rewrite;
- merge with required CI failing;
- disable tests to make CI pass;
- weaken assertions solely to make a change pass;
- commit secrets or real private user data;
- make silent breaking API/data changes;
- make unrequested architecture rewrites;
- run broad formatting rewrites over unrelated code;
- invent test results;
- claim visual validation that was not performed;
- claim "no regressions" without evidence;
- fabricate historical commits or motivations;
- hide known in-scope failures;
- describe speculative behavior as verified fact.

---

## 44. Final operating principle

Prefer:

```text
evidence over assumption
small correct patches over broad rewrites
clear code over clever abstraction
real validation over confident wording
human maintainership over agent narration
```

When something is unclear, inspect the repository and its current behavior.

When something is outside scope, report it instead of silently expanding the task.