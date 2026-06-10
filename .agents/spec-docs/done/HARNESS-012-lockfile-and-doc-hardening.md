---
status: done
type: INFRA
tags: [harness, ci, docs]
---

# HARNESS-012: Lockfile pre-push gate + lesson-driven rule/skill hardening (covers backlog HARNESS-012/005/013/014)

## Problem

Four low-cost gaps from the 2026-06-10/11 session remain open:

1. **Lockfile drift reaches CI (HARNESS-012).** Removing peer deps from
   agent-tool-mcp/package.json without `pnpm install` broke CI one full round-trip later
   (`ERR_PNPM_OUTDATED_LOCKFILE`, PR #688). The pre-push hook checks worktrees and clean tree
   but not lockfile consistency; the check costs ~0.4s
   (`pnpm install --frozen-lockfile --lockfile-only`, verified locally).
2. **Conformance loop is one-directional (HARNESS-005).** agent-transport SPEC documented
   `allowedTools`/`deniedTools` on render options while the code lacked both — SPEC-ahead drift
   that the `spec-code-conformance` skill's loop (code→SPEC oriented) never caught.
3. **Test-environment gotcha undocumented (HARNESS-013).** `vi.stubEnv('HOME', …)` does not
   reach `os.homedir()` in vitest workers; module-level path constants freeze paths at import
   time — both silently broke first-run tests until redesigned to injectable defaults.
4. **Scenario design rule missing (HARNESS-014).** User execution test scenarios requiring live
   LLM credentials (CLI-053) were unexecutable in-environment, while CLI-058's self-built mock
   server made its scenario fully machine-runnable — the preference is undocumented.

## Architecture Review

### Affected Scope

- `scripts/harness/pre-push.mjs` — `assertLockfileConsistency()` step
- `scripts/harness/__tests__/` — unit test for the decision helper (extracted pure check)
- `.agents/skills/spec-code-conformance/SKILL.md` — bidirectional verification section
- `.agents/skills/vitest-testing-strategy/SKILL.md` — env-stub/homedir gotcha + injectable paths
- `.agents/rules/backlog-execution.md` — scenario design preference order

### Alternatives Considered

**A. Lockfile check as a harness scan (in run-all-scans.mjs) instead of pre-push**

- Pro: visible in the aggregated summary
- Con: scans run far less often than pushes; the incident class is "pushed without lockfile" —
  the push boundary is the right gate; CI already covers the scan-time equivalent

**B. Lockfile check inside pre-push.mjs via `pnpm install --frozen-lockfile --lockfile-only` (chosen)**

- Pro: exact same validation CI performs, 0.4s measured, fails before the wasted CI round-trip;
  hook already exists with the same run/assert conventions
- Con: adds a pnpm invocation to every push — negligible at 0.4s

**C. Fold the three doc updates into their own separate PRs**

- Pro: smaller diffs
- Con: three PR round-trips for prose-only changes with zero interaction risk; they share the
  same lesson source and reviewer context

### Decision

**B + single PR for the doc trio** — the lockfile gate goes where the incident happened (push
boundary) using the verified cheap command; failures print the regenerate-and-commit guidance.
Doc updates ride along: conformance skill gains an explicit "SPEC→code direction" checklist item
with the CLI-053 case; vitest skill gains the worker-env/homedir gotcha with the injectable
default-parameter pattern (first-run.ts); backlog-execution gains the scenario-design preference
order (provider-free observable → work-built fixture → live-credential with explicit
prerequisite) citing CLI-053 vs CLI-058.

### Architecture Review Checklist

- [x] Affected packages/layers listed — harness script + three docs; no runtime packages
- [x] Sibling scan complete — pre-push.mjs assert-step conventions (assertNoActiveWorktrees /
      assertCleanWorkingTree) reused; skill/rule sections follow each document's existing
      structure (checked headers before writing)
- [x] At least 2 alternatives reviewed — A/B for the gate, C for PR shaping
- [x] Decision rationale documented — see Decision

## Solution

1. `pre-push.mjs`: `assertLockfileConsistency()` — spawn
   `pnpm install --frozen-lockfile --lockfile-only`; on non-zero exit, print the CI error class,
   the fix (`pnpm install` + commit pnpm-lock.yaml), and block. Pure decision helper
   (`isLockfileConsistent(exitCode)` equivalent inline) kept trivially testable via the spawn
   wrapper; unit test covers message content via a stub.
2. spec-code-conformance skill: add "Direction 2 — SPEC→code" subsection (enumerate
   SPEC-declared fields/exports/events, confirm each exists; record both directions in
   evidence) with the CLI-053 worked example.
3. vitest-testing-strategy skill: add "Worker-thread environment gotchas" (env stubs don't reach
   native APIs; never freeze user/project paths in module-level constants; injectable default
   parameters, first-run.ts example).
4. backlog-execution rule: scenario design preference order with the credential-prerequisite
   requirement for live runs.

## Affected Files

- `scripts/harness/pre-push.mjs`
- `scripts/harness/__tests__/pre-push-lockfile.test.mjs` (new)
- `.agents/skills/spec-code-conformance/SKILL.md`
- `.agents/skills/vitest-testing-strategy/SKILL.md`
- `.agents/rules/backlog-execution.md`

## Completion Criteria

- [x] TC-01: with a deliberately desynced package.json (temp fixture or dependency edit in a
      scratch copy), the lockfile check command exits non-zero and the hook's message names
      `pnpm install` + lockfile commit; with the repo in sync it passes in <2s
- [x] TC-02: spec-code-conformance SKILL contains the SPEC→code direction subsection
      referencing the CLI-053 incident
- [x] TC-03: vitest-testing-strategy SKILL contains the worker env-stub/homedir gotcha and the
      injectable-default-parameter pattern
- [x] TC-04: backlog-execution.md contains the scenario preference order
      (provider-free → built fixture → live credential with stated prerequisite)
- [x] TC-05: `pnpm harness:scan:consistency` and `harness:scan:test-plans` stay green
      (rule/skill edits do not violate doc scans); pre-push unit test passes

## Test Plan

| TC-ID | Test Type | Tool / Approach                                          | Notes                                            |
| ----- | --------- | -------------------------------------------------------- | ------------------------------------------------ |
| TC-01 | live+unit | timed run on sync repo; desync simulation in tmp fixture | hook spawn wrapper stubbed for message assertion |
| TC-02 | static    | grep skill for the new subsection                        |                                                  |
| TC-03 | static    | grep skill for gotcha section                            |                                                  |
| TC-04 | static    | grep rule for preference order                           |                                                  |
| TC-05 | live      | consistency + test-plans scans                           |                                                  |

## Tasks

- `.agents/tasks/completed/HARNESS-012.md` — created 2026-06-11; T1–T5 mapped to TC-01–TC-05; archived 2026-06-11

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-11

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: INFRA` (valid 11-prefix value); `tags: [harness, ci, docs]` present
- Problem: concrete symptoms with reproduction conditions for all 4 sub-items (ERR_PNPM_OUTDATED_LOCKFILE on PR #688 after peer-dep removal without `pnpm install`; agent-transport SPEC-ahead drift on `allowedTools`/`deniedTools`; `vi.stubEnv('HOME')` not reaching `os.homedir()` in vitest workers; CLI-053 vs CLI-058 scenario executability); no "TBD"/"TODO"/vague single-sentence descriptions
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (pre-push.mjs assert-step conventions reused, target doc headers checked); Alternatives Considered has 3 entries (A/B/C) each with pro and con; Decision references the driving trade-off (push boundary matches incident class, 0.4s measured cost; single PR avoids three round-trips for shared-lesson prose changes)
- Completion Criteria: 5 items, all `TC-N` prefixed (TC-01–TC-05); at least 1 criterion per sub-item (TC-01→HARNESS-012, TC-02→005, TC-03→013, TC-04→014, TC-05→scan regression); all use command or observable-behavior form; no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly")
- Test Plan: section present; 5 rows matching 5 TC-N (count matches); every row has non-empty Test Type and Tool/Approach with no "TBD"; no row uses Tool "manual", so the manual-Notes requirement is N/A
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` present and empty before this first run; no `## Status` or `## Classification` sections in body (verified by grep, no matches)

### [GATE-APPROVAL] — ✅ PASS | 2026-06-11

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation (2026-06-11): the orchestrating agent presented the harness-lesson items split into an immediate-proceed group explicitly including HARNESS-012 (lockfile) and HARNESS-005/013/014 (docs/rules/skills hardening — "전부 저비용… 각자 실증 사건이 1건 이상") and a wait group; the user replied verbatim: "즉시 진행군은 백로그들을 만든 후 작업해줘"
- Direct, unambiguous, directed at this spec: this document covers exactly HARNESS-012/005/013/014 — the full immediate-proceed group the approval addressed; the statement authorizes creating the backlog and proceeding with the work, not merely answering a clarifying question
- No Architecture Review or frontmatter type/tags modifications after approval
- NON-COMPLIANCE check: no implementation work (file edits, code commits) started for this scope before this gate ran

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-11

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/HARNESS-012.md` exists (untracked, created 2026-06-11) and references this spec document
- Tasks file path recorded in `## Tasks` section of this spec (updated this gate run, replacing the "pending" placeholder)
- Task↔criteria correspondence: 5 tasks ↔ 5 TC-Ns, one task per criterion — T1→TC-01 (pre-push assertLockfileConsistency + unit test + live timing/desync proof), T2→TC-02 (spec-code-conformance SPEC→code subsection), T3→TC-03 (vitest-testing-strategy worker env gotcha), T4→TC-04 (backlog-execution scenario preference order), T5→TC-05 (consistency + test-plans scans + pre-push unit test)
- NON-COMPLIANCE check: no implementation commits exist for this scope (`git log` over spec/tasks paths is empty; `git status` shows only the untracked spec + tasks files; `scripts/harness/`, both target skills, and `.agents/rules/backlog-execution.md` are unmodified) — tasks file precedes all implementation
- Note: frontmatter already reads `status: in-progress` in the same uncommitted change set; this gate authorizes that transition

### [GATE-COMPLETE: TC-01] — ✅ | 2026-06-11

**Live proofs:** sync repo — `pnpm install --frozen-lockfile --lockfile-only` exit 0 in 0.47s (<2s). Desync simulation — temp copy of package.json/pnpm-lock.yaml with an added dependency → command fails with `ERR_PNPM_OUTDATED_LOCKFILE`. **Unit test:** `pre-push-lockfile.test.mjs` asserts the blocked message names the error class, `pnpm install`, and the lockfile commit (helper moved to pure `pre-push-updates.mjs` per existing convention — pre-push.mjs executes asserts at import). Gate wired after `assertCleanWorkingTree()` in pre-push.mjs.

### [GATE-COMPLETE: TC-02] — ✅ | 2026-06-11

**Evidence:** spec-code-conformance SKILL gained "Bidirectional Verification (mandatory)" with Direction 2 — SPEC→code enumeration and the CLI-053 allowedTools/deniedTools incident (grep count 2 for "SPEC→code").

### [GATE-COMPLETE: TC-03] — ✅ | 2026-06-11

**Evidence:** vitest-testing-strategy SKILL gained "Worker-Thread Environment Gotchas" — env stubs vs os.homedir(), no module-level path constants, injectable default parameter pattern with the first-run.ts incident.

### [GATE-COMPLETE: TC-04] — ✅ | 2026-06-11

**Evidence:** backlog-execution.md gained "Scenario Design Preference Order (mandatory for new scenarios)" — provider-free observables → work-built fixtures (CLI-058 example) → live-credential with explicit prerequisite (CLI-053 counter-example).

### [GATE-COMPLETE: TC-05] — ✅ | 2026-06-11

**Commands:** `harness:scan:consistency` passed; `harness:scan:test-plans` passed; harness-scripts tests 77/77; pre-push-lockfile test 1/1.

### [GATE-VERIFY] — ✅ PASS | 2026-06-11

**Status upgrade:** in-progress → verifying

- Tasks file: `.agents/tasks/completed/HARNESS-012.md` — all 5 tasks (T1–T5) marked `[x]`; no blocked or pending tasks
- Test: `npx vitest run scripts/harness/__tests__/pre-push-lockfile.test.mjs` → 1 passed (1), exit 0
- Scan: `pnpm harness:scan:consistency` → "harness consistency scan passed.", exit 0
- Build: no runtime packages affected (harness script + three docs only) — `pnpm build` N/A for this scope; the affected-script test suite above is the build-equivalent check

### [GATE-COMPLETE] — ✅ PASS | 2026-06-11

**Status upgrade:** verifying → done

- Completion Criteria: all 5 TC checkboxes `[x]`; one `[GATE-COMPLETE: TC-N]` Evidence entry exists per TC (TC-01–TC-05) with commands, observed results, and exit/pass states
- Code wiring verified: `scripts/harness/pre-push.mjs` defines `assertLockfileConsistency()` (line 54) and executes it (line 124)
- TC-02 doc verified: `grep -c "Bidirectional Verification" .agents/skills/spec-code-conformance/SKILL.md` → 1
- TC-03 doc verified: `grep -c "Worker-Thread Environment Gotchas" .agents/skills/vitest-testing-strategy/SKILL.md` → 1
- TC-04 doc verified: `grep -c "Scenario Design Preference Order" .agents/rules/backlog-execution.md` → 1
- TC-05 re-verified this run: pre-push-lockfile test 1/1 pass; `harness:scan:consistency` pass (exit 0)
- Test Plan coverage: TC-01 → test reference `scripts/harness/__tests__/pre-push-lockfile.test.mjs` + live sync/desync proofs; TC-02/03/04 → static grep verification (no automated test needed for prose sections — greps recorded above); TC-05 → live scan runs recorded; no TC-N row silently unaddressed
- Tasks archived: `.agents/tasks/completed/HARNESS-012.md` exists (all T1–T5 `[x]`); original `.agents/tasks/HARNESS-012.md` removed; `## Tasks` section updated to the archived path this gate run

### [DEFECT-FIX] — ✅ | 2026-06-11

**Defect found post-merge (PR #694):** pnpm 8's `--lockfile-only` rewrites pnpm-lock.yaml
(~23k-line format churn) even with `--frozen-lockfile` when the check PASSES — the gate dirtied
the working tree on every push, which would itself trip the clean-tree assert on the next push.
**Fix:** validation now runs in a throwaway temp copy of the manifests
(package.json/pnpm-workspace.yaml/pnpm-lock.yaml/.npmrc + every workspace package.json) —
zero working-tree side effects. **Re-verified:** sync check exit 0 in 401ms with
`git status pnpm-lock.yaml` empty afterwards; staged desync (dependency added to a workspace
manifest copy) exits 1. Fix PR: fix/harness-lockfile-gate-side-effect.
