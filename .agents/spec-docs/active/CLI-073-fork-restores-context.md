---
status: in-progress
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

- [ ] TC-01: fork restore injects the source session's messages — forked session's context
      state reports the restored messages (`usedTokens > 0` / messages present)
- [ ] TC-02: forked session id differs from the source id (fresh UUID preserved)
- [ ] TC-03: source session record is unmodified after fork (append-only invariant —
      byte-identical store file). _Correction during implementation (within the approved
      Decision): byte-identity holds at the restore-path unit level
      (`loadSessionRecord` never writes — fork-restores-context.test.ts). At the full-CLI
      level a PRE-EXISTING init-time persist refreshes the source file's `updatedAt`
      metadata on any resume/fork run (observed on unmodified develop behavior; not
      introduced by this change), so the e2e corroboration asserts content invariance —
      same id, identical `messages` — which is the substance of the append-only contract._
- [ ] TC-04: end-to-end semantic check — scripted-provider or real-binary scenario:
      `-p "Remember 42"` → `-p "What number?" -r <id> --fork-session` answers reference 42
- [ ] TC-05: plain resume (no fork) behavior unchanged (regression)
- [ ] TC-06: framework SPEC.md restore row states fork = new UUID + restored messages

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                 | Notes                                                                    |
| ----- | ----------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| TC-01 | unit        | vitest — framework restore test with temp store                 | updated :552-576 suite                                                   |
| TC-02 | unit        | vitest — id comparison in same test                             | fresh UUID                                                               |
| TC-03 | unit        | vitest — store file content before/after fork                   | append-only proof                                                        |
| TC-04 | integration | scripted provider (CLI-074 fixture) through real CLI print path | deterministic, no live API needed; real-binary run as done-gate evidence |
| TC-05 | unit        | vitest — existing resume tests                                  | regression                                                               |
| TC-06 | manual      | SPEC.md diff review                                             | doc prose — verified by direct read at GATE-COMPLETE, not automatable    |

## Tasks

- [ ] `.agents/tasks/CLI-073.md` — T1~T7 (TC-01~TC-06 매핑 + wrap-up)

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
