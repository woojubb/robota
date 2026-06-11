---
status: in-progress
type: BEHAVIOR
tags: [cli, typescript]
---

# CLI-063: Print mode session resume (`-c` / `-r`) wiring

## Problem

`robota -p "..." -c` and `robota -p "..." -r <id>` always create a brand-new session instead
of continuing/resuming, with no warning. Reproduced 2026-06-11 on the npm-installed
`3.0.0-beta.73` tarball with a real provider (product verification L3):

1. `robota -p "Remember this number: 42"` → stored in `session_...wuzooabxs.json`
2. `robota -p "What number did I ask you to remember?" -c` → a **new** session file was
   created and the model answered it had no record of any number.
3. `robota -r session_...wuzooabxs -p "..."` → same: the id resolves (a bogus id correctly
   exits 1 from `cli.ts`), but the resolved session is then dropped and a new session is
   created.

Root cause: `cli.ts` resolves `resumeSessionId` (`src/cli.ts:154-168`) but passes it only to
`renderApp` (TUI path, `src/cli.ts:204`). `runPrintMode(...)` (`src/cli.ts:171-181`) never
receives it; `src/modes/print-mode.ts` and `IHeadlessInteractionChannelOptions` have no
resume fields at all. `--fork-session` has the same gap (TUI-only wiring). Help text and
SPEC §Session Resolution Logic advertise `-c`/`-r` without any mode restriction. This is the
CLI-053/054 incident class: flag parsed, advertised, unwired on one path.

## Architecture Review

### Affected Scope

- `packages/agent-cli` / `src/cli.ts` — pass resolved `resumeSessionId` + `forkSession`
  into `runPrintMode`; reject headless-impossible combinations before dispatch
- `packages/agent-cli` / `src/modes/print-mode.ts` — accept and forward the new fields
- `packages/agent-transport` / `src/headless/HeadlessInteractionChannel.ts` — add
  `resumeSessionId?` / `forkSession?` to `IHeadlessInteractionChannelOptions`, forward to
  `InteractiveSession` (which already supports both — TUI parity)
- `packages/agent-cli` / `docs/SPEC.md` — Session Resolution Logic states it applies to both
  TUI and print mode; error table gains the new print-mode argument errors
- `packages/agent-transport` / `docs/SPEC.md` — headless channel options contract update

### Alternatives Considered

1. **Thread `resumeSessionId`/`forkSession` through `runPrintMode` into the existing
   `InteractiveSession` options (chosen).**
   - Pro: `InteractiveSession` already implements restore (`interactive-session-init.ts:114`,
     `interactive-session-restore.ts`); TUI uses exactly this path, so print mode gains
     identical semantics with a small option-wiring change and no new restore logic.
   - Con: `runPrintMode`'s long positional parameter list grows; mitigated by passing the
     resolved values as one explicit argument object.
2. **Re-resolve `-c`/`-r` inside print-mode.ts from raw `args`.**
   - Pro: no `cli.ts` signature change.
   - Con: duplicates the resolution logic that `cli.ts` already runs for TUI (two owners for
     one rule — drift re-creates this exact defect class); "Session not found" handling would
     exist twice.
3. **Document `-c`/`-r` as TUI-only and error in print mode.**
   - Pro: smallest code change.
   - Con: removes an advertised capability automation users need (multi-turn scripted
     conversations); contradicts SPEC's mode-agnostic session resolution promise.

### Decision

Alternative 1. The restore capability already exists in `InteractiveSession` and is proven by
the TUI path; the defect is pure option-wiring. Single-owner resolution stays in `cli.ts`.
Headless-impossible combinations fail fast in `cli.ts` before dispatch: bare `-r` (session
picker) and `-c`/`-r` combined with `--no-session-persistence` are argument errors (exit 1),
consistent with the SPEC error table's "Argument parse error" class.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — agent-cli 실행 모드 전수: TUI(renderApp)는 기존 정상, print
      (runPrintMode)가 본 결함, `--check-update`/`init`/`diagnose`/`session analyze` 등
      pre-session 커맨드는 세션 미사용으로 해당 없음
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. `IHeadlessInteractionChannelOptions` gains `resumeSessionId?: string` and
   `forkSession?: boolean`; `HeadlessInteractionChannel.createSession`-equivalent
   construction forwards both to `InteractiveSession` (same lines TUI channel uses:
   `TuiInteractionChannel.ts:129-130`).
2. `runPrintMode` signature gains a `sessionResolution: { resumeSessionId?: string;
forkSession?: boolean }` argument; forwards into the channel options.
3. `cli.ts`: print-mode dispatch passes the already-resolved `resumeSessionId` and
   `args.forkSession`. Before dispatch, two new argument errors (stderr + exit 1):
   - `args.printMode && args.resumeId === ''` → "Print mode requires an explicit session id:
     -r <id|name>" (the TUI session picker cannot run headlessly)
   - `args.printMode && args.noSessionPersistence && (args.continueMode ||
args.resumeId !== undefined)` → "--no-session-persistence conflicts with -c/-r"
4. `-c` with no prior session for the cwd keeps continue-or-start semantics (new session,
   exit 0) — identical to TUI behavior.
5. Update both SPEC.md files (session resolution applies to print mode; new error rows).

## Affected Files

- `packages/agent-transport/src/headless/HeadlessInteractionChannel.ts`
- `packages/agent-transport/src/headless/__tests__/` (new/extended channel option tests)
- `packages/agent-transport/docs/SPEC.md`
- `packages/agent-cli/src/modes/print-mode.ts`
- `packages/agent-cli/src/cli.ts`
- `packages/agent-cli/src/modes/__tests__/print-mode-integration.test.ts` (resume cases)
- `packages/agent-cli/docs/SPEC.md`

## Completion Criteria

- [ ] TC-01: `HeadlessInteractionChannel` constructed with `resumeSessionId` passes it to
      `InteractiveSession` options; with `forkSession: true` passes that too (unit assertion
      on the constructed session's options/restored state)
- [ ] TC-02: print-mode integration — seeded session store with prior user+assistant
      messages, run with `resumeSessionId` of that session → provider receives the prior
      messages in its request and the store gains no additional session id
- [ ] TC-03: print-mode integration — same seed, `forkSession: true` → a new independent
      session id is created and the original is untouched; the forked run starts a fresh
      model context (prior messages NOT injected — identical to the framework's existing
      TUI fork semantics in `interactive-session-restore.ts:85`). _Corrected during
      implementation: the draft's "containing the prior messages" phrasing misdescribed the
      framework's fork semantics; the approved Decision is TUI parity with no new restore
      logic. Whether forks should carry conversation context is tracked separately as
      backlog CLI-073._
- [ ] TC-04: `robota -p "hi" -r ""` (empty resume id) → stderr contains "Print mode requires
      an explicit session id" and exit code 1. _Implementation note: a bare `-r` without any
      value is rejected earlier by `parseArgs` itself ("argument missing", exit 1); the
      empty-id case reachable as `-r ""` is the one this criterion governs._
- [ ] TC-05: `robota -p "hi" -c --no-session-persistence` → stderr contains
      "--no-session-persistence conflicts" and exit code 1
- [ ] TC-06: `-c` with an empty session store → run succeeds (exit 0) and creates exactly one
      new session (continue-or-start semantics)
- [ ] TC-07: `packages/agent-cli/docs/SPEC.md` Session Resolution Logic section states print
      mode support and documents the TC-04/TC-05 error rows; transport SPEC documents the new
      channel options

## Test Plan

Derived strategy (BEHAVIOR + cli/typescript): unit + process/integration tests via vitest.

| TC-ID | Test Type   | Tool / Approach                                                         | Notes                                  |
| ----- | ----------- | ----------------------------------------------------------------------- | -------------------------------------- |
| TC-01 | unit        | vitest — channel option wiring assertion (agent-transport)              |                                        |
| TC-02 | integration | vitest — print-mode-integration.test.ts with stub provider + temp store | provider stub records request messages |
| TC-03 | integration | vitest — same fixture, forkSession variant                              |                                        |
| TC-04 | integration | vitest — startCli arg-error path (stderr + exit code via injected exit) |                                        |
| TC-05 | integration | vitest — same harness as TC-04                                          |                                        |
| TC-06 | integration | vitest — empty temp store, stub provider                                |                                        |
| TC-07 | manual      | SPEC.md diff review                                                     | doc change — reviewed in PR diff       |

## Tasks

- [x] `.agents/tasks/CLI-063.md` — 생성 완료 (T1~T8, TC-01~TC-07 매핑)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-11

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block — met
- Frontmatter: `status: draft` present — met
- Frontmatter: `type: BEHAVIOR` is one of the 11 allowed prefixes — met
- Frontmatter: `tags: [cli, typescript]` present — met
- Problem: concrete symptom present (exact commands, session file names, observed wrong behavior on 3.0.0-beta.73) — met
- Problem: reproduction condition present (npm-installed tarball, real provider, 3-step repro dated 2026-06-11) — met
- Problem: no "TBD"/"TODO"/vague single-sentence description; root cause cited with file:line — met
- Architecture Review: all 4 checklist items `[x]` — met
- Architecture Review: sibling scan `[x]` with completion evidence (TUI/print/pre-session command sweep of agent-cli execution modes) — met
- Architecture Review: 3 alternatives, each with pro and con — met (≥2 required)
- Architecture Review: Decision references the drift/duplication trade-off from Alternative 2 and the proven-restore-path rationale — met
- Completion Criteria: 7 items, all prefixed TC-01…TC-07 — met
- Completion Criteria: each distinct sub-item (channel wiring, resume, fork, two argument errors, continue-or-start, docs) has a criterion — met
- Completion Criteria: all criteria use command form or observable behavior (stderr text, exit codes, store/provider assertions) — met
- Completion Criteria: no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly") — met
- Test Plan: section present; 7 rows for 7 TC-N (count matches) — met
- Test Plan: every row has non-empty Test Type and Tool/Approach, no "TBD" — met
- Test Plan: sole manual row (TC-07) has Notes explaining it is a doc change reviewed in PR diff — met
- Structure: `## Tasks` section present with placeholder (tasks file created after GATE-APPROVAL) — met
- Structure: `## Evidence Log` section present and empty at gate run (first GATE-WRITE) — met
- Structure: no `## Status` or `## Classification` sections in body — met

### [GATE-APPROVAL] — ❌ FAIL | 2026-06-11

**Status remains:** review-ready
**Failed criteria:**

- Direct, unambiguous approval directed at this spec document: user statement "a" (2026-06-11) selected option A — the work-ordering plan to fix CLI-063~066 via the gate pipeline before building the L2 harness. That reply was given **before this spec document existed** (the agent stated "승인해 주시면 A 기준으로 spec 문서부터 시작하겠습니다"), so it authorizes the campaign plan, not this document's design. Per gate criteria, answering an option-selection question without confirming the design does not count as approval, and approval of a batch plan covering four items is not approval of this specific spec.
  **Required action:** Present the completed CLI-063 spec (Problem, Architecture Review, Solution, Completion Criteria) to the user and obtain an explicit, unambiguous approval of this document (e.g., "승인", "진행해"), then re-run GATE-APPROVAL.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-11

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: user replied "승인함" (2026-06-11) — met
- Approval directed at this spec document: the agent presented a per-item design summary ("## 설계안 요약 (승인 요청)") authored **after** this spec's content existed and after GATE-WRITE passed, explicitly covering CLI-063's key decisions (thread resumeSessionId/forkSession through runPrintMode to HeadlessInteractionChannel via the TUI-parity path; argument errors for bare `-r` and `-c`/`-r` with `--no-session-persistence` in print mode; continue-or-start semantics for `-c` with no prior session), and stated "4건 승인해 주시면 GATE-APPROVAL → 구현(TDD) → PR 순서로 진행합니다. 특정 항목만 수정/보류를 원하시면 해당 항목 번호로 알려주세요." The user's "승인함" is a direct, unambiguous confirmation of the presented design for all four items including this one; this resolves the prior FAIL (approval now given after spec authoring, against the summarized design) — met
- No Architecture Review or frontmatter type/tags modified after approval: summarized design decisions match the document's current Decision/Solution sections; `git status` shows no post-approval edits to source or spec design sections (only Evidence Log entries appended by gate runs) — met
- NON-COMPLIANCE trigger check: no implementation started — `git status --porcelain packages/agent-cli/src packages/agent-transport/src` is clean, last commits on affected files are prior merged PRs (#685, #684, #657), and `.agents/tasks/CLI-063.md` does not exist — not triggered

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-06-11

**Status remains:** approved
**Failed criteria:**

- `.agents/tasks/CLI-063.md` has been created: file does not exist (`ls .agents/tasks/` shows only `completed/` and `README.md`); required: tasks file must exist before status upgrade to in-progress.
  **Required action:** Create `.agents/tasks/CLI-063.md` with at least one task per TC-01…TC-07 (backlog-pipeline/writer responsibility, not the gate guard), then re-run GATE-IMPLEMENT.
- Tasks file path recorded in `## Tasks` section: section still contains the placeholder `- [ ] .agents/tasks/CLI-063.md — 미생성 (GATE-APPROVAL 통과 후 생성)`; required: a recorded path to an existing tasks file.
  **Required action:** Update the `## Tasks` section to reference the created tasks file.
- Tasks correspond to Completion Criteria (≥1 task per TC-N): not checkable — no tasks file exists for the 7 TC-N items.
  **Required action:** Ensure the created tasks file covers TC-01 through TC-07.

NON-COMPLIANCE trigger check: no implementation commits exist — `git status --porcelain packages/agent-cli/src packages/agent-transport/src` clean; latest commits touching affected files are prior merged PRs (#685, #684, #657) — not triggered, hence FAIL rather than NON-COMPLIANCE.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-11

**Status upgrade:** approved → in-progress

- `.agents/tasks/CLI-063.md` has been created: file exists (`ls .agents/tasks/` shows `CLI-063.md`) with 8 tasks T1–T8 — met
- Tasks file path recorded in `## Tasks` section: section reads `- [x] .agents/tasks/CLI-063.md — 생성 완료 (T1~T8, TC-01~TC-07 매핑)` referencing the existing file — met
- Tasks correspond to Completion Criteria (≥1 task per TC-N): T1→TC-01 (channel option wiring + unit test), T2→TC-02 (resume integration), T3→TC-03 (fork variant), T4→TC-04 (bare `-r` argument error), T5→TC-05 (`--no-session-persistence` conflict error), T6→TC-06 (continue-or-start with empty store), T7→TC-07 (both SPEC.md updates); T8 is a wrap-up task (build/test/PR/evidence) beyond the TC mapping — all 7 TC-N covered — met
- NON-COMPLIANCE trigger check: no implementation commits before this gate — `git status --porcelain packages/agent-cli/src packages/agent-transport/src` clean; latest commits touching affected files remain prior merged PRs (#685, #684, #657) — not triggered

This resolves the prior FAIL of 2026-06-11 (tasks file missing). Tasks created: T1, T2, T3, T4, T5, T6, T7, T8 in `.agents/tasks/CLI-063.md`.
