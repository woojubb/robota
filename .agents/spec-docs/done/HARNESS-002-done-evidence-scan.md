---
status: done
type: RULE
tags: [harness, typescript]
---

# HARNESS-002: Done-backlog evidence regression scan

## Problem

Done-backlog evidence has become false over time with no alarm. Documented cases: CLI-033
claimed 10 headless E2E tests (files no longer exist); CLI-042 claimed grep parallelization
(code is sequential again); CLI-046 claimed `--denied-tools` delivery (flag was never
threaded); REL-003 (critical) sat in `completed/` with status done while the OpenAPITool
stub it was supposed to remove still existed (caught 2026-06-11 only by the unrelated
HARNESS-008 stub-marker scan). The done gate validates at completion time only; nothing
re-validates later, so any later refactor can silently invalidate recorded evidence.

Reproduction: delete any test file referenced in a `.agents/backlog/completed/*.md` evidence
section — `pnpm harness:scan` stays green.

## Architecture Review

### Affected Scope

- `scripts/harness/check-done-evidence.mjs` (new scan) — extract repo-file paths referenced
  in completed-backlog evidence sections; fail when a referenced file no longer exists
- `scripts/harness/run-all-scans.mjs` — register the new scan (aggregating runner,
  HARNESS-011)
- `package.json` — `harness:scan:done-evidence` script
- `scripts/harness/__tests__/check-done-evidence.test.mjs` (new) — fixture-based unit tests
- `.agents/rules/backlog-execution.md` — rule: done evidence for code-changing backlogs
  MUST reference durable artifacts (test file paths)
- `.agents/backlog/completed/*.md` — initial live triage of stale references

### Alternatives Considered

1. **Path-existence scan over completed-backlog evidence sections + durable-artifact rule
   (chosen).**
   - Pro: mechanical, zero-maintenance check that catches the observed failure class
     (referenced file deleted/renamed); aligns with the AGENTS.md principle "prefer a
     mechanical check over more prose"; runs in the same aggregator as the other 22 scans.
   - Con: cannot detect semantic decay (file exists but the test no longer covers the
     claim) — accepted: semantic re-verification is the per-item done gate's job; this scan
     guards the durable-artifact layer beneath it.
2. **Re-run the referenced tests, not just check existence.**
   - Pro: catches semantic decay too.
   - Con: turns a scan into a full test orchestrator (per-package filters, build deps,
     runtimes — minutes per run); the full test suite already runs in CI, so a still-green
     referenced test adds no information beyond existence + suite-green.
3. **One-time audit of completed/ without a recurring scan.**
   - Pro: cheapest.
   - Con: the problem IS recurrence — evidence was true once and decayed; a one-time sweep
     repeats the same blind spot.

### Decision

Alternative 1. The driving trade-off is detection depth vs scan cost: existence checking is
the highest-value/lowest-cost layer (every documented incident involved a now-missing or
never-existing artifact) and composes with CI's suite-green signal to cover semantics.
Extraction rule: paths matching repo-file patterns (`packages/...`, `apps/...`,
`scripts/...` with a file extension) inside completed-backlog markdown; prose without paths
is skipped; an explicit `<!-- evidence-superseded: <reason> -->` annotation (same or
preceding line) exempts a stale reference that has documented replacement evidence.

_Correction during implementation (within the approved Decision): extraction is limited to
EVIDENCE regions (a heading or "Evidence"-led list/bold line opens a region; the next
non-evidence heading closes it) — matching the parent backlog's wording ("test-file paths
referenced in evidence sections"). The draft's whole-document scanning produced 226
findings on the live tree, nearly all historical path mentions in Problem/Plan prose of
pre-convention backlogs whose files were moved by later refactors — those are not evidence
claims and annotating them would be noise, not signal. Evidence-region scanning leaves the
real decayed-evidence class (3 live findings, all triaged with superseded annotations)._

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `scripts/harness/check-*.mjs` 기존 스캔 22종과 등록 방식
      (`run-all-scans.mjs` 집계, HARNESS-011) 확인; 기존 스캔 unit test 패턴
      (fixture 디렉터리 + vitest) 확인 — 동일 구조 채택; done-gate 규칙 문서는
      `.agents/rules/backlog-execution.md`가 소유(중복 작성 금지) 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. `check-done-evidence.mjs`: read `.agents/backlog/completed/*.md`; extract candidate repo
   paths (regex over `packages/|apps/|scripts/` + extension); for each, check existence
   from repo root; report every missing path with its backlog file; exit non-zero if any
   missing and not annotated `evidence-superseded`.
2. Register in `run-all-scans.mjs` (scan count 22 → 23) + `harness:scan:done-evidence`
   pnpm script.
3. Unit tests with fixtures: existing path passes; missing path fails naming backlog +
   path; prose without paths skipped; superseded annotation exempts.
4. Rule line in `.agents/rules/backlog-execution.md`: done evidence for code-changing
   backlogs must cite durable artifacts (test file paths) — enforced by this scan.
5. Initial live triage: run on current `completed/`; for each finding, restore the
   reference or annotate with replacement evidence (CLI-033/042/046/REL-003 already have
   replacement coverage from later backlogs — annotate accordingly).

## Affected Files

- `scripts/harness/check-done-evidence.mjs` (new)
- `scripts/harness/__tests__/check-done-evidence.test.mjs` (new)
- `scripts/harness/run-all-scans.mjs`
- `package.json`
- `.agents/rules/backlog-execution.md`
- `.agents/backlog/completed/*.md` (triage annotations)

## Completion Criteria

- [x] TC-01: fixture with an existing referenced path → scan passes (exit 0)
- [x] TC-02: fixture with a missing referenced path → scan fails (exit ≠ 0) naming both the
      backlog file and the missing path
- [x] TC-03: fixture with prose only (no repo paths) → skipped, scan passes
- [x] TC-04: fixture with a missing path annotated `evidence-superseded` → scan passes and
      reports the exemption count
- [x] TC-05: `pnpm harness:scan:done-evidence` runs the scan standalone;
      `pnpm harness:scan` includes it in the aggregate (23 scans reported)
- [x] TC-06: live run on current `completed/` is green after triage (every stale reference
      restored or annotated with replacement evidence)
- [x] TC-07: `.agents/rules/backlog-execution.md` contains the durable-artifact evidence
      rule referencing this scan

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                        | Notes                                                                                                                                                                                                                  |
| ----- | ----------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | unit        | vitest — fixture completed-backlog dir                 | Test: `scripts/harness/__tests__/check-done-evidence.test.mjs` > `findDoneEvidenceFindings` > "TC-01: an existing referenced path passes"                                                                              |
| TC-02 | unit        | vitest — fixture with missing path                     | Test: `scripts/harness/__tests__/check-done-evidence.test.mjs` > `findDoneEvidenceFindings` > "TC-02: a missing referenced path fails naming the backlog file and the path"                                            |
| TC-03 | unit        | vitest — prose-only fixture                            | Test: `scripts/harness/__tests__/check-done-evidence.test.mjs` > `findDoneEvidenceFindings` > "TC-03: prose without repo paths (and non-evidence prose with paths) is skipped"                                         |
| TC-04 | unit        | vitest — superseded-annotation fixture                 | Test: `scripts/harness/__tests__/check-done-evidence.test.mjs` > `findDoneEvidenceFindings` > "TC-04: an evidence-superseded annotation exempts a missing path and is reported" (+ region-close test in same describe) |
| TC-05 | integration | run pnpm scripts, assert exit codes + aggregate output | Skipped as automated test: command-level integration — verified by live run at GATE-COMPLETE (`pnpm harness:scan:done-evidence` exit 0; `pnpm harness:scan` exit 0, "all 23 scans passed" incl. ✓ done-evidence)       |
| TC-06 | integration | live scan run on repo                                  | Skipped as automated test: live-tree state check, not a fixture — verified by live run at GATE-COMPLETE (exit 0, 3 superseded references reported: CLIR-H02, CLIR-L01, DOC-002)                                        |
| TC-07 | manual      | rule doc diff review                                   | Skipped as automated test: doc prose, not automatable — verified by direct read at GATE-COMPLETE (`.agents/rules/backlog-execution.md` lines 186–192, "Durable-artifact evidence rule (HARNESS-002)")                  |

## Tasks

- [x] `.agents/tasks/completed/HARNESS-002.md` — archived at GATE-COMPLETE (T1~T8 complete, TC-01~TC-07 매핑)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: RULE` is one of the 11 allowed prefixes; `tags: [harness, typescript]` present.
- Problem — concrete symptom: documented false-evidence cases (CLI-033, CLI-042, CLI-046, REL-003) with specific claims vs. actual state; no TBD/TODO/vague single-sentence text.
- Problem — reproduction condition: "delete any test file referenced in a `.agents/backlog/completed/*.md` evidence section — `pnpm harness:scan` stays green".
- Architecture Review Checklist: all 4 items `[x]`; Sibling scan item `[x]` with completion evidence (22 existing `check-*.mjs` scans, `run-all-scans.mjs` registration via HARNESS-011, fixture+vitest test pattern, rule-doc ownership confirmed).
- Alternatives Considered: 3 entries, each with explicit Pro and Con.
- Decision: references the driving trade-off (detection depth vs scan cost) and the extraction/exemption rule.
- Completion Criteria: 7 items, all prefixed TC-01..TC-07; each uses Command form or Observable behavior form (exit codes, output content, doc content); no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly") found.
- Test Plan: section present; 7 rows match 7 TC-N in Completion Criteria (count matches: 7 = 7); every row has non-empty Test Type and Tool/Approach with no "TBD"; the single manual row (TC-07) has a non-empty Notes entry explaining why it is not automatable (doc prose, direct read at GATE-COMPLETE).
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and empty before this first GATE-WRITE entry; no `## Status` or `## Classification` sections in the body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: user replied exactly "승인함" on 2026-06-13, after being told verbatim that replying "승인함" authorizes implementation of the 11 designs.
- Approval directed at this spec: the consolidated approval request "## 설계안 요약 (승인 요청) — 백로그 일괄 11건" individually summarized HARNESS-002's design (23rd scan for test-file paths in `.agents/backlog/completed/*.md` evidence, durable-artifact rule, `evidence-superseded` annotation, initial triage of CLI-033/042/046/REL-003) and stated approval would advance GATE-APPROVAL → per-item implementation; the user's "승인함" is a direct, unambiguous confirmation covering this spec. The earlier release instruction ("머지하고 main 릴리스 진행해줘") and clarifying exchange ("그래서 뭐?") were not treated as approval.
- No post-approval modification of Architecture Review or frontmatter type/tags: only post-GATE-WRITE changes were the guard's Evidence Log entry, the frontmatter status upgrade draft → review-ready, and prettier formatting (commit cd5b1053a, PR #705).
- No implementation before this gate: `.agents/tasks/HARNESS-002.md` does not exist; `scripts/harness/check-done-evidence.mjs` does not exist; no `harness:scan:done-evidence` script in `package.json`; no commits touching these paths.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/HARNESS-002.md` exists (verified on branch `feat/harness-002-done-evidence`; untracked new file in `git status`, no prior implementation commits).
- Tasks file path recorded: spec `## Tasks` section lists `.agents/tasks/HARNESS-002.md — T1~T8 (TC-01~TC-07 매핑 + wrap-up)`.
- Tasks ↔ Completion Criteria mapping (at minimum one task per TC-N): T1↔TC-01 (existing path passes), T2↔TC-02 (missing path fails naming backlog + path), T3↔TC-03 (prose-only skipped), T4↔TC-04 (evidence-superseded exemption + count), T5↔TC-05 (standalone pnpm script + run-all-scans aggregate 23 scans), T6↔TC-06 (live triage green), T7↔TC-07 (backlog-execution.md durable-artifact rule); T8 is wrap-up (harness tests green, PR to develop, backlog archive) beyond the TC set.
- NON-COMPLIANCE trigger checked: no implementation commits exist before tasks-file creation — `scripts/harness/check-done-evidence.mjs` absent, `run-all-scans.mjs` and `package.json` untouched in working tree; only spec move todo/ → active/ and the tasks file are present.

### [GATE-VERIFY] — ❌ FAIL | 2026-06-13

**Status remains:** in-progress
**Failed criteria:**

- Tests pass for affected scope (mapped: `pnpm harness:scan:done-evidence` + `pnpm harness:scan`, per no-package-build scope): `pnpm harness:scan:done-evidence` → exit 1 — "done-evidence scan failed — stale evidence references: `.agents/backlog/completed/DOC-002-multilang-readme.md:62` → `packages/agent-cli/README.ko.md`"; `pnpm harness:scan` → "✗ done-evidence … 1 of 23 scans failed", exit 1. Root cause verified by direct read: DOC-002 has the `<!-- evidence-superseded: README.ko.md retired when docs i18n moved to the docs site (SITE-006/007 ko locales) -->` annotation at line 60, a blank line at 61, and the evidence reference at line 62 — the scanner (`check-done-evidence.mjs` lines 82-83) exempts only same-line or directly-preceding-line annotations, matching its documented contract ("same line or the line directly above the reference"). This blank-line state exists in the PR head commit itself (`git show 9ee90e07a` lines 60-62 identical; `git diff HEAD` clean for this file), so the failure is the branch state, not local drift. Only 2 of the 3 triage annotations (CLIR-H02, CLIR-L01) are effective.
  **Required action:** Move the DOC-002 annotation to the line directly above (or onto) the line-62 evidence reference — and guard against the formatter re-inserting the blank line — then re-run `pnpm harness:scan:done-evidence` (expect 3 superseded exemptions, exit 0) and `pnpm harness:scan` (expect 23/23), commit, and re-run GATE-VERIFY.
- All tasks in `.agents/tasks/HARNESS-002.md` complete: T6 (TC-06 — "initial live triage — scan green on the current `completed/` set") is checked `[x]` but its substance is false on the current branch state (live scan red, above); the backlog closure `.agents/backlog/completed/HARNESS-002-done-evidence-regression-sweep.md` likewise records "`pnpm harness:scan` → all 23 scans passed", which does not hold at the PR head.
  **Required action:** Restore T6's substance with the fix above; the backlog completion claim becomes true again once the live scans are green.

Criteria verified as met during this run (recorded for the re-run):

- Tasks file checked state: T1–T7 all `[x]` (direct read of `.agents/tasks/HARNESS-002.md`); no blocked markers. T8 (wrap-up) unchecked — adjudicated per the established CLI-063..073/HARNESS-011 GATE-VERIFY interpretation (precedent confirmed by direct read of the CLI-073 done-spec GATE-VERIFY entry): PR #715 OPEN (`gh pr view 715 --json state`: OPEN, head `feat/harness-002-done-evidence` → base `develop`); `gh pr checks 715` green — build pass (32s), quality pass (26s), security audit pass (37s), Cloudflare Pages pass; compat-node18 and release-grade verification skipping (by design on feature PRs); backlog closure exists at `.agents/backlog/completed/HARNESS-002-done-evidence-regression-sweep.md` (`status: done`, Completion 2026-06-13 section, User Execution Test Scenarios N/A — harness/internal tooling per the backlog itself). The adjudication structure is sound; the gate fails on scan substance, not on T8.
- Unit tests: `npx vitest run scripts/harness/__tests__/` → 21 files passed, 189/189 tests passed (includes `check-done-evidence.test.mjs`) — met.
- Build mapping: no package source changes in scope (`scripts/harness/*.mjs`, `package.json` script entry, rule/backlog markdown) — `pnpm build` not applicable, consistent with the HARNESS-011 GATE-VERIFY precedent.
- Validity: run on branch `feat/harness-002-done-evidence`; `git status --porcelain` shows only `.agents/evals/lessons/*` modifications — evidence reflects the PR #715 head state.
- In-Decision correction noted: evidence-region-limited extraction is documented inside the approved Decision section (correction paragraph) with rationale (226 non-evidence whole-document findings vs 3 real ones) — not a verification-time SPEC rewrite.

Completion Criteria checkboxes remain unchecked by design: TC-N validation belongs to GATE-COMPLETE.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- Re-run after prior FAIL (same date, above). Sole failing criterion was the DOC-002 annotation adjacency; fix verified: annotation now sits INLINE on the evidence reference line of `.agents/backlog/completed/DOC-002-multilang-readme.md` (formatter-safe — no blank-line separation possible), committed as `0ad9b66f9` "fix(harness): inline DOC-002 evidence-superseded annotation (formatter-safe)" on `feat/harness-002-done-evidence`, pushed (local == origin, 0/0 ahead/behind), `git status` clean for that file.
- Tests pass for affected scope (mapped per no-package-build scope, as in prior run): `pnpm harness:scan:done-evidence` → exit 0, "done-evidence scan passed (3 superseded reference(s))" — all 3 triage exemptions effective (CLIR-H02 → tui-mode.ts, CLIR-L01 → tui-mode.ts, DOC-002 → README.ko.md). `pnpm harness:scan` → "all 23 scans passed", exit 0.
- Unit tests: `npx vitest run scripts/harness/__tests__/check-done-evidence.test.mjs` → 1 file passed, 5/5 tests passed.
- All tasks in `.agents/tasks/HARNESS-002.md` complete: T1–T7 all `[x]` re-confirmed by direct read; no blocked or pending markers. T6's substance is now true (live scan green, above), restoring the backlog closure claim "`pnpm harness:scan` → all 23 scans passed". T8 (wrap-up) unchecked — adjudicated per the established CLI-063..073/HARNESS-011 GATE-VERIFY precedent (validated in the prior run's entry): PR #715 OPEN (`gh pr view 715 --json state`: OPEN, `feat/harness-002-done-evidence` → `develop`, re-confirmed this run), CI checks green and backlog closure file present (`.agents/backlog/completed/HARNESS-002-done-evidence-regression-sweep.md`, status done) per prior run.
- Build mapping: no package source changes in scope (`scripts/harness/*.mjs`, `package.json` script entry, rule/backlog markdown) — `pnpm build` not applicable, consistent with the HARNESS-011 GATE-VERIFY precedent (carried from prior run; no scope change since).
- Validity: run on branch `feat/harness-002-done-evidence` at `0ad9b66f9`; `git status --porcelain` shows only `.agents/evals/lessons/*` modifications — evidence reflects the pushed PR #715 head state.

Completion Criteria checkboxes remain unchecked by design: TC-N validation belongs to GATE-COMPLETE.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

- Checkbox: TC-01 is `[x]` in `## Completion Criteria`.
- Command: `npx vitest run scripts/harness/__tests__/check-done-evidence.test.mjs`
- Output: `✓ scripts/harness/__tests__/check-done-evidence.test.mjs (5 tests) 6ms — Test Files 1 passed (1), Tests 5 passed (5)`; includes test "TC-01: an existing referenced path passes". Exit code 0.
- Test reference recorded in Test Plan: `check-done-evidence.test.mjs > findDoneEvidenceFindings > "TC-01: an existing referenced path passes"`.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

- Checkbox: TC-02 is `[x]` in `## Completion Criteria`.
- Command: `npx vitest run scripts/harness/__tests__/check-done-evidence.test.mjs` (same run as TC-01)
- Output: 5/5 tests passed; includes test "TC-02: a missing referenced path fails naming the backlog file and the path". Exit code 0.
- Test reference recorded in Test Plan: `check-done-evidence.test.mjs > findDoneEvidenceFindings > "TC-02: a missing referenced path fails naming the backlog file and the path"`.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-06-13

- Checkbox: TC-03 is `[x]` in `## Completion Criteria`.
- Command: `npx vitest run scripts/harness/__tests__/check-done-evidence.test.mjs` (same run as TC-01)
- Output: 5/5 tests passed; includes test "TC-03: prose without repo paths (and non-evidence prose with paths) is skipped". Exit code 0.
- Test reference recorded in Test Plan: `check-done-evidence.test.mjs > findDoneEvidenceFindings > "TC-03: prose without repo paths (and non-evidence prose with paths) is skipped"`.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-06-13

- Checkbox: TC-04 is `[x]` in `## Completion Criteria`.
- Command: `npx vitest run scripts/harness/__tests__/check-done-evidence.test.mjs` (same run as TC-01)
- Output: 5/5 tests passed; includes test "TC-04: an evidence-superseded annotation exempts a missing path and is reported", plus the region-close test "closes the evidence region at the next non-evidence heading". Exit code 0.
- Test reference recorded in Test Plan: `check-done-evidence.test.mjs > findDoneEvidenceFindings > "TC-04: an evidence-superseded annotation exempts a missing path and is reported"`.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-06-13

- Checkbox: TC-05 is `[x]` in `## Completion Criteria`.
- Command 1 (standalone): `pnpm harness:scan:done-evidence` → output "done-evidence scan passed (3 superseded reference(s))." with the 3 exemptions listed (CLIR-H02 → tui-mode.ts, CLIR-L01 → tui-mode.ts, DOC-002 → README.ko.md). Exit code 0.
- Command 2 (aggregate): `pnpm harness:scan` → summary lists `✓ done-evidence` among 23 ✓ lines, final line "all 23 scans passed". Exit code 0.
- Test Plan row updated with explicit skip reason (command-level integration verified by live run; no fixture test).

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-06-13

- Checkbox: TC-06 is `[x]` in `## Completion Criteria`.
- Command: `pnpm harness:scan:done-evidence` (live run on current `.agents/backlog/completed/`, same run as TC-05 command 1)
- Output: green — "done-evidence scan passed (3 superseded reference(s))."; the triage state holds: 3 annotated stale references reported as superseded exemptions (`CLIR-H02-shellexec-duplication.md` → `packages/agent-cli/src/modes/tui-mode.ts`, `CLIR-L01-agent-name-hardcoded.md` → `packages/agent-cli/src/modes/tui-mode.ts`, `DOC-002-multilang-readme.md` → `packages/agent-cli/README.ko.md`), zero unannotated missing paths. Exit code 0.
- Test Plan row updated with explicit skip reason (live-tree state check verified by live run).

### [GATE-COMPLETE: TC-07] — ✅ PASS | 2026-06-13

- Checkbox: TC-07 is `[x]` in `## Completion Criteria`.
- Action: direct read of `.agents/rules/backlog-execution.md` — lines 186–192 contain the paragraph "**Durable-artifact evidence rule (HARNESS-002).** For code-changing backlogs, evidence MUST reference durable artifacts — test file paths that exist in the repository. Evidence sections of completed backlogs are continuously re-validated by `pnpm harness:scan:done-evidence` (`scripts/harness/check-done-evidence.mjs`, part of the `harness:scan` aggregate) … annotate the reference with `<!-- evidence-superseded: <reason> -->` on the same or the preceding line — exemptions are reported on every run, never silent."
- The rule names this scan and the annotation contract, satisfying the criterion.
- Test Plan row updated with explicit skip reason (doc prose, manual direct read — not automatable).

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- Completion Criteria: all 7 checkboxes (TC-01..TC-07) are `[x]`, and each has a matching `[GATE-COMPLETE: TC-N]` evidence entry above with exact command, observed output, and exit code.
- Test Plan: all 7 rows updated — TC-01..TC-04 carry test file + describe/test-name references; TC-05..TC-07 carry explicit skip reasons (live-run integration ×2, manual doc read ×1). No TC-N silently unaddressed.
- Tasks file archived: `.agents/tasks/completed/HARNESS-002.md` exists with T1–T8 all `[x]` (T1↔TC-01 … T7↔TC-07, T8 wrap-up), verified by direct read.
- `## Tasks` section reflects the archived path (`.agents/tasks/completed/HARNESS-002.md — archived at GATE-COMPLETE`).
- Backlog closure: `.agents/backlog/completed/HARNESS-002-done-evidence-regression-sweep.md` has `status: done`; done gate satisfied — `## User Execution Test Scenarios` section is N/A per the backlog itself (harness/internal tooling), recorded in its Completion section.
- Validity: all commands run 2026-06-13 from repo root on branch `develop` working tree; aggregate scan re-run with captured exit code (`pnpm harness:scan` → exit 0, 23/23 ✓).
