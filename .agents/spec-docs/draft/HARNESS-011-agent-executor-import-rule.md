---
status: review-ready
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
4. Verify `pnpm harness:scan` 23/23 (with HARNESS-002) green on develop.

## Affected Files

- `scripts/harness/` (forbidden-pattern scan config for the rule)
- the rule's unit test file under `scripts/harness/__tests__/`
- `.agents/project-structure.md`

## Completion Criteria

- [ ] TC-01: fixture — a non-exempt agent-cli file importing
      `@robota-sdk/agent-executor` → scan fails naming file + rule
- [ ] TC-02: exempt files (`cli.ts`, `print-mode.ts`) with their current imports → scan
      passes, exemptions reported with reasons
- [ ] TC-03: `pnpm harness:scan` green on clean develop with the revived rule active (all
      scans pass)
- [ ] TC-04: scan unit test no longer references `@robota-sdk/agent-runtime` (legacy name
      fully retired from rule + test)
- [ ] TC-05: `.agents/project-structure.md` documents the composition-root exemption with
      the reason-string requirement

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                  | Notes                                                                 |
| ----- | ----------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| TC-01 | unit        | vitest — fixture violation file                  | failure naming                                                        |
| TC-02 | unit        | vitest — exemption fixtures mirroring real files | exemption + reason output                                             |
| TC-03 | integration | `pnpm harness:scan` on develop                   | aggregate green                                                       |
| TC-04 | unit        | grep + test assertions                           | legacy name retired                                                   |
| TC-05 | manual      | project-structure.md diff review                 | doc prose — verified by direct read at GATE-COMPLETE, not automatable |

## Tasks

- [ ] `.agents/tasks/HARNESS-011R.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: RULE` is one of the 11 allowed prefixes; `tags: [harness, typescript]` present.
- Problem: concrete symptom (dead `cli-agent-runtime-import` rule targeting legacy `@robota-sdk/agent-runtime`, cannot match since rename) with explicit reproduction (`import { X } from '@robota-sdk/agent-executor'` in `packages/agent-cli/src/` — `pnpm harness:scan` stays green); no TBD/TODO/vague single-sentence description.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (full grep of agent-cli for `@robota-sdk/agent-executor` imports — exactly 2 hits, `cli.ts` and `print-mode.ts`, 2026-06-12, plus exemption-format survey of other rules); Alternatives Considered has 3 entries each with pro/con; Decision references the driving trade-off (rule uniformity vs architectural correctness, no-pass-through rule makes Alt 2 self-contradictory).
- Completion Criteria: all 5 items prefixed TC-01..TC-05; one criterion per Solution sub-item (rule retarget, exemptions, scan integration, legacy-name retirement, doc update); each uses command form or observable behavior; no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly") present.
- Test Plan: section present; 5 rows for 5 TC-Ns — count matches Completion Criteria; every row has non-empty Test Type and Tool/Approach with no TBD; the single manual row (TC-05) has a Notes entry explaining why automation is not possible (doc prose, verified by direct read at GATE-COMPLETE).
- Structure: `## Tasks` section present with placeholder (`.agents/tasks/HARNESS-011R.md` — 미생성); `## Evidence Log` section present and empty at first GATE-WRITE run; no `## Status` or `## Classification` sections in the body.
