---
status: done
type: INFRA
tags: [i18n]
---

# INFRA-134: Claude PR review output is English

## Problem

The pull-request workflow `.github/workflows/claude-code-review.yml` supplies Claude Code Action with
a predominantly Korean `prompt`, so the action follows that conversational language and posts its PR
summary and inline review comments in Korean. Reproduce on a same-repository pull request that triggers
`Claude Code Review`: inspect the action-authored PR summary or inline finding and observe Korean prose.

This item applies only to the automated PR review action and does not change other Claude Code sessions
or the repository's user-facing language policy. no-issue: captured directly from the owner request in
this conversation.

## Prior Art Research

Anthropic's official Claude Code Action defines `prompt` as the instructions supplied to Claude, and
its automated PR-review example uses that prompt to direct the review comments Claude posts. The action
does not document a separate `language` or `locale` input. See the
[custom automations guide](https://github.com/anthropics/claude-code-action/blob/main/docs/custom-automations.md)
and [action input schema](https://github.com/anthropics/claude-code-action/blob/main/action.yml).

Anthropic's multilingual guidance states that Claude infers its response language from the conversation
and recommends explicitly stating the target language for production applications; it identifies a
system prompt as the most reliable placement when the constraint must remain stable across turns. See
[Multilingual support](https://platform.claude.com/docs/en/build-with-claude/multilingual-support).

The applicable constraint for Robota is therefore prompt ownership: the PR-review workflow must state
the English output contract in the instructions it owns, rather than relying on a repository locale or
an action input that does not exist.

## Architecture Review

### Affected Scope

- CI presentation surface: `.github/workflows/claude-code-review.yml`
- Existing workflow contract guard: `scripts/harness/scan-claude-review-coverage.mjs`
- Guard tests: `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs`
- No package, public API, type contract, or runtime product behavior changes.

### Alternatives Considered

1. Translate the full PR-review prompt to English and explicitly require every summary and inline
   comment to be written in English. Pro: removes the Korean context that currently drives language
   inference and makes the intended output unambiguous. Con: the workflow carries a larger prose-only
   diff, and future prompt edits need a guard to avoid reintroducing mixed-language instructions.
2. Keep the Korean prompt and append one English-language instruction. Pro: smallest workflow diff.
   Con: it leaves competing language signals in the same prompt, so the generated review language
   remains inference-sensitive.
3. Add `--append-system-prompt` through `claude_args` in addition to translating the prompt. Pro: places
   the invariant at a stronger instruction level. Con: expands reliance on CLI pass-through argument
   parsing when the action's documented `prompt` input is already the owner of this automation.

### Decision

Choose alternative 1. Translate the complete action prompt to English, add an explicit requirement that
the PR summary and every inline review comment use English, and extend the existing Claude-review coverage
guard to reject a missing English-output instruction or Hangul inside the governed prompt. This keeps the
contract in the workflow's documented prompt input while mechanically preventing the mixed-language state
that caused the symptom. The `--append-system-prompt` alternative is unnecessary unless evidence later
shows that an all-English prompt plus an explicit output instruction is insufficient.

The change intentionally promotes only the output-language contract and the scanner's existing exact
review markers to mechanical invariants. The translated prompt retains the existing review threshold,
summary-before-inline ordering, command sequence, five-comment cap, and action-level turn budget without
adding new scanner ownership for those prose details. Review of the workflow diff must confirm that no
action configuration outside the `prompt: |` body changes.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: this is the sole workflow invoking the governed PR review action
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Recommendation Review

- `DEPTH: id=INFRA-134 outcome=LOCAL` — 2026-08-27. The action-owned Korean prompt is the direct
  causal input, and the existing prompt parser is the correct regression boundary.
- `REVIEW VERDICT: ENDORSE` — 2026-08-27. Independent re-review endorsed the full English prompt,
  explicit output-language contract, and mixed-language mutation coverage after two bounded revisions.

## Fallback & Degradation Declaration

None

## Solution

Translate only the `prompt: |` body owned by the Claude PR-review action, leaving action configuration
outside that block unchanged and preserving the exact SHA and finding-count protocol markers. Add an
explicit English-only instruction near the start of the prompt. Extend `scan-claude-review-coverage`
with a prompt-language contract, update its scope description to name that contract, and cover missing
instruction, mixed-language, and acceptance paths in its existing Vitest suite.

## User Execution Test Scenarios

Not applicable — this item changes repository-owned GitHub Actions review instructions and internal
harness enforcement, but exposes no runnable behavior through the canonical Robota CLI, TUI, browser UI,
or public SDK/example surfaces. Hosted PR output is repository CI/governance evidence rather than a
shipped Robota product surface, so it remains in the engineering Test Plan. The author-owned PLAN verdict
is `SCENARIO DRAFTED: not-applicable | 0`; no product capability is hidden behind an unwired seam.

## Affected Files

- `.github/workflows/claude-code-review.yml`
- `scripts/harness/scan-claude-review-coverage.mjs`
- `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs`

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` exits 0 and proves the guard rejects both a governed prompt without the explicit English-output contract and a prompt that retains the contract but contains Hangul.
- [x] TC-02: `node scripts/harness/scan-claude-review-coverage.mjs` exits 0 with the live PR-review prompt containing the English-output contract and no Hangul.
- [x] TC-03: `pnpm harness:scan` exits 0 while preserving the exact `REVIEWED BASE`, `REVIEWED HEAD`, and `ACTIONABLE FINDINGS` protocol markers.
- [x] TC-04: the repository's workflow actionlint check exits 0 for `.github/workflows/claude-code-review.yml` after the prompt translation.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                      | Notes                                                                                                                                                                                                                                  |
| ----- | ------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | CI contract unit test    | Vitest against `findWorkflowCoverageFindings`                        | Test written: `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` > `rejects a reviewer prompt without the explicit English-output contract` and `rejects Hangul even when the explicit English-output contract remains`. |
| TC-02 | CI pipeline smoke test   | `node scripts/harness/scan-claude-review-coverage.mjs`               | Test written: `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` > `is registered and passes on the live repository`.                                                                                                    |
| TC-03 | Repository contract test | `pnpm harness:scan`                                                  | Test written: `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` > marker mutation cases for `REVIEWED BASE`, `REVIEWED HEAD`, and `ACTIONABLE FINDINGS`; the aggregate scan passed separately.                          |
| TC-04 | Workflow syntax test     | Existing actionlint workflow command from `.github/workflows/ci.yml` | Test skipped: no duplicate repository actionlint test was added because CI owns the pinned executable; the exact pinned 1.7.7 command was executed directly and passed.                                                                |

The workflow diff is also reviewed to confirm that keys and values outside the action's `prompt: |`
body are unchanged. This is a scope check, not a substitute for TC-01 through TC-04.

## Tasks

- [x] `.agents/tasks/completed/INFRA-134-claude-pr-review-output-is-english.md` — done

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-27

**Status upgrade:** draft → review-ready

- Frontmatter/block: PASS — the file begins with a closed YAML frontmatter block.
- Frontmatter/status: PASS — `status: draft` is present and matches the entry-gate state and folder.
- Frontmatter/type: PASS — `type: INFRA` is one of the 11 permitted values.
- Frontmatter/tags: PASS — `tags: [i18n]` is present.
- Problem/symptom: PASS — the document identifies the Korean Claude-authored PR summary and inline comments as the concrete wrong behavior.
- Problem/reproduction: PASS — it identifies a same-repository PR triggering `Claude Code Review` and inspection of the action-authored output as the reproduction condition.
- Problem/completeness: PASS — the section is substantive and contains no `TBD`, `TODO`, or vague single-sentence placeholder.
- Prior Art Research/section: PASS — `## Prior Art Research` is present.
- Prior Art Research/substantiation: PASS — it cites Anthropic's official Claude Code Action automation guide, action input schema, and multilingual guidance.
- Prior Art Research/route: PASS — the documentation-citation route is satisfied, so a waiver is not required.
- Prior Art Research/decision feed: PASS — the finding that `prompt` owns the instruction and no separate locale input is documented directly in Alternatives 1–3 and the selected Decision.
- Architecture/checklist: PASS — all four checklist items are checked.
- Architecture/sibling scan: PASS — the checked item records `N/A` because this is the sole workflow invoking the governed PR-review action.
- Architecture/alternatives: PASS — three alternatives each include an explicit pro and con.
- Architecture/decision: PASS — the Decision selects full prompt translation plus an explicit English-output contract and names the mixed-language inference and CLI pass-through trade-offs.
- Architecture/new-surface placement: PASS (N/A) — the change modifies an existing CI presentation workflow and guard; it introduces no package, app, presentation/interface surface, or layer/product-family reclassification.
- Completion Criteria/prefixes: PASS — all four criteria use unique `TC-01` through `TC-04` prefixes.
- Completion Criteria/coverage: PASS — the workflow contract, live guard, preserved merge protocol, and workflow syntax are each covered by a criterion.
- Completion Criteria/observability: PASS — every criterion specifies an exact command/check with exit 0 and/or an exact observable prompt/protocol property.
- Completion Criteria/vagueness: PASS — none uses `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- Test Plan/section: PASS — `## Test Plan` is present.
- Test Plan/count: PASS — four Test Plan rows match the four Completion Criteria (`TC-01`–`TC-04`).
- Test Plan/fields: PASS — every row has a non-empty Test Type and Tool / Approach, with no `TBD`.
- Test Plan/manual: PASS (N/A) — no row uses a manual tool, so no manual-test justification is required.
- Structure/tasks: PASS — `## Tasks` contains the paired `.agents/tasks/INFRA-134-claude-pr-review-output-is-english.md` path.
- Structure/evidence: PASS — `## Evidence Log` was present and empty before this first GATE-WRITE entry.
- Structure/body fields: PASS — no `## Status` or `## Classification` section appears in the body.
- Count reconciliation: PASS — Completion Criteria 4/4 and Test Plan rows 4/4 match exactly.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-27

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함"
**Given:** 2026-08-27, this conversation

- Ordering/prior gate: PASS — this document contains a specific `GATE-WRITE` PASS entry dated 2026-08-27.
- Ordering/input state: PASS — frontmatter is `status: review-ready` and the document is in `.agents/spec-docs/backlog/`, the expected GATE-APPROVAL input state.
- DIRECT/current-conversation approval: PASS — the user supplied the verbatim approval above in this document's current conversation.
- DIRECT/unambiguous document scope: PASS — the approval followed the presented INFRA-134 plan and explicitly authorized this exact backlog item.
- Post-approval integrity: PASS — the Architecture Review and frontmatter `type: INFRA` / `tags: [i18n]` remain unchanged after the approval in this gate invocation.
- Independent architecture validation: PASS (N/A) — the spec modifies an existing PR-review workflow and its existing guard/test; it introduces no package, app, presentation/interface surface, or layer/product-family reclassification.
- Pre-approval implementation: PASS — the three implementation paths named in `## Affected Files` have no staged or unstaged changes, and their latest recorded commit predates this item; implementation did not start before this gate.

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-27

**Status remains:** approved
**Failed criteria:**

- Whole-worktree planning-only inventory: the worktree contains the exact paired Task/spec artifacts, but
  also contains modifications to `.agents/loop-runs/backlog-execution-orchestrator.jsonl`,
  `.agents/loop-runs/user-execution-scenario.jsonl`, and
  `.agents/loop-runs/user-request-gate.jsonl`. The PLAN run added to
  `user-execution-scenario.jsonl` has `ref: null`, so it is not a permitted subject-bound PLAN ledger
  record for INFRA-134; the other two modified loop ledgers are likewise outside the exact paired
  planning artifacts. No implementation path is modified or committed, so this is a remediable gate
  failure rather than retrospective-plan non-compliance.
  **Required action:** restore the worktree to the exact INFRA-134 Task/spec pair plus only a PLAN ledger
  record whose `ref` names this Task path or basename, then re-run GATE-IMPLEMENT.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-27

**Status upgrade:** approved → in-progress

- Ordering/prior gate: PASS — this document contains a specific `GATE-APPROVAL` PASS entry dated 2026-08-27.
- Ordering/input state: PASS — frontmatter is `status: approved` and the document is in `.agents/spec-docs/todo/`, the expected GATE-IMPLEMENT input state and folder.
- Task artifact: PASS — `.agents/tasks/INFRA-134-claude-pr-review-output-is-english.md` exists.
- Task link: PASS — `## Tasks` records the exact paired Task path `.agents/tasks/INFRA-134-claude-pr-review-output-is-english.md`.
- Completion-Criteria correspondence: PASS — TC-01 is covered by the scanner-contract and Vitest-mutation tasks; TC-02 by the prompt-translation, explicit-English, and scanner tasks; TC-03 by marker preservation plus the repository-harness task; and TC-04 by the CI-owned actionlint verification task.
- Task Test Plan: PASS — the Task contains a substantive `## Test Plan` section longer than 50 characters, with targeted Vitest, live scanner, full harness, and actionlint verification commands/approaches.
- User-execution PLAN outcome: PASS — the exact Task records `SCENARIO DRAFTED: not-applicable | 0` and a concrete author-owned reason: this repository CI/governance change exposes no runnable Robota CLI, TUI, browser UI, or public SDK/example surface; the earlier attempted scenario and `DONE-GATE-STAGE-1` FAIL remain as audit history.
- Whole-worktree inventory: PASS — the only changed paths are the paired `.agents/spec-docs/todo/INFRA-134-claude-pr-review-output-is-english.md`, `.agents/tasks/INFRA-134-claude-pr-review-output-is-english.md`, and one append-only closed `.agents/loop-runs/user-execution-scenario.jsonl` PLAN ledger record whose `ref` is the exact Task path.
- Pre-implementation integrity: PASS — `.github/workflows/claude-code-review.yml`, `scripts/harness/scan-claude-review-coverage.mjs`, and `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` have no staged, unstaged, untracked, renamed, deleted, or topic-branch committed implementation change before this gate.

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-27

**Status remains:** in-progress
**Failed criteria:**

- Mechanically complete subject-bound PLAN outcome: `.agents/tasks/INFRA-134-claude-pr-review-output-is-english.md` contains the exact author signal `SCENARIO DRAFTED: not-applicable | 0` and a semantically concrete reason, but the reason precedes the signal. `scan-user-execution-plan-order.mjs --staged` searches for the not-applicable reason after the canonical signal and reports `not-applicable PLAN lacks its zero count and a concrete recorded reason.`
  **Required action:** keep exactly one canonical author verdict and place the concrete not-applicable reason after the `**Author verdict:**` line containing `SCENARIO DRAFTED: not-applicable | 0` in the Task's scenario section, then re-run GATE-IMPLEMENT.
- Parser-complete PASS cardinality: the existing GATE-IMPLEMENT PASS already contains the exact `.agents/tasks/INFRA-134-claude-pr-review-output-is-english.md`, accepted `.agents/spec-docs/todo/INFRA-134-claude-pr-review-output-is-english.md`, exact scenario signal, and whole-worktree evidence, so it is parser-complete after the author signal correction. Appending another parser-complete PASS naming `.agents/spec-docs/active/INFRA-134-claude-pr-review-output-is-english.md` would make the scanner count two complete PASS entries and reject the checkpoint's exactly-one requirement.
  **Required action:** do not append a second complete PASS; preserve one mechanically complete GATE-IMPLEMENT PASS when correcting the Task reason placement.

### [GATE-VERIFY] — ✅ PASS | 2026-08-27

**Status upgrade:** in-progress → verifying

- Ordering/prior gate: PASS — this document contains one mechanically complete `GATE-IMPLEMENT` PASS dated 2026-08-27; the Task now places the concrete not-applicable reason after the canonical `SCENARIO DRAFTED: not-applicable | 0` author verdict, satisfying the correction recorded by the later audit entry without duplicating the required PASS.
- Ordering/input state: PASS — frontmatter is `status: in-progress` and the document is in `.agents/spec-docs/active/`, the expected GATE-VERIFY input state and folder.
- Task completion: PASS — all four Plan tasks in `.agents/tasks/INFRA-134-claude-pr-review-output-is-english.md` are marked `[x]`; no unchecked task remains.
- Blocked/pending state: PASS — the Task contains no blocked or pending Plan item; its historical `DONE-GATE-STAGE-1` failure is retained as scenario audit history and the final author-owned PLAN outcome is the reasoned `not-applicable | 0` verdict.
- Build: PASS — `pnpm build` was independently re-run against the current implementation commit and exited 0 after completing all 11 ordered type-build tiers. The recorded full gate `pnpm harness:verify-like-ci -- --base-ref origin/develop` also passed all 13/13 local CI-mirror stages, including the monorepo build, workspace typecheck, lint, examples typecheck, and TUI tests.
- Tests: PASS — no package source is affected, so there is no affected-package `pnpm test` scope. The affected harness test was independently re-run with `pnpm exec vitest run scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` and passed 17/17; the recorded full CI mirror additionally passed 3,922/3,922 harness contract tests and 1,149/1,149 hermetic tests.
- Live contract verification: PASS — `node scripts/harness/scan-claude-review-coverage.mjs` examined one governed workflow and returned `claude-review-coverage: PASS`; an independent `pnpm harness:scan` re-run passed 145 scans with two declared skips and no failures.
- Workflow syntax: PASS — the CI-pinned actionlint 1.7.7 archive matched SHA-256 `023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757`, and the repository-wide `actionlint -color` invocation exited 0 with no findings.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-27

- **Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-claude-review-coverage.test.mjs`.
- **Observed result:** Vitest reported `Test Files 1 passed (1)` and `Tests 17 passed (17)`; the governed-prompt mutations for a removed English-output instruction and retained instruction plus Hangul both passed as rejection cases.
- **Exit code:** `0`.
- **Test written:** `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` > `scan-claude-review-coverage (INFRA-098)` > `rejects a reviewer prompt without the explicit English-output contract` and `rejects Hangul even when the explicit English-output contract remains`.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-27

- **Command:** `node scripts/harness/scan-claude-review-coverage.mjs`.
- **Observed result:** `::examined:: 1 governed workflow(s)` followed by `claude-review-coverage: PASS`; the live governed prompt therefore retained the exact English-output contract and produced no Hangul finding.
- **Exit code:** `0`.
- **Test written:** `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` > `scan-claude-review-coverage (INFRA-098)` > `is registered and passes on the live repository`.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-27

- **Command:** `pnpm harness:scan`.
- **Observed result:** `145 scans passed, 2 skipped (97 declared what they examined)` with no failures; `claude-review-coverage` passed. The focused marker contract is covered by the named parameterized mutation test for `REVIEWED BASE`, `REVIEWED HEAD`, and `ACTIONABLE FINDINGS`.
- **Exit code:** `0`.
- **Test written:** `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` > `scan-claude-review-coverage (INFRA-098)` > `it.each(['REVIEWED BASE', 'REVIEWED HEAD', 'ACTIONABLE FINDINGS'])('rejects a missing %s marker')`.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-27

- **Action/command:** reproduced the CI-owned `.github/workflows/ci.yml` actionlint block with `ACTIONLINT_VERSION=1.7.7` and `ACTIONLINT_SHA256=023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757`: downloaded the pinned archive with `curl -fsSL`, verified it with `sha256sum -c -`, extracted it, asserted `command -v shellcheck`, and ran `"$RUNNER_TEMP/actionlint" -color`. Because this host does not preinstall the CI prerequisite, Ubuntu `shellcheck` 0.11.0 and `libnuma1` were first downloaded and extracted into a temporary directory and exposed only through temporary `PATH`/`LD_LIBRARY_PATH` values.
- **Observed result:** the prerequisite-free first attempt stopped at the repository's fail-closed ShellCheck assertion with exit `1`; the CI-equivalent retry printed `ShellCheck ... version: 0.11.0`, verified `actionlint.tar.gz: OK`, emitted no actionlint finding, and completed successfully.
- **Exit code:** `0` for the CI-equivalent actionlint run.
- **Test skipped:** no duplicate repository test was written because `.github/workflows/ci.yml` owns the pinned actionlint executable, checksum, ShellCheck prerequisite, and repository-wide invocation; this exact owned command was executed directly instead.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-27

**Status upgrade:** verifying → done

- Ordering: PASS — the document is `.agents/spec-docs/active/INFRA-134-claude-pr-review-output-is-english.md` with `status: verifying` and contains one recorded `GATE-VERIFY` PASS.
- Completion Criteria: PASS — TC-01 through TC-04 are all `[x]`, and each has the matching `[GATE-COMPLETE: TC-N]` command/action, observed result, exit code, and test reference or explicit skip reason above.
- Test Plan: PASS — all four TC rows are present; TC-01 through TC-03 name exact test file and test/describe references, while TC-04 records the explicit CI-owned actionlint skip rationale and direct verification.
- Task pointer: PASS — `## Tasks` names the exact active path `.agents/tasks/INFRA-134-claude-pr-review-output-is-english.md`, and that file exists.
- Task readiness: PASS — all four Plan items in the active Task are `[x]`; there is no unchecked, pending, or blocked Plan item. The historical scenario-gate failure remains audit history, while the author-owned final scenario outcome is the reasoned `SCENARIO DRAFTED: not-applicable | 0` verdict.
- Independent verification summary: PASS — targeted Vitest passed 17/17, the live scanner examined one workflow and passed, the repository harness passed 145 scans with two declared skips, and the CI-equivalent pinned actionlint 1.7.7 run passed with its archive checksum and ShellCheck prerequisite verified.
