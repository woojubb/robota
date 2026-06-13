---
status: done
type: BEHAVIOR
tags: [cli, typescript]
---

# CLI-073: `--fork-session` restores conversation context (conform code to SPEC)

## Problem

Discovered while implementing CLI-063 (2026-06-12): the framework fork path
(`packages/agent-framework/src/interactive/interactive-session-restore.ts:85`,
`if (!forkSession && record.messages)`) deliberately skips injecting the resumed session's
conversation messages when `forkSession: true`. A fork gets a new session id and a fresh
model context — `robota -p "Remember 42"` then
`robota -p "What number?" -r <id> --fork-session` cannot answer 42. Identical in TUI and
print mode.

This is a SPEC violation, not a design question: `packages/agent-cli/docs/SPEC.md` (Session
Resolution Logic, `--fork-session` row, ~line 990) promises "Creates a new session (fresh
UUID) but **restores context** from the resumed session", and help text says "Fork the
current session into a new independent session" — the git-branch mental model. Per the
spec-is-SSOT rule the code must be brought to the SPEC.

## Architecture Review

### Affected Scope

- `packages/agent-framework` / `src/interactive/interactive-session-restore.ts` — remove
  the `!forkSession` condition so `pendingRestoreMessages` flows into the async injection
  (`interactive-session-init.ts:286-289`) on fork too
- `packages/agent-framework` / `src/interactive/__tests__/interactive-session.test.ts`
  (:552-576) — the test currently pinning skip-on-fork is updated to assert injection
- `packages/agent-framework` / `docs/SPEC.md` — interactive restore contract row (fork =
  new id + restored messages)
- `packages/agent-cli` — no code change (both TUI and print consume the framework path);
  SPEC row already states the target behavior

### Alternatives Considered

1. **Conform code to SPEC: fork injects prior messages (chosen).**
   - Pro: honors the written contract (spec-is-SSOT rule); matches the help text and the
     common git-branch mental model; the new-session-id logic
     (`interactive-session-init.ts:114`) is orthogonal and untouched; history append-only
     invariant preserved — the original record is never modified, messages are copied into
     the new session.
   - Con: forks of huge sessions start with a full context (cost) — inherent to
     branch-with-context semantics and identical to plain resume cost.
2. **Re-decide the SPEC: document fresh-context forks ("transcript copied for display;
   model starts fresh").**
   - Pro: zero code change.
   - Con: makes fork indistinguishable from "new session" except TUI transcript display —
     no user value over `robota` without flags; contradicts help text; rewriting the SPEC
     to match code during verification is the exact anti-pattern the
     never-modify-SPEC-during-verification rule names.

### Decision

Alternative 1. The driving trade-off is contract integrity vs zero-diff: the SPEC row
predates the code gap and describes the only semantics that give fork meaning beyond "new
session"; the fix is removing one condition so the existing restore machinery runs on fork.
Fork remains append-only-safe: new UUID, source record untouched.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `forkSession` 분기 전수 grep: 메시지 주입 스킵(:85)과 신규
      세션 id 발급(`interactive-session-init.ts:114`) 두 곳뿐, 후자는 본 건 무관 확인;
      TUI/print 양쪽 모두 동일 framework 경로 소비 확인(CLI-063에서 print 경로 정렬됨);
      기존 테스트 :552-576이 skip 동작을 고정 중 — 갱신 대상에 포함
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. `interactive-session-restore.ts:85`: `if (!forkSession && record.messages)` →
   `if (record.messages)` — `pendingRestoreMessages` now flows to the async injection for
   forks as well.
2. Update `interactive-session.test.ts:552-576` to assert: fork injects prior messages,
   new session id differs, original record byte-identical after fork.
3. Framework SPEC.md restore contract row updated to state fork = fresh UUID + restored
   messages (matching the CLI SPEC promise).

## Affected Files

- `packages/agent-framework/src/interactive/interactive-session-restore.ts`
- `packages/agent-framework/src/interactive/__tests__/interactive-session.test.ts`
- `packages/agent-framework/docs/SPEC.md`

## Completion Criteria

- [x] TC-01: fork restore injects the source session's messages — forked session's context
      state reports the restored messages (`usedTokens > 0` / messages present)
- [x] TC-02: forked session id differs from the source id (fresh UUID preserved)
- [x] TC-03: source session record is unmodified after fork (append-only invariant —
      byte-identical store file). _Correction during implementation (within the approved
      Decision): byte-identity holds at the restore-path unit level
      (`loadSessionRecord` never writes — fork-restores-context.test.ts). At the full-CLI
      level a PRE-EXISTING init-time persist refreshes the source file's `updatedAt`
      metadata on any resume/fork run (observed on unmodified develop behavior; not
      introduced by this change), so the e2e corroboration asserts content invariance —
      same id, identical `messages` — which is the substance of the append-only contract._
- [x] TC-04: end-to-end semantic check — scripted-provider or real-binary scenario:
      `-p "Remember 42"` → `-p "What number?" -r <id> --fork-session` answers reference 42
- [x] TC-05: plain resume (no fork) behavior unchanged (regression)
- [x] TC-06: framework SPEC.md restore row states fork = new UUID + restored messages

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                 | Notes                                                                                                                                                                                                                                                                                                                         |
| ----- | ----------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | unit        | vitest — framework restore test with temp store                 | Test written: `packages/agent-framework/src/interactive/__tests__/fork-restores-context.test.ts > fork restores conversation context (CLI-073) > TC-01: loadSessionRecord yields the source messages for injection regardless of fork`                                                                                        |
| TC-02 | unit        | vitest — id comparison in same test                             | Test written: `packages/agent-cli/src/__tests__/e2e/scripted-e2e.test.ts > CLI-073: --fork-session restores the prior conversation into a NEW session` (fresh-UUID assertion: 2 session files, different ids)                                                                                                                 |
| TC-03 | unit        | vitest — store file content before/after fork                   | Test written: `packages/agent-framework/src/interactive/__tests__/fork-restores-context.test.ts > TC-03: the source record is unmodified after a fork-style load (append-only)` (byte-identity at restore-path level); e2e content-invariance corroboration in scripted-e2e CLI-073 test (per in-Decision correction)         |
| TC-04 | integration | scripted provider (CLI-074 fixture) through real CLI print path | Test written: `packages/agent-cli/src/__tests__/e2e/scripted-e2e.test.ts > CLI-073: --fork-session restores the prior conversation into a NEW session` (forked request carries source conversation); real-binary + real-provider run recorded in `.agents/backlog/completed/CLI-073-fork-session-context-semantics.md` ("42") |
| TC-05 | unit        | vitest — existing resume tests                                  | Test written: `packages/agent-framework/src/interactive/__tests__/fork-restores-context.test.ts > TC-05: plain resume keeps yielding the messages (regression)`; suite corroboration: `packages/agent-cli/src/modes/__tests__/print-mode-integration.test.ts` resume tests (CLI-063 TC-02/TC-03) green                        |
| TC-06 | manual      | SPEC.md diff review                                             | Test skipped: doc prose not automatable — manual verification by direct read at GATE-COMPLETE: `packages/agent-framework/docs/SPEC.md:776` forkSession option bullet states fork = fresh UUID + restored context (CLI-073)                                                                                                    |

## Tasks

- [x] `.agents/tasks/completed/CLI-073.md` — archived at GATE-COMPLETE (T1~T7 complete, TC-01~TC-06 매핑)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: BEHAVIOR` is one of the 11 allowed prefixes; `tags: [cli, typescript]` present.
- Problem: concrete symptom present (fork path `interactive-session-restore.ts:85` skips message injection; `robota -p "Remember 42"` → `-p "What number?" -r <id> --fork-session` cannot answer 42); reproduction condition present (any fork via `--fork-session`, identical in TUI and print mode); no "TBD"/"TODO" or vague single-sentence description.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (full `forkSession` grep — only :85 skip and `interactive-session-init.ts:114` id issuance, latter confirmed unrelated; TUI/print share framework path; pinning test :552-576 flagged for update).
- Alternatives Considered: 2 entries (conform code to SPEC; re-decide SPEC for fresh-context forks), each with pro and con.
- Decision: references the driving trade-off (contract integrity vs zero-diff) and the append-only invariant.
- Completion Criteria: all 6 items have TC-N prefixes (TC-01–TC-06); each uses Command or Observable behavior form (token/message state, id comparison, byte-identical store file, scripted e2e answer, existing resume tests, SPEC row content); no banned phrases ("works correctly", "no errors", "implemented", "displays correctly").
- Test Plan: section present; 6 rows match 6 TC-N criteria (count 6 = 6); every row has non-empty Test Type and Tool/Approach, no "TBD"; manual row TC-06 has Notes explaining why automation is not possible (doc prose, verified by direct read at GATE-COMPLETE).
- Structure: `## Tasks` section present with placeholder (tasks file deferred until GATE-APPROVAL); `## Evidence Log` present and empty at first GATE-WRITE run; no `## Status` or `## Classification` sections in body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: user replied exactly "승인함" (2026-06-13) — matches the explicit-approval list ("승인"). Per the orchestrator's record, the agent had stated verbatim that replying "승인함" authorizes implementation of the 11 designs, so the statement is a confirmed design approval, not an answer to a clarifying question.
- Directed at this spec document: the approval request "## 설계안 요약 (승인 요청) — 백로그 일괄 11건" summarized CLI-073's design individually (remove `!forkSession` condition so fork injects prior messages; new UUID kept; source record untouched/append-only; scripted-provider "Remember 42" verification) and ended with "승인해 주시면 GATE-APPROVAL → 항목별 구현…으로 진행합니다." The "승인함" reply covers this item explicitly — not approval of a different item. The intervening "머지하고 main 릴리스 진행해줘" was a release instruction (PR #705, docs-only) and was correctly not treated as design approval.
- No Architecture Review or frontmatter type/tags modified after approval request: git history shows the spec file's only commit is cd5b1053a (GATE-WRITE batch); post-GATE-WRITE changes were limited to the guard's Evidence Log entry, the `status: draft → review-ready` frontmatter upgrade, and prettier formatting — `type: BEHAVIOR` and `tags: [cli, typescript]` unchanged.
- No implementation before this gate (NON-COMPLIANCE trigger checked): `.agents/tasks/CLI-073.md` does not exist; `git status` shows no edits under `packages/agent-framework`; `interactive-session-restore.ts:85` still contains `if (!forkSession && record.messages)` — no implementation work started.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-073.md` exists (untracked new file on branch `feat/cli-073-fork-restores-context`, confirmed via `git status` `??` entry and direct read).
- Tasks file path recorded in `## Tasks`: the section lists `.agents/tasks/CLI-073.md` — T1~T7 (TC-01~TC-06 매핑 + wrap-up).
- Tasks correspond to Completion Criteria (one task per TC-N): T1↔TC-01 (remove `!forkSession` guard, fork injects source messages), T2↔TC-02 (forked id differs), T3↔TC-03 (source record byte-identical, append-only), T4↔TC-04 (scripted-provider e2e through real CLI print path + real-binary done-gate evidence), T5↔TC-05 (plain-resume regression), T6↔TC-06 (framework SPEC.md restore row), plus T7 wrap-up (test/typecheck/lint/build, PR, archive) — 6/6 TC-N covered. T1 additionally removes the then-unused `forkSession` parameter of `loadSessionRecord` and its single caller argument — cleanup within approved Solution step 1; the Affected Scope already names this file and its caller path.
- NON-COMPLIANCE trigger checked (implementation commits without tasks file): no implementation commits — `interactive-session-restore.ts:85` still contains `if (!forkSession && record.messages)`; working tree changes are limited to the spec move (todo/ → active/), the new tasks file, and unrelated `.agents/evals/lessons/` files; no edits under `packages/`.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- All tasks complete: `.agents/tasks/CLI-073.md` T1–T6 all `[x]` (verified by direct read). T7 (wrap-up) unchecked but every component independently verified per the established CLI-063..072 GATE-VERIFY interpretation (precedent confirmed by direct read of the CLI-070 and CLI-072 done-spec GATE-VERIFY entries): PR #713 OPEN (`gh pr view 713 --json state,headRefName,baseRefName,isDraft`: state OPEN, not draft, head `feat/cli-073-fork-restores-context` → base `develop`) with CI green on `gh pr checks 713` — build pass (1m28s), quality pass (1m0s), security audit pass (8s), Cloudflare Pages pass; compat-node18 and release-grade verification "skipping" (skipped by design on feature PRs); backlog evidence recorded in `.agents/backlog/completed/CLI-073-fork-session-context-semantics.md` (`status: done`, evidence filled: 2026-06-13 real binary + real Anthropic provider, isolated HOME — `robota -p "Remember the number 42…"` → `-p "What number…" -r <id> --fork-session` answers `42` from restored context; 2 session files = fresh UUID with source record content untouched) — met
- No tasks blocked or pending: tasks file contains no blocked markers (verified by direct read); only T7 wrap-up remains open as adjudicated above — met
- Build passes for affected packages: `pnpm --filter @robota-sdk/agent-framework build` → "Build complete in 858ms" (ESM bundles, no errors); `pnpm --filter @robota-sdk/agent-cli build` → "Build complete in 676ms" (ESM bundles, no errors) — met
- Tests pass for affected packages: `pnpm --filter @robota-sdk/agent-framework test` → 93 files / 915 tests passed, including the new `src/interactive/__tests__/fork-restores-context.test.ts` re-run individually → 3/3 passed (fork restore yields messages, source byte-identical at restore-path level, resume regression); `pnpm --filter @robota-sdk/agent-cli test` → 18 files / 146 tests passed, including the scripted-e2e fork test and the CLI-063 print-mode fork test updated to SPEC-conform semantics (`TC-03: fork creates a new independent session with restored context, original untouched (CLI-073 semantics)` — 790ms, pass) — met
- Note on approved scope: the CLI-063 print-mode fork test update is the planned consequence of conforming code to SPEC (the old test pinned the pre-SPEC fresh-context behavior this spec removes); the TC-03 in-Decision correction (byte-identity at restore-path unit level; full-CLI e2e asserts content invariance — same id, identical `messages` — due to a pre-existing init-time `updatedAt` persist observed on unmodified develop) is documented inside the approved Completion Criteria text, not a verification-time SPEC rewrite.
- Validity: on branch `feat/cli-073-fork-restores-context`; `git status --porcelain` shows only `.agents/evals/lessons/*` modifications, nothing under `packages/agent-framework`, `packages/agent-cli`, or `.agents/tasks` — build/test evidence reflects the PR #713 head state.

Completion Criteria checkboxes remain unchecked by design: TC-N validation belongs to GATE-COMPLETE.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

- Checkbox: `[x]` in Completion Criteria — met
- Command: `npx vitest run src/interactive/__tests__/fork-restores-context.test.ts` (cwd `packages/agent-framework`)
- Output: `✓ src/interactive/__tests__/fork-restores-context.test.ts (3 tests) 4ms` — `Test Files 1 passed (1)`, `Tests 3 passed (3)`, including `TC-01: loadSessionRecord yields the source messages for injection regardless of fork`. Exit code 0.
- Test reference recorded in Test Plan: `fork-restores-context.test.ts > fork restores conversation context (CLI-073) > TC-01`

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

- Checkbox: `[x]` in Completion Criteria — met
- Command: `npx vitest run src/__tests__/e2e/scripted-e2e.test.ts` (cwd `packages/agent-cli`)
- Output: `✓ src/__tests__/e2e/scripted-e2e.test.ts (6 tests) 190ms` — `Tests 6 passed (6)`, including `CLI-073: --fork-session restores the prior conversation into a NEW session`. Exit code 0.
- Assertion verified by direct read of the test (scripted-e2e.test.ts:233-235): after fork, `sessionFiles(project)` has length 2 — a second session file with a fresh UUID distinct from the source id.
- Test reference recorded in Test Plan.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-06-13

- Checkbox: `[x]` in Completion Criteria (with the documented in-Decision correction) — met
- Command (restore-path byte-identity): `npx vitest run src/interactive/__tests__/fork-restores-context.test.ts` (cwd `packages/agent-framework`) — `TC-03: the source record is unmodified after a fork-style load (append-only)` passed, 3/3 tests, exit code 0.
- Command (e2e content invariance, per correction): `npx vitest run src/__tests__/e2e/scripted-e2e.test.ts` (cwd `packages/agent-cli`) — CLI-073 test passed, exit code 0; direct read of scripted-e2e.test.ts:236-245 confirms it asserts `sourceAfter.id === sourceBefore.id` and `sourceAfter.messages` deep-equal `sourceBefore.messages` (content invariance; pre-existing init-time `updatedAt` persist noted in test comment, matching the correction text).
- Test references recorded in Test Plan (unit byte-identity + e2e corroboration).

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-06-13

- Checkbox: `[x]` in Completion Criteria — met
- Command: `npx vitest run src/__tests__/e2e/scripted-e2e.test.ts` (cwd `packages/agent-cli`) — `CLI-073: --fork-session restores the prior conversation into a NEW session` passed (6/6 tests), exit code 0. Direct read of scripted-e2e.test.ts:227-231 confirms the forked session's first provider request carries the source conversation (`Remember the number 42` user message and `noted: 42` assistant reply present in `second.requests[0]`).
- Real-binary corroboration: `.agents/backlog/completed/CLI-073-fork-session-context-semantics.md` (read directly) records the 2026-06-13 real-binary + real Anthropic provider run in isolated HOME — `robota -p "Remember the number 42. Reply only: noted."` → `robota -p "What number…" -r <id> --fork-session` answered `42`; 2 session files (fresh UUID, source content untouched).
- Test reference recorded in Test Plan.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-06-13

- Checkbox: `[x]` in Completion Criteria — met
- Command: `npx vitest run src/interactive/__tests__/fork-restores-context.test.ts` (cwd `packages/agent-framework`) — `TC-05: plain resume keeps yielding the messages (regression)` passed (3/3 tests), exit code 0.
- Suite-level corroboration: `npx vitest run src/modes/__tests__/print-mode-integration.test.ts` (cwd `packages/agent-cli`) — 3/3 passed, exit code 0, including `TC-02: resume loads prior messages into the provider request and creates no extra session` (1043ms) and `TC-03: fork creates a new independent session with restored context, original untouched (CLI-073 semantics)` (1053ms) — plain-resume behavior unchanged.
- Test references recorded in Test Plan.

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-06-13

- Checkbox: `[x]` in Completion Criteria — met
- Action: direct read of `packages/agent-framework/docs/SPEC.md` (manual verification per Test Plan skip reason — doc prose, not automatable). Line 776, **forkSession option** bullet, states: "When `true` (fork), `sessionId` is omitted, generating a fresh UUID — the original session record's content remains untouched (append-only). **Forks restore the conversation too (CLI-073)**: `loadSessionRecord` yields the source messages for deferred injection regardless of fork — fork = fresh UUID + restored context, matching the CLI SPEC's `--fork-session` promise."
- Skip reason recorded in Test Plan (manual doc verification with line reference).

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- Completion Criteria: all 6 checkboxes (TC-01–TC-06) are `[x]`, each backed by a `[GATE-COMPLETE: TC-N]` evidence entry above with command, observed output, and exit code.
- Test Plan: all 6 rows updated — TC-01–TC-05 carry test file + test name references; TC-06 carries an explicit skip reason (manual doc read with `SPEC.md:776` reference). No TC-N silently unaddressed.
- Tasks file archived: `.agents/tasks/completed/CLI-073.md` exists with 7/7 tasks `[x]` and no unchecked items (`grep '\[ \]'` → none); `.agents/tasks/CLI-073.md` no longer exists.
- `## Tasks` section points at the archived path `.agents/tasks/completed/CLI-073.md`.
- Verification runs executed directly by this guard on 2026-06-13: framework fork-restores-context suite 3/3 pass (exit 0); agent-cli scripted-e2e suite 6/6 pass (exit 0); agent-cli print-mode-integration suite 3/3 pass (exit 0); SPEC.md fork bullet verified by direct read.
