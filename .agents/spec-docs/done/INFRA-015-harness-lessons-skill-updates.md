---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-015: Bake architecture-conformance-session lessons into the harness (skill new/updates)

> Source: lessons observed while executing INFRA-002 → INFRA-013 (architecture audit + conformance gate +
> the INFRA-010 type-extraction refactor). Goal: encode each lesson as a new skill or a skill update so the
> same mistakes are not repeated. This backlog enumerates the list; each item is a concrete skill change.

## Problem

The architecture-conformance work surfaced repeatable process mistakes that the current harness/skills do
not prevent. Each occurred at least once this session and cost a re-run or a recovery:

1. **Gate-order inversion** — GATE-IMPLEMENT was run on INFRA-006 before GATE-WRITE/GATE-APPROVAL. The
   `backlog-pipeline` state machine documents the order, but `backlog-gate-guard` does not _precondition_
   each gate on the prior gate's PASS Evidence, so a manually-driven out-of-order run is not caught.
2. **Sandbox lockfile pruning** — running `pnpm install` to add a workspace dep in the network-restricted
   sandbox regenerated/pruned `pnpm-lock.yaml` by ~9,500 lines (DATA-001). No skill warns that workspace-dep
   additions must be a _surgical_ lockfile edit verified with `--frozen-lockfile`.
3. **Test Plan authoring for doc/process backlogs** — two GATE-WRITE FAILs (INFRA-005, INFRA-006) because
   `manual` Test Plan rows lacked an infeasibility justification when a command-form (`rg`/CI smoke) check
   was actually possible. `backlog-writer` doesn't steer doc/process backlogs toward command-form rows.
4. **Trusting a subagent's "green" claim** — a delegated refactor reported all-green, but independent
   re-run caught the pruned lockfile. No skill mandates re-verifying a subagent's gate claims for code changes.
5. **Post-merge branch cycle** — branching for INFRA-008 cut from the wrong base because uncommitted evals
   churn blocked `git checkout develop`, so the new branch forked off the previous feature branch. No skill
   codifies the "stash evals → checkout develop → pull → branch" cycle.
6. **Large-refactor delegation** — delegating a big mechanical refactor to a subagent with a hard
   "reach build/typecheck/test/dep-direction green or report blockers, leave no broken commit" contract
   worked well (DATA-001/INFRA-012/INFRA-013) but is not captured as a reusable pattern.
7. **Guard scoping discipline** — the INFRA-013 guard surfaced out-of-scope leaks (apps/agent-server). The
   good behavior (declare scope, capture out-of-scope findings as a backlog) should be a documented norm.

## Architecture Review

### Affected Scope

- `.agents/skills/**` (new skills + updates) and `.agents/skills/index.md` registration.
- Possibly `.agents/rules/git-branch.md` (post-merge branch cycle) and `pnpm-monorepo-build` skill (lockfile).
- No `packages/*` production code.

### Alternatives Considered

1. **Leave lessons in memory/commit messages only.** Pro: zero work. Con: lessons aren't enforced; the
   harness keeps allowing the same mistakes. Rejected (the user wants them baked into the harness).
2. **Encode each lesson as a new skill or a precise skill/rule update + register them.** Pro: the harness
   actively prevents recurrence; discoverable. Con: several skill edits. Chosen — this backlog lists them.

### Decision

Alternative 2. Implement the enumerated skill new/updates below. Items are independent; if the set proves
large at GATE-IMPLEMENT, decompose into per-skill child backlogs (layered-assembly), but the list is the
single source here.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — `.agents/skills/**`, index, possibly git-branch rule; no packages/\* code
- [x] Sibling scan 완료 — existing skills reviewed: backlog-pipeline, backlog-gate-guard, backlog-writer, pnpm-monorepo-build, post-implementation-checklist, harness-governance, git-branch rule
- [x] 대안 최소 2개 검토 완료 — 2 alternatives above
- [x] 결정 근거 문서화 완료 — Decision records enforce-in-harness over memory-only

## Solution — the skill new/update list

| #   | Lesson                         | Skill action                                                                                                                                                                                                                                                                                                                                | Type          |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| S1  | Gate-order inversion (#1)      | **UPDATE `backlog-gate-guard`**: each gate begins with a "prior-gate precondition" check — verify the prior gate's PASS Evidence entry exists (and the file is in the expected folder/status); return NON-COMPLIANCE if a gate is run out of order.                                                                                         | update        |
| S2  | Sandbox lockfile pruning (#2)  | **UPDATE `pnpm-monorepo-build`** (or NEW `workspace-dependency-change`): to add/remove a workspace dep, edit `package.json` + apply a _surgical_ `pnpm-lock.yaml` `dependencies:` block (`link:../<pkg>`); verify with `pnpm install --frozen-lockfile`; NEVER commit a lockfile regenerated by `pnpm install` in a network-restricted env. | update or new |
| S3  | Test Plan authoring (#3)       | **UPDATE `backlog-writer`**: for doc/process backlogs prefer command-form / CI-smoke Test Plan rows (`rg`, `pnpm harness:*`); a `manual` row REQUIRES a Notes entry explaining why automation is infeasible.                                                                                                                                | update        |
| S4  | Trusting subagent green (#4)   | **UPDATE `post-implementation-checklist`** (or NEW `verify-delegated-work`): for any code change, the orchestrator independently re-runs the key gates (typecheck, the relevant scan, frozen-lockfile) before trusting a subagent's "green" claim.                                                                                          | update or new |
| S5  | Post-merge branch cycle (#5)   | **UPDATE `.agents/rules/git-branch.md`** (or NEW skill): the canonical cycle is stash transient churn (evals lessons) → `git checkout develop` → `git pull` → branch; verify the new branch's base is the freshly-pulled develop.                                                                                                           | update        |
| S6  | Large-refactor delegation (#6) | **NEW skill `delegated-refactor-green-gate`**: pattern for handing a large mechanical change to a subagent with a hard completion gate (build/typecheck/test/dep-direction green or report blockers; no broken commit; leave changes unstaged for orchestrator review).                                                                     | new           |
| S7  | Guard scoping discipline (#7)  | **UPDATE `architecture-conformance-audit`/`harness-governance`**: when adding a mechanical guard, declare its scope explicitly and capture out-of-scope findings as a backlog (don't silently widen or drop them).                                                                                                                          | update        |

## Affected Files

- `.agents/skills/backlog-gate-guard/SKILL.md` (S1)
- `.agents/skills/pnpm-monorepo-build/SKILL.md` or new `.agents/skills/workspace-dependency-change/SKILL.md` (S2)
- `.agents/skills/backlog-writer/SKILL.md` (S3)
- `.agents/skills/post-implementation-checklist/SKILL.md` or new `verify-delegated-work` (S4)
- `.agents/rules/git-branch.md` (S5)
- `.agents/skills/delegated-refactor-green-gate/SKILL.md` (NEW, S6)
- `.agents/skills/harness-governance/SKILL.md` and/or `architecture-conformance-audit` (S7)
- `.agents/skills/index.md` (register any new skills)

## Completion Criteria

- [x] TC-01: Each of S1–S7 is implemented as the stated skill new/update (the corresponding SKILL.md / rule
      file contains the new guidance), and every NEW skill is registered in `.agents/skills/index.md`.
- [x] TC-02: The AGENTS.md conflict-scan
      (`rg -n "any/unknown may|fallback to|temporary workaround" .agents/skills`) returns no new violations,
      and no new/updated skill redefines a rule (each cites a Rule Anchor).
- [x] TC-03: `pnpm harness:scan` exits 0 (consistency/anchor checks pass for the edited skills).

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                                      | Notes                                                                                  |
| ----- | ---------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| TC-01 | manual                 | Inspect each S1–S7 target file for the added guidance + index registration           | Coverage is the assertion; skills are prose, no automated test judges guidance quality |
| TC-02 | CI pipeline smoke test | `rg` conflict-scan over `.agents/skills`; confirm each new skill cites a Rule Anchor | Command-form                                                                           |
| TC-03 | CI pipeline smoke test | `pnpm harness:scan` exit 0 (consistency + anchor scans)                              | doc-only change                                                                        |

## Tasks

- [x] `.agents/tasks/completed/INFRA-015.md` (archived) — one task per Completion Criterion (TC-01 with S1–S7 subtasks, TC-02, TC-03) + Test Plan section.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: INFRA` (valid 11-prefix value); `tags: [typescript]` present.
- Problem section: concrete symptoms (out-of-order GATE-IMPLEMENT on INFRA-006; ~9,500-line lockfile prune; two GATE-WRITE FAILs on INFRA-005/006) with reproduction conditions; no TBD/TODO/vague single-sentence text.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with concrete completion evidence; Alternatives Considered has 2 entries each with pro/con; Decision cites the enforce-in-harness-over-memory trade-off.
- Completion Criteria: TC-01/TC-02/TC-03 all TC-N-prefixed, command/observable form, none using banned vague phrases.
- Test Plan: section present; 3 rows (TC-01/02/03) — count matches Completion Criteria; each row has non-empty Test Type and Tool/Approach; the single `manual` row (TC-01) carries a Notes infeasibility justification.
- Structure: Tasks section present with placeholder; Evidence Log present and empty (first run); no `## Status` or `## Classification` body sections.
- TC-N count: Completion Criteria = 3, Test Plan = 3 (match).

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved

- Prior-gate precondition: GATE-WRITE PASS Evidence entry present (2026-06-14, draft → review-ready); frontmatter `status: review-ready`; file located in `backlog/` as expected.
- Explicit approval: user was shown INFRA-014 and INFRA-015 as drafts and replied verbatim "둘 다 게이트 파이프라인으로 진행해" — "진행해" is an explicit approval form per the gate criteria.
- Direct & unambiguous: "둘 다" (both) explicitly covers INFRA-015; the statement confirms the design and authorizes pipeline advancement, not a clarifying-question answer.
- No post-approval drift: frontmatter `type: INFRA` / `tags: [typescript]` and the Architecture Review Checklist (all `[x]`) unchanged after approval.
- NON-COMPLIANCE trigger clear: tasks file `.agents/tasks/INFRA-015.md` not yet created (marked "미생성 — GATE-APPROVAL 통과 후 생성"); no implementation work started before this gate ran.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-14

**Status upgrade:** approved → in-progress

- Prior-gate precondition: GATE-APPROVAL PASS Evidence entry present (2026-06-14, review-ready → approved); frontmatter `status: approved`; spec located in `spec-docs/todo/` (the approved-awaiting-implementation stage) as expected.
- Tasks file created: `.agents/tasks/INFRA-015.md`.
- Tasks file path recorded in spec `## Tasks` section: `.agents/tasks/INFRA-015.md` linked.
- Tasks correspond to Completion Criteria (≥1 per TC-N): TC-01 (with S1–S7 sub-tasks + index registration), TC-02 (conflict-scan + Rule Anchor check), TC-03 (`pnpm harness:scan` exit 0) — all three TC-N present.
- `## Test Plan` section present in tasks file with 1,641 chars (≥50 required) [AF-24]; one row per TC-01/02/03 (count matches Completion Criteria).
- No implementation/skill edits started before this gate ran (no INFRA-015 skill changes committed).

### [GATE-VERIFY] — ✅ PASS | 2026-06-14

**Status upgrade:** in-progress → verifying

- Prior-gate precondition: GATE-IMPLEMENT PASS Evidence entry present (2026-06-14, approved → in-progress); frontmatter `status: in-progress` as expected for GATE-VERIFY input.
- Tasks complete: all checkboxes in `.agents/tasks/INFRA-015.md` are `[x]` (TC-01 with all 7 S-subtasks + index-registration subtask, TC-02, TC-03); none blocked or pending. Spec `## Completion Criteria` TC-01/02/03 all `[x]`.
- TC-01 (each S1–S7 present + S6 registered): S1 `backlog-gate-guard` "Prior-Gate Precondition" section (line 61); S2 `pnpm-monorepo-build` "Adding a Workspace Dependency" surgical-lockfile + `--frozen-lockfile` guidance; S3 `backlog-writer` command-form/CI-smoke preference + `manual` Notes-infeasibility requirement; S4 `post-implementation-checklist` "Independently re-verify any delegated green claim"; S5 `git-branch.md` "Post-Merge Branch Cycle (mandatory)" (line 109, stash→checkout develop→pull→branch); S6 NEW `delegated-refactor-green-gate/SKILL.md` exists and registered in `index.md` (line 23); S7 `harness-governance` declare-scan-scope + capture-out-of-scope-as-backlog. (S2/S4 took the "update" branch of "update or new" — both valid per spec.)
- TC-02 (conflict-scan + Rule Anchor): `rg -n "any/unknown may|fallback to|temporary workaround" .agents/skills` → exit 0, only match is a documented rg-pattern example inside `harness-governance/SKILL.md` (not a violation); S6 new skill cites a Rule Anchor section.
- TC-03 (`pnpm harness:scan`): exit 0 — all 25 scans passed (consistency/document-authority/anchor/specs/conformance etc.), independently re-run.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-14

**Status upgrade:** verifying → done

- Prior-gate precondition: GATE-VERIFY PASS Evidence entry present (2026-06-14, in-progress → verifying); frontmatter `status: verifying`; spec located in `spec-docs/active/` as expected for GATE-COMPLETE input.
- User-Execution done-gate: N/A — this spec has no `## User Execution Test Scenarios` section; it is a doc/process change (7 skill/rule new+updates). Test Plan evidence is the applicable done-gate artifact.
- [GATE-COMPLETE: TC-01] Each of S1–S7 present in target file (independently re-checked): S1 `backlog-gate-guard` "Prior-Gate Precondition" section (1 hit); S2 `pnpm-monorepo-build` `frozen-lockfile` guidance (3 hits); S3 `backlog-writer` command-form/infeasibility guidance (4 hits); S4 `post-implementation-checklist` delegated-green re-verify guidance (5 hits); S5 `git-branch.md` Post-Merge Branch Cycle / `checkout develop` (4 hits); S6 NEW `.agents/skills/delegated-refactor-green-gate/SKILL.md` exists and registered in `index.md` line 23; S7 `harness-governance` scope/out-of-scope guidance (6 hits). S2/S4 took the valid "update" branch. Result: all S-items implemented + S6 registered.
- [GATE-COMPLETE: TC-02] `rg -n "any/unknown may|fallback to|temporary workaround" .agents/skills` → exit 0; sole match is the documented rg-pattern example in `harness-governance/SKILL.md:77` (not a violation). S6 new skill cites a Rule Anchor. No new/updated skill redefines a rule.
- [GATE-COMPLETE: TC-03] `pnpm harness:scan` → exit 0; "all 25 scans passed" (log tail: build-contracts/dist/docs-structure/conformance ✓). Independently re-run by this guard.
- Test Plan TC-N references (doc/process change — no automated test judges prose quality):
  - TC-01 (manual): skip reason — skill guidance is prose; coverage verified by inspecting each S1–S7 target file (per-file hit counts above). No automated test applicable.
  - TC-02 (CI smoke): test reference — `rg` conflict-scan over `.agents/skills` (command-form, re-run exit 0).
  - TC-03 (CI smoke): test reference — `pnpm harness:scan` (re-run exit 0, 25/25 scans).
- Artifacts: tasks file archived `.agents/tasks/INFRA-015.md` → `.agents/tasks/completed/INFRA-015.md`; spec `## Tasks` link updated to the archived path. Spec `## Completion Criteria` TC-01/02/03 all `[x]`; Test Plan rows all carry a test reference or skip reason.
