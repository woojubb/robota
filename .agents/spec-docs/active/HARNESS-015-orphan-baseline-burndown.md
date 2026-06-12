---
status: in-progress
type: RULE
tags: [harness, typescript]
---

# HARNESS-015: Orphan-export baseline burn-down to zero

## Problem

The HARNESS-001 orphan-export scan launched with a ratchet baseline
(`scripts/harness/orphan-export-baseline.json`, 153 entries frozen 2026-06-11) so only NEW
orphans fail. Each frozen entry is unresolved debt: either dead code that should be deleted,
or a legitimately external-facing symbol that should be wired to the package surface or
allowlisted with a reason. While the baseline exists, those 153 symbols are invisible to the
scan — reproduction: delete the only consumer of any baselined export →
`pnpm harness:scan:orphan-exports` stays green. Affected packages include agent-core,
agent-framework, agent-command, agent-playground and others.

## Architecture Review

### Affected Scope

- `scripts/harness/orphan-export-baseline.json` — shrinks per batch, finally deleted
- `packages/*` source — deletions of dead exports (and their dead transitive-only helpers)
  or wiring of legitimately-public symbols to the package surface
- the scan's reasoned allowlist — entries moved with explicit reason strings
- per-package `docs/SPEC.md` Public API Surface tables — updated where symbols are deleted
  or surfaced

### Alternatives Considered

1. **Per-package triage batches: delete / allowlist-with-reason / wire-to-surface; baseline
   shrinks monotonically to empty, then is removed (chosen).**
   - Pro: each batch is reviewable against one package's SPEC; package test suites gate
     each batch independently; the ratchet discipline (entries never re-added without a new
     incident record) keeps the burn-down monotonic; ends with the scan running
     baseline-free — full enforcement.
   - Con: multiple PRs over time — coordination overhead.
2. **Single big-bang PR resolving all 153 entries.**
   - Pro: one review, immediate zero.
   - Con: a cross-cutting deletion PR spanning 4+ packages is unreviewable and risky;
     a single contested entry blocks the entire batch.
3. **Keep the baseline permanently as a tolerated legacy list.**
   - Pro: zero work.
   - Con: institutionalizes 153 unenforced symbols; the ratchet was explicitly introduced
     as temporary (HARNESS-001); dead code keeps misleading SPEC Public API tables.

### Decision

Alternative 1. The driving trade-off is reviewability vs latency: per-package batches keep
every deletion attributable to one SPEC and one test suite. Classification rule per entry:
(a) no consumer anywhere and not in the package SPEC's Public API table → delete; (b)
consumed externally in apps/examples or documented in SPEC as public → wire to the package
surface (index export); (c) intentionally internal-but-kept (e.g. injected seam) →
allowlist WITH reason string. Disposition authority: rule/architecture-grounded cases are
decided in-batch; anything touching product contracts is surfaced before merging that batch.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — baseline 153엔트리의 패키지 분포 확인(agent-core,
      agent-framework, agent-command, agent-playground 외); 스캔의 allowlist 메커니즘과
      reason 문자열 형식 확인(HARNESS-001); ratchet 동작(엔트리 추가 시 실패, 삭제만 허용)
      확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. Generate a per-package triage table from the baseline (entry → classification a/b/c →
   action).
2. Execute per-package batches (separate commits; one PR may carry multiple package batches
   if each batch is independently green): apply deletions/wiring/allowlist moves; remove
   resolved entries from the baseline; update the owning package SPEC Public API table.
3. After the last batch: baseline file is empty → delete the file and the baseline-loading
   branch in the scan (scan runs unconditionally).
4. Each batch gates on: owning package build + typecheck + tests green;
   `pnpm harness:scan:orphan-exports` green.

## Affected Files

- `scripts/harness/orphan-export-baseline.json` (shrinks, then deleted)
- `scripts/harness/` orphan-export scan (baseline-loading branch removed at the end)
- `packages/agent-core/src/**`, `packages/agent-framework/src/**`,
  `packages/agent-command/src/**`, `packages/agent-playground/src/**` 외 baseline 분포
  패키지
- affected `packages/*/docs/SPEC.md` Public API Surface tables

## Completion Criteria

- [ ] TC-01: every baseline entry has a recorded disposition (delete / allowlist+reason /
      wire-to-surface) in the triage table committed with the batches
- [ ] TC-02: `scripts/harness/orphan-export-baseline.json` no longer exists and the scan
      runs without baseline logic
- [ ] TC-03: `pnpm harness:scan:orphan-exports` exits 0 on develop after the final batch
- [ ] TC-04: every allowlist entry added by this work carries a non-empty reason string
      (scan/allowlist content assertion)
- [ ] TC-05: every package touched by a deletion/wiring batch passes
      `pnpm --filter <pkg> build && test` and typecheck in that batch's PR
- [ ] TC-06: SPEC Public API Surface tables of touched packages reflect post-triage exports
      (no row referencing a deleted symbol)

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                     | Notes                                                                                    |
| ----- | ----------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| TC-01 | manual      | triage table review per batch                       | disposition is a human classification decision; the table itself is the durable artifact |
| TC-02 | integration | file-absence check + scan source grep               | baseline retired                                                                         |
| TC-03 | integration | `pnpm harness:scan:orphan-exports` on develop       | exit 0                                                                                   |
| TC-04 | unit        | assertion over allowlist entries (reason non-empty) | scan config test                                                                         |
| TC-05 | integration | per-batch package build/test/typecheck commands     | recorded per batch                                                                       |
| TC-06 | manual      | SPEC table diff review per batch                    | doc prose — verified by direct read at GATE-COMPLETE, not automatable                    |

## Tasks

- [ ] `.agents/tasks/HARNESS-015.md` — T1~T7 (TC-01~TC-06 매핑 + wrap-up)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: RULE` is one of the 11 allowed prefixes; `tags: [harness, typescript]` present.
- Problem: concrete symptom present (153 baselined symbols invisible to scan; `pnpm harness:scan:orphan-exports` stays green after deleting the only consumer of a baselined export); reproduction condition stated explicitly; no "TBD"/"TODO" or vague single-sentence description.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan item `[x]` with completion evidence (baseline package distribution, HARNESS-001 allowlist/reason format, ratchet behavior confirmed); Alternatives Considered has 3 entries each with pro/con; Decision references the driving trade-off (reviewability vs latency).
- Completion Criteria: 6 items, all prefixed TC-01…TC-06; each uses Command form (TC-03, TC-05) or Observable behavior form (TC-01, TC-02, TC-04, TC-06); no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly") used.
- Test Plan: `## Test Plan` section present; 6 rows match 6 TC-N in Completion Criteria (count match confirmed: 6 = 6); every row has non-empty Test Type and Tool/Approach with no "TBD"; manual rows TC-01 and TC-06 each have a non-empty Notes entry explaining why automation is not possible (human classification decision; doc prose verified by direct read).
- Structure: `## Tasks` section present with placeholder (tasks file deferred until GATE-APPROVAL); `## Evidence Log` section present and empty before this first GATE-WRITE run; no `## Status` or `## Classification` sections in the body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: user replied exactly "승인함" on 2026-06-13, after being told verbatim that replying "승인함" authorizes implementation of the 11 designs.
- Direct, unambiguous, directed at this spec: the approval request ("## 설계안 요약 (승인 요청) — 백로그 일괄 11건") individually summarized HARNESS-015's design (per-package triage batches of the 153 baseline entries — delete / allowlist-with-reason / wire-to-surface — until the baseline is empty and the file removed, each batch gated on the owning package's build/test green) and stated that approval triggers GATE-APPROVAL → per-item implementation; "승인함" confirms that design and authorizes implementation. The earlier release instruction ("머지하고 main 릴리스 진행해줘", executed as docs-only release PR #705) was correctly not treated as design approval.
- No Architecture Review or frontmatter type/tags modified after the approval request: only post-GATE-WRITE changes were the guard's Evidence Log entry, the frontmatter status upgrade draft → review-ready, and prettier formatting at commit time (commit cd5b1053a); spec-file git history shows a single commit (cd5b1053a, the GATE-WRITE batch).
- No implementation started before this gate (NON-COMPLIANCE trigger checked): `.agents/tasks/HARNESS-015.md` does not exist (verified by ls); `scripts/harness/orphan-export-baseline.json` still contains its full 153-entry set (verified by JSON count); no implementation commits touch this spec's scope.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/HARNESS-015.md` exists (verified by read) on branch `feat/harness-015-orphan-burndown`.
- Tasks file path recorded in `## Tasks`: the spec's Tasks section lists `.agents/tasks/HARNESS-015.md` — T1~T7 (TC-01~TC-06 매핑 + wrap-up).
- Tasks ↔ Completion Criteria correspondence: T1→TC-01 (per-entry triage table for all 153 entries), T2→TC-02 (baseline file deleted + baseline-loading branch removed), T3→TC-03 (`pnpm harness:scan:orphan-exports` exit 0), T4→TC-04 (non-empty reason string per allowlist entry), T5→TC-05 (per-package build/typecheck/tests green), T6→TC-06 (SPEC Public API tables free of deleted symbols) — one task per TC-N (6/6), plus T7 wrap-up (full harness scan, squash PR to develop, backlog archival).
- NON-COMPLIANCE trigger checked — no implementation commits without tasks file: `git log develop..HEAD` on `feat/harness-015-orphan-burndown` is empty; `scripts/harness/orphan-export-baseline.json` still contains all 153 entries (verified by JSON count); working tree holds only the spec move todo/ → active/ and the new tasks file.
