---
status: done
type: INFRA
tags: [harness, gate]
lane: L2
---

# INFRA-139: Gate judges reject archived Tasks as active

Paired with `.agents/tasks/INFRA-139-gate-judges-reject-archived-tasks-as-active.md`. Arising from [issue #2467](https://github.com/woojubb/robota/issues/2467).

## Problem

When a spec's `## Tasks` section names an existing archived path such as
`.agents/tasks/INFRA-138-gate-judges-accept-archived-tasks-as-active.md` after it has been archived,
the gate's active-task criteria currently pass because
the common reader checks existence without enforcing the active root path. This reproduced in the
DOCS-038 correction: the archived Task was accepted by fresh GATE-IMPLEMENT and later
GATE-COMPLETE. The issue is tracked in the linked issue recorded in frontmatter.

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->

## Prior Art Research

Waived: this is an internal path-contract correction; external products cannot establish the
repository's canonical active-vs-archived Task path, and the governing evidence is the existing
gate implementation plus the DOCS-038 regression.

## Architecture Review

### Affected Scope

`scripts/harness/gate.mjs` (canonical gate reader); `scripts/harness/__tests__/gate.test.mjs`
(regression fixtures); the paired Task/spec and gate evidence only.

### Alternatives Considered

1. Keep existence-only validation.
   - Pro: no code change.
   - Con: archived records can still satisfy active gates.
2. Reject only paths containing the literal `completed` segment.
   - Pro: small patch.
   - Con: other nested/non-canonical paths remain ambiguous.
3. Require the exact root active form `.agents/tasks/<basename>.md` and reject every nested path.
   - Pro: matches the repository contract and is easy to falsify with fixtures.
   - Con: requires updating the shared gate criterion and tests.

### Decision

Choose alternative 3. Exact root-path validation prevents both known archived paths and future
nested aliases while preserving valid active Task behavior; tests cover the adversarial archived
case and the normal root case.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal fix with no contract change; the remedy is the repository's own precedent
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Add archived-path and root-path gate fixtures in `scripts/harness/__tests__/gate.test.mjs`.
2. Update `scripts/harness/gate.mjs` so active-task checks reject any path other than the exact
   `.agents/tasks/<ID>.md` form.
3. Run focused tests, harness scans, and CI-equivalent verification.

## Affected Files

`scripts/harness/gate.mjs`
`scripts/harness/__tests__/gate.test.mjs`
`.agents/tasks/INFRA-139-gate-judges-reject-archived-tasks-as-active.md`
`.agents/spec-docs/draft/INFRA-139-gate-judges-reject-archived-tasks-as-active.md`

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` has a RED archived-path
      regression before the fix and exits 0 after it.
- [x] TC-02: `pnpm harness:scan` exits 0.
- [x] TC-03: `pnpm harness:verify-like-ci` exits 0.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                | Notes                              |
| ----- | --------- | -------------------------------------------------------------- | ---------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` | RED/GREEN regression and full file |
| TC-02 | Suite     | `pnpm harness:scan`                                            | Repository mechanical gates        |
| TC-03 | CI-like   | `pnpm harness:verify-like-ci`                                  | Full CI-equivalent gate            |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [x] `.agents/tasks/completed/INFRA-139-gate-judges-reject-archived-tasks-as-active.md` — done

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready
**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § GATE-WRITE.

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter: `tags:` present (2 values)
- GATE-WRITE — Contains a concrete symptom: the archived Task path produces a false active-gate PASS
- GATE-WRITE — Contains a reproduction condition: DOCS-038 fresh GATE-IMPLEMENT and GATE-COMPLETE accepted `.agents/tasks/completed/<ID>.md`
- GATE-WRITE — Does not contain vague descriptions: `## Problem` is concrete and multi-sentence
- GATE-WRITE — Prior Art Research section present: section present
- GATE-WRITE — Research is substantiated or waived: explicit internal-contract waiver recorded
- GATE-WRITE — Waiver is explicit: `Waived:` line names the reason
- GATE-WRITE — Research feeds Alternatives/Decision: DOCS-038 evidence drives the alternatives and selected exact-path remedy
- GATE-WRITE — Architecture checklist complete: all checklist items are `[x]`
- GATE-WRITE — Sibling scan complete: explicit N/A reason recorded
- GATE-WRITE — Alternatives have pro/con: 3 alternatives each include Pro and Con
- GATE-WRITE — Decision references trade-off: exact root path is chosen for canonicality and falsifiability
- GATE-WRITE — New-surface placement: N/A because no new package, app, interface, or layer is introduced
- GATE-WRITE — Completion criteria use TC-N prefixes: TC-01 through TC-03
- GATE-WRITE — Criteria cover each feature: archived rejection, valid root acceptance, and verification are covered
- GATE-WRITE — Criteria use command/observable form: each criterion names a command or observable gate outcome
- GATE-WRITE — No vague criterion wording: prohibited phrases absent
- GATE-WRITE — Test Plan present: section present
- GATE-WRITE — Test Plan rows match criteria: 3 rows for TC-01 through TC-03
- GATE-WRITE — Test rows have type and approach: all rows populated
- GATE-WRITE — Manual rows explain notes: no manual rows
- GATE-WRITE — Tasks section present: paired Task path recorded
- GATE-WRITE — Evidence Log first entry: no later-gate evidence exists
- GATE-WRITE — No body Status/Classification sections: absent

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "앞으로 너가 타당한 근거와 함께 추천안을 제시하면 그게 타당할 경우 자동승인 하겠습니다."
**Given:** 2026-08-29, this conversation
**Review fingerprint:** 66e41e75b8c4 (review 54a78752, type/tags 2e0398f3)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-29, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (66e41e75b8c4) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-29

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` carries no `**Author verdict:** `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>`` line (0 found, exactly 1 required)
  **Required action:** record the author verdict in the Task

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-139-gate-judges-reject-archived-tasks-as-active.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-139-gate-judges-reject-archived-tasks-as-active.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 4 checkbox tasks for 3 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 210 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/
- GATE-IMPLEMENT — checkpoint binding: `.agents/spec-docs/todo/INFRA-139-gate-judges-reject-archived-tasks-as-active.md`
- GATE-IMPLEMENT — checkpoint PLAN outcome: `SCENARIO DRAFTED: not-applicable | 0`

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-29

**Command:** `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
11:32:08 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /home/ubunutu/dev/robota-5

······································································

 Test Files  1 passed (1)
      Tests  70 passed (70)
   Start at  11:32:08
   Duration  3.85s (transform 139ms, setup 0ms, collect 192ms, tests 3.47s, environment 0ms, prepare 45ms)
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-29

**Command:** `pnpm harness:scan`
**Exit:** 0
**Output:** (last 10 of 165 line(s))

```
⚑ spec-whitebox-leakage: packages/agent-framework/docs/SPEC.md: 2054/2858 lines (71.9%) outside the standard sections — consider extracting to docs/design/
⚑ spec-whitebox-leakage: packages/agent-session/docs/SPEC.md: 318/757 lines (42.0%) outside the standard sections — consider extracting to docs/design/
⚑ progress-report-quantification: progress-report quantification examined 0 transcript(s) — no session transcript for this workspace at /home/ubunutu/.claude/projects/-home-ubunutu-dev-robota-5; the agent-narrative channel does not exist on this host (e.g. CI or a fresh checkout), so nothing was judged.
⚑ dist: @robota-sdk/agent-core: dist/ may be STALE — src/permissions/argument-matchers.ts is 23m 16s newer than dist/node/verdict-decoder-BR3DLEQ3.js.map
⚑ dist: @robota-sdk/agent-framework: dist/ may be STALE — src/tools/tool-permission-profiles.ts is 22m 15s newer than dist/node/index-Bz8hkgV3.d.ts.map
⚑ dist: @robota-sdk/agent-tools: dist/ may be STALE — src/tool-permission-profiles.ts is 22m 59s newer than dist/node/index.d.ts
⚑ dist: 3 package(s) have a dist/ older than their src/. A cross-package type error seen only in a whole-workspace typecheck should be re-checked after `pnpm build` (or `pnpm harness:verify-like-ci`, which rebuilds) before it is treated as a branch defect.

146 scans passed, 2 skipped (98 declared what they examined)
scan receipt written: an unchanged tree will not be re-scanned.
```

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-29

**Command:** `pnpm harness:verify-like-ci`
**Exit:** 0
**Output:** (last 10 of 496 line(s))

```
  - chat-basic: functional test not found: tests/chat-basic.functional.test.ts

Every framework capability needs a kit-based functional test (see .agents/rules/testing-layering.md).
fatal: not a git repository (or any parent up to mount point /)
Stopping at filesystem boundary (GIT_DISCOVERY_ACROSS_FILESYSTEM not set).
(node:3659287) ExperimentalWarning: globSync is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)

===== scan-suite-dist-free =====
mirrors: ci.yml → scans → Harness scan suite (dist-independent)
```

### [GATE-VERIFY] — ❌ FAIL | 2026-08-29

**Status remains:** in-progress
**Failed criteria:**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): no supplied --verify-cmd contains `build`, `harness:scan` or `run-all-scans` (supplied: `pnpm harness:verify-like-ci` → exit 0 (new-rule-declares-enforcement scan FAILED — cannot read the diff against `does/not/exist`. Fetch the base ref (a shallow clone has no merge base), or pass --base-ref explicitly. ⏎ (node:3697208) ExperimentalWarning: globSync is an experimental feature and might change at any time ⏎ (Use `node --trace-warnings ...` to show where the warning was created)); `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` → exit 0 ( Duration 3.97s (transform 142ms, setup 0ms, collect 193ms, tests 3.59s, environment 0ms, prepare 43ms) ⏎ ⏎ 11:41:02 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.))
  **Required action:** pass a build command via --verify-cmd

### [GATE-VERIFY] — ✅ PASS | 2026-08-29

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29; status `in-progress`
- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 4/4 tasks `[x]` in .agents/tasks/INFRA-139-gate-judges-reject-archived-tasks-as-active.md
- GATE-VERIFY — No tasks are blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `pnpm build` → exit 0 ([33m[INEFFECTIVE_DYNAMIC_IMPORT] [0m../agent-builtin-providers/dist/node/index.js is dynamically imported by ../dag-nodes-default/dist/node/index.js but also statically imported by src/eval/eval-command.ts, src/product/robota-subagent-composition.ts, src/startup/command-setup.ts, src/startup/diagnose-command.ts, src/startup/provider-startup.ts, dynamic import will not move module into another chunk. ⏎ ⏎ [33m[INEFFECTIVE_DYNAMIC_IMPORT] [0m../dag-nodes-default/dist/node/index.js is dynamically imported by ../dag-framework/dist/node/index.js but also statically imported by ../agent-command-workflows/dist/node/index.js, dynamic import will not move module into another chunk.); all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` → exit 0 ( Duration 3.89s (transform 126ms, setup 0ms, collect 182ms, tests 3.52s, environment 0ms, prepare 45ms) ⏎ ⏎ 11:42:57 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.); all 2 supplied commands exit 0

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-29

**Status remains:** in-progress
**Failed criteria:**

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: status is `in-progress`, `verifying` expected
  **Required action:** run the prior gate to PASS first

### [GATE-COMPLETE] — ✅ PASS | 2026-08-29

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-08-29; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 3/3 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (3)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 3/3 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/INFRA-139-gate-judges-reject-archived-tasks-as-active.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 4/4 tasks `[x]` in .agents/tasks/INFRA-139-gate-judges-reject-archived-tasks-as-active.md
