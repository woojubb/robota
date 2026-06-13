---
status: done
type: RULE
tags: [harness, typescript]
---

# HARNESS-011(잔여): revive the dead CLI import-layering rule as `agent-executor`

## Problem

The `cli-agent-runtime-import` forbidden-pattern scan rule still targets the legacy package
name `@robota-sdk/agent-runtime` and has been dead since the rename to
`@robota-sdk/agent-executor` — it can never match, so the layering it guards (agent-cli must
compose through agent-framework, not reach into executor internals) is unenforced. Its unit
test pins the legacy-name behavior, so the deadness is even test-protected. This is the last
open item of HARNESS-011 (CI green baseline): items 1–2 and the background-workspace stale
paths were fixed earlier (22/22 scans green, 2026-06-12); reproduction: add
`import { X } from '@robota-sdk/agent-executor'` anywhere in `packages/agent-cli/src/` —
`pnpm harness:scan` stays green.

Reviving the pattern as `agent-executor` flags two real existing imports:
`packages/agent-cli/src/cli.ts` (`createDefaultBackgroundTaskRunners`) and
`packages/agent-cli/src/print-mode.ts` (type-only `IBackgroundTaskRunner`). A decision is
required: are composition-root imports a documented exception, or must they route through an
agent-framework re-export?

## Architecture Review

### Affected Scope

- `scripts/harness/` forbidden-pattern scan config — rule renamed/retargeted to
  `@robota-sdk/agent-executor`, with an explicit per-file exemption list
- the scan's unit test — un-pin the legacy name; cover match, exemption, and clean cases
- `.agents/project-structure.md` — document the composition-root exemption rationale
  (dependency-direction rules live here)

### Alternatives Considered

1. **Revive as `agent-executor` with a documented composition-root exemption for `cli.ts`
   and `print-mode.ts` (chosen).**
   - Pro: the layering rule becomes live again for all feature code; the two existing
     imports are legitimate composition-root wiring (the CLI is the app assembly point —
     layered-assembly architecture explicitly lets the root wire concrete runners), and
     `print-mode.ts` is type-only; exemptions are explicit, named, and reasoned — new
     violations still fail.
   - Con: an exemption list can grow if undisciplined — mitigated by requiring a reason
     string per entry and the rule doc naming composition-root as the only valid category.
2. **Route the two imports through an agent-framework re-export, zero exemptions.**
   - Pro: uniform rule, no exemption machinery.
   - Con: violates the no-pass-through-re-exports rule in `.agents/project-structure.md` —
     fixing one rule by breaking another; adds an artificial indirection for the
     composition root, which by definition may know concrete implementations.
3. **Delete the dead rule.**
   - Pro: honest about current enforcement.
   - Con: abandons a real architectural boundary that already drifted twice (the two
     imports appeared while the rule was dead); HARNESS-011's goal is restoring signal,
     not removing it.

### Decision

Alternative 1. The driving trade-off is rule uniformity vs architectural correctness: the
no-pass-through rule makes Alternative 2 self-contradictory, and composition-root wiring is
a principled, bounded exception (one file category, reason required). The pattern matches
`from '@robota-sdk/agent-executor'` in `packages/agent-cli/src/**`; exempt exactly
`src/cli.ts` and `src/print-mode.ts` with reasons (`composition root — concrete runner
wiring` / `composition root — type-only runner contract`).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — agent-cli 내 `@robota-sdk/agent-executor` import 전수 grep:
      `cli.ts`(`createDefaultBackgroundTaskRunners`)와 `print-mode.ts`(type-only
      `IBackgroundTaskRunner`) 2건뿐 확인(2026-06-12); 다른 forbidden-pattern 규칙들의
      예외 표현 방식(파일 경로 + 사유 문자열) 확인 — 동일 형식 채택
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. Retarget the rule: name `cli-agent-executor-import`, pattern
   `@robota-sdk/agent-executor` imports under `packages/agent-cli/src/`, exemptions
   `src/cli.ts` + `src/print-mode.ts` each with a reason string.
2. Update the scan unit test: legacy-name pinning removed; cases — non-exempt file with the
   import fails; exempt files pass; clean tree passes.
3. `.agents/project-structure.md`: one paragraph defining the composition-root exemption
   (what qualifies, reason-string requirement).
4. Verify `pnpm harness:scan` green on develop (22/22 at this item's merge time;
   HARNESS-002 adds its scan separately).

_Extension during implementation (within the parent HARNESS-011 scope this spec closes):
running the full harness unit suite for TC-03 surfaced 3 pre-existing failing tests of the
SAME defect class this spec exists to fix — (a) `check-command-layering.mjs` carried another
dead legacy-name pattern (`@robota-sdk/agent-sessions`, plural; the real package is
`agent-session`) so its violation fixture matched nothing; (b) two
`check-capability-placement` fixtures predated the `workspace-package-not-documented`
check and omitted `agent-framework` from the fixture structure doc. Both repaired here
(pattern retargeted to the singular name with subpath support — zero live findings,
agent-cli has no real agent-session imports; fixture doc row added). HARNESS-011 item 4
("failing harness unit tests must be repaired") is the parent scope authorizing this;
harness suite now 184/184._

## Affected Files

- `scripts/harness/` (forbidden-pattern scan config for the rule)
- the rule's unit test file under `scripts/harness/__tests__/`
- `.agents/project-structure.md`

## Completion Criteria

- [x] TC-01: fixture — a non-exempt agent-cli file importing
      `@robota-sdk/agent-executor` → scan fails naming file + rule
- [x] TC-02: exempt files (`cli.ts`, `print-mode.ts`) with their current imports → scan
      passes, exemptions reported with reasons
- [x] TC-03: `pnpm harness:scan` green on clean develop with the revived rule active (all
      scans pass)
- [x] TC-04: scan unit test no longer references `@robota-sdk/agent-runtime` (legacy name
      fully retired from rule + test)
- [x] TC-05: `.agents/project-structure.md` documents the composition-root exemption with
      the reason-string requirement

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                  | Notes                                                                                                                                                                                                                                                |
| ----- | ----------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | unit        | vitest — fixture violation file                  | Test: `scripts/harness/__tests__/check-background-workspace-conformance.test.mjs > findBackgroundWorkspaceConformanceFindings > flags direct CLI imports from agent-executor in non-exempt files (HARNESS-011)`                                      |
| TC-02 | unit        | vitest — exemption fixtures mirroring real files | Test: `scripts/harness/__tests__/check-background-workspace-conformance.test.mjs > findBackgroundWorkspaceConformanceFindings > exempts the composition root with documented reasons (HARNESS-011)`; live scan exit 0 with both exemptions + reasons |
| TC-03 | integration | `pnpm harness:scan` on develop                   | Live run 2026-06-13: "all 22 scans passed", exit 0 (no dedicated test file — aggregate integration command is the test)                                                                                                                              |
| TC-04 | unit        | grep + test assertions                           | `grep -n "agent-runtime"` over rule + test files → zero hits (exit 1); legacy-pinning test replaced by the two HARNESS-011 cases in `check-background-workspace-conformance.test.mjs`                                                                |
| TC-05 | manual      | project-structure.md diff review                 | Skip (no automated test): doc prose — verified by direct read at GATE-COMPLETE 2026-06-13, `.agents/project-structure.md:81-94` §Composition-Root Exemption                                                                                          |

## Tasks

- [x] `.agents/tasks/completed/HARNESS-011R.md` — archived at GATE-COMPLETE (T1~T6 complete, TC-01~TC-05 매핑)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: RULE` is one of the 11 allowed prefixes; `tags: [harness, typescript]` present.
- Problem: concrete symptom (dead `cli-agent-runtime-import` rule targeting legacy `@robota-sdk/agent-runtime`, cannot match since rename) with explicit reproduction (`import { X } from '@robota-sdk/agent-executor'` in `packages/agent-cli/src/` — `pnpm harness:scan` stays green); no TBD/TODO/vague single-sentence description.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (full grep of agent-cli for `@robota-sdk/agent-executor` imports — exactly 2 hits, `cli.ts` and `print-mode.ts`, 2026-06-12, plus exemption-format survey of other rules); Alternatives Considered has 3 entries each with pro/con; Decision references the driving trade-off (rule uniformity vs architectural correctness, no-pass-through rule makes Alt 2 self-contradictory).
- Completion Criteria: all 5 items prefixed TC-01..TC-05; one criterion per Solution sub-item (rule retarget, exemptions, scan integration, legacy-name retirement, doc update); each uses command form or observable behavior; no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly") present.
- Test Plan: section present; 5 rows for 5 TC-Ns — count matches Completion Criteria; every row has non-empty Test Type and Tool/Approach with no TBD; the single manual row (TC-05) has a Notes entry explaining why automation is not possible (doc prose, verified by direct read at GATE-COMPLETE).
- Structure: `## Tasks` section present with placeholder (`.agents/tasks/HARNESS-011R.md` — 미생성); `## Evidence Log` section present and empty at first GATE-WRITE run; no `## Status` or `## Classification` sections in the body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: user replied exactly "승인함" (2026-06-13) to the consolidated approval request "## 설계안 요약 (승인 요청) — 백로그 일괄 11건", which individually summarized this spec's design decision (revive the dead rule retargeted to `agent-executor`, exactly two composition-root exemptions `cli.ts`/`print-mode.ts` each with a reason string, framework re-export route rejected as no-pass-through violation) and stated that approval authorizes GATE-APPROVAL → per-item implementation.
- Direct, unambiguous, directed at this spec: before replying, the user was told verbatim that replying "승인함" authorizes implementation of the 11 summarized designs including HARNESS-011(잔여); the intervening release instruction ("머지하고 main 릴리스 진행해줘", executed as docs-only PR #705) and the clarifying question ("그래서 뭐?") were not treated as approval.
- No Architecture Review or frontmatter type/tags modified after the approval request: only post-GATE-WRITE changes were the guard's GATE-WRITE Evidence Log entry, the frontmatter status upgrade draft → review-ready, and prettier formatting at commit cd5b1053a (released in PR #705); verified the commit is a 133-line new-file addition for this spec.
- NON-COMPLIANCE trigger checked — no implementation started before this gate: `.agents/tasks/HARNESS-011R.md` absent; scan rule still carries the legacy `cli-agent-runtime-import` type and legacy package name in `scripts/harness/check-background-workspace-conformance.mjs:70` and `scripts/harness/__tests__/check-background-workspace-conformance.test.mjs:61`; no commits to `scripts/harness/` or `.agents/project-structure.md` for this spec since the approval request (only afdca8b66, 2026-06-12, the earlier HARNESS-011 items 1–2 fix predating this spec).
- Prior gate evidence present: [GATE-WRITE] ✅ PASS entry (2026-06-13) exists in this Evidence Log; frontmatter `status: review-ready` matches the gate's entry state.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/HARNESS-011R.md` exists on branch `feat/harness-011r-executor-import-rule` (untracked working-tree file, 6 tasks T1–T6, spec back-reference and Test Plan SSOT pointer present).
- Tasks file path recorded: `## Tasks` section of this spec lists `.agents/tasks/HARNESS-011R.md` — T1~T6 (TC-01~TC-05 매핑 + wrap-up).
- Tasks ↔ Completion Criteria correspondence: T1↔TC-01 (rule retarget + non-exempt fixture fails), T2↔TC-02 (per-file exemptions with reason strings + exempt fixtures pass), T3↔TC-03 (`pnpm harness:scan` green on develop), T4↔TC-04 (legacy `@robota-sdk/agent-runtime` retired from rule + test), T5↔TC-05 (`.agents/project-structure.md` composition-root exemption doc) — at least one task per TC-N, all 5 covered; T6 is wrap-up (tests green, PR, archive) with no TC mapping required. Note: tasks file uses the actual file path `src/modes/print-mode.ts` (verified on disk; spec's `src/print-mode.ts` shorthand refers to the same file) — correspondence intact.
- NON-COMPLIANCE trigger checked — no implementation commits before tasks file: `scripts/harness/check-background-workspace-conformance.mjs:70` still carries the legacy `cli-agent-runtime-import` rule with pattern `@robota-sdk/agent-runtime`; branch diff vs develop contains only the spec move todo/ → active/ and the new tasks file; last commits touching `scripts/harness/` or `.agents/project-structure.md` predate this spec (550cdcd80 / 8099b117f, HARNESS-012/005/013/014).
- Prior gate evidence present: [GATE-WRITE] and [GATE-APPROVAL] ✅ PASS entries (2026-06-13) exist above; frontmatter `status: approved` matches the entry state for this gate.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- All tasks complete: `.agents/tasks/HARNESS-011R.md` T1–T5 all `[x]` (verified by direct read). T6 (wrap-up) unchecked but every component independently verified per the established CLI-063..073 GATE-VERIFY interpretation (precedent confirmed by direct read of the CLI-069 done-spec GATE-VERIFY entry, which adjudicated its open wrap-up task the same way): PR #714 OPEN (`gh pr view 714 --json state,headRefName,baseRefName`: state OPEN, head `feat/harness-011r-executor-import-rule` → base `develop`) with CI green on `gh pr checks 714` — build pass (31s), quality pass (26s), security audit pass (8s), Cloudflare Pages pass; compat-node18 and release-grade verification "skipping" (skipped by design on feature PRs); backlog closure recorded at `.agents/backlog/completed/HARNESS-011-ci-green-baseline.md` (`status: done`, "Progress update (2026-06-13) — CLOSED" present; User Execution Test Scenarios section states "Not applicable — CI/infra change; evidence is green pipeline runs on the PR") — met
- No tasks blocked or pending: tasks file contains no blocked markers; only T6 wrap-up remains open as adjudicated above — met
- Build passes (mapped): this item has no package build (scope is `scripts/harness/` + `.agents/project-structure.md`); mapped verification ran instead — `pnpm harness:scan` → "all 22 scans passed" with the revived `cli-agent-executor-import` rule active; direct `node scripts/harness/check-background-workspace-conformance.mjs` → exit 0, "background workspace conformance scan passed." with both exemptions reported with reasons ("exempted: packages/agent-cli/src/cli.ts [cli-agent-executor-import] — composition root — concrete runner wiring" / "exempted: packages/agent-cli/src/modes/print-mode.ts [cli-agent-executor-import] — composition root — type-only runner contract") — met
- Tests pass (mapped): `npx vitest run scripts/harness/__tests__/` → 20 files / 184 tests passed (184/184, includes the 3 pre-existing same-class repairs noted in the Solution's in-Decision extension: command-layering singular-name retarget + 2 capability-placement fixtures); legacy name retired — `grep agent-runtime` over the rule file and its unit test returns zero hits; `.agents/project-structure.md:81` contains the `## Composition-Root Exemption (Import-Layering Scans)` section — met
- Validity: on branch `feat/harness-011r-executor-import-rule`; `git status --porcelain` shows only `.agents/evals/lessons/*` modifications, nothing under `scripts/harness/`, `.agents/project-structure.md`, or `.agents/tasks/` — scan/test evidence reflects the PR #714 head state.

Completion Criteria checkboxes remain unchecked by design: TC-N validation belongs to GATE-COMPLETE.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

- Checkbox: TC-01 `[x]` in ## Completion Criteria — confirmed.
- Command: `npx vitest run scripts/harness/__tests__/check-background-workspace-conformance.test.mjs`
- Output: `Test Files 1 passed (1)`, `Tests 5 passed (5)` — includes `flags direct CLI imports from agent-executor in non-exempt files (HARNESS-011)`, which asserts a non-exempt agent-cli fixture importing `@robota-sdk/agent-executor` produces a finding naming the file and the `cli-agent-executor-import` rule. Exit code 0.
- Test reference recorded in ## Test Plan row TC-01.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

- Checkbox: TC-02 `[x]` in ## Completion Criteria — confirmed.
- Command (unit): same vitest run as TC-01 — test `exempts the composition root with documented reasons (HARNESS-011)` passed (5/5, exit 0).
- Command (live): `node scripts/harness/check-background-workspace-conformance.mjs`
- Output: `exempted: packages/agent-cli/src/cli.ts [cli-agent-executor-import] — composition root — concrete runner wiring` / `exempted: packages/agent-cli/src/modes/print-mode.ts [cli-agent-executor-import] — composition root — type-only runner contract` / `background workspace conformance scan passed.` Exit code 0 — exempt files pass with reasons reported.
- Test reference recorded in ## Test Plan row TC-02.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-06-13

- Checkbox: TC-03 `[x]` in ## Completion Criteria — confirmed.
- Command: `pnpm harness:scan` (on develop-based branch, clean tree for harness paths)
- Output: scan summary lists 22 checks all `✓` (consistency … docs-structure) ending `all 22 scans passed`, with `background-workspace` (the revived rule's scan) green. Exit code 0 (verified via `pnpm harness:scan > /dev/null 2>&1; echo $?` → 0).
- Test Plan row TC-03 notes the live integration run as the test (aggregate command, no dedicated test file).

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-06-13

- Checkbox: TC-04 `[x]` in ## Completion Criteria — confirmed.
- Command: `grep -n "agent-runtime" scripts/harness/check-background-workspace-conformance.mjs scripts/harness/__tests__/check-background-workspace-conformance.test.mjs`
- Output: no matches, grep exit code 1 — legacy `@robota-sdk/agent-runtime` fully retired from rule and test.
- Test assertions: the legacy-name-pinning test no longer exists; test-name listing (`grep "it("`) shows the two HARNESS-011 cases plus three unrelated conformance cases — all 5 pass (exit 0).
- Test reference recorded in ## Test Plan row TC-04.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-06-13

- Checkbox: TC-05 `[x]` in ## Completion Criteria — confirmed.
- Action: direct read of `.agents/project-structure.md` lines 81–94 — section `## Composition-Root Exemption (Import-Layering Scans)` present; defines the composition root as the single permitted exemption category (cli.ts concrete runner wiring, modes/print-mode.ts type-only contract), rejects the framework re-export route as a no-pass-through violation, and states "Every exemption entry MUST carry a reason string and is reported (never silent) on each scan run" — exemption category + reason-string requirement both documented.
- Test Plan row TC-05 carries the explicit skip reason (doc prose, manual direct-read verification — not automatable).

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- All 5 Completion Criteria checkboxes `[x]` with one `[GATE-COMPLETE: TC-N]` evidence entry each (commands, observed output, exit codes recorded above).
- ## Test Plan: all 5 rows updated — TC-01/TC-02/TC-04 with test file + test name references, TC-03 with the live integration command result, TC-05 with an explicit skip reason. No TC-N silently unaddressed.
- Tasks file archived: `.agents/tasks/completed/HARNESS-011R.md` exists with T1–T6 all `[x]`; original `.agents/tasks/HARNESS-011R.md` removed (verified absent); spec ## Tasks section points at the archived path.
- Backlog closure (done gate): `.agents/backlog/completed/HARNESS-011-ci-green-baseline.md` — `status: done` (line 3), `## Progress update (2026-06-13) — CLOSED` present; User Execution Test Scenarios section states "Not applicable — CI/infra change; evidence is green pipeline runs on the PR" — done-gate satisfied without user execution scenarios per the backlog itself.
- Prior gate evidence chain intact: GATE-WRITE, GATE-APPROVAL, GATE-IMPLEMENT, GATE-VERIFY all ✅ PASS (2026-06-13) above; frontmatter `status: verifying` matches this gate's entry state.
