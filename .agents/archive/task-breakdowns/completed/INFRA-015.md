# INFRA-015 Tasks

Spec: `.agents/spec-docs/todo/INFRA-015-harness-lessons-skill-updates.md`

## Tasks

- [x] TC-01: Implement each of S1–S7 as the stated skill new/update so the corresponding SKILL.md / rule file carries the new guidance, and register every NEW skill in `.agents/skills/index.md`.
  - [x] S1 — UPDATE `.agents/skills/backlog-gate-guard/SKILL.md`: add a per-gate "prior-gate precondition" check (verify prior gate's PASS Evidence + expected folder/status; return NON-COMPLIANCE on out-of-order run).
  - [x] S2 — UPDATE `.agents/skills/pnpm-monorepo-build/SKILL.md` (or NEW `.agents/skills/workspace-dependency-change/SKILL.md`): surgical `pnpm-lock.yaml` workspace-dep edit + `pnpm install --frozen-lockfile` verification; never commit a regenerated lockfile in a network-restricted env.
  - [x] S3 — UPDATE `.agents/skills/backlog-writer/SKILL.md`: steer doc/process backlogs toward command-form / CI-smoke Test Plan rows; `manual` rows REQUIRE a Notes infeasibility justification.
  - [x] S4 — UPDATE `.agents/skills/post-implementation-checklist/SKILL.md` (or NEW `verify-delegated-work`): orchestrator independently re-runs key gates (typecheck, relevant scan, frozen-lockfile) before trusting a subagent's "green" claim.
  - [x] S5 — UPDATE `.agents/rules/git-branch.md` (or NEW skill): codify the stash transient churn → `git checkout develop` → `git pull` → branch cycle; verify new branch base is freshly-pulled develop.
  - [x] S6 — NEW skill `.agents/skills/delegated-refactor-green-gate/SKILL.md`: pattern for handing a large mechanical change to a subagent with a hard completion gate (build/typecheck/test/dep-direction green or report blockers; no broken commit; leave changes unstaged).
  - [x] S7 — UPDATE `.agents/skills/harness-governance/SKILL.md` and/or `architecture-conformance-audit`: declare a mechanical guard's scope explicitly and capture out-of-scope findings as a backlog.
  - [x] Register any NEW skill (S6, and S2/S4 if new) in `.agents/skills/index.md`.
- [x] TC-02: Run the AGENTS.md conflict-scan `rg -n "any/unknown may|fallback to|temporary workaround" .agents/skills` and confirm no new violations; confirm no new/updated skill redefines a rule (each cites a Rule Anchor).
- [x] TC-03: Run `pnpm harness:scan` and confirm exit 0 (consistency/anchor checks pass for the edited skills).

## Test Plan

This is a doc/process-only change to `.agents/skills/**` and `.agents/rules/git-branch.md` — no `packages/*` production code. TC-01 is verified by inspecting each S1–S7 target file for the added guidance plus confirming index registration for any new skill (manual: skill guidance is prose and coverage is the assertion; no automated test judges guidance quality). TC-02 and TC-03 are command-form CI-smoke checks: run the `rg` conflict-scan over `.agents/skills` and confirm no new violations + each new skill cites a Rule Anchor, then run `pnpm harness:scan` and confirm exit code 0.

| TC-ID | Test Type              | Tool / Approach                                                                      | Notes                                                                                  |
| ----- | ---------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| TC-01 | manual                 | Inspect each S1–S7 target file for the added guidance + index registration           | Coverage is the assertion; skills are prose, no automated test judges guidance quality |
| TC-02 | CI pipeline smoke test | `rg` conflict-scan over `.agents/skills`; confirm each new skill cites a Rule Anchor | Command-form                                                                           |
| TC-03 | CI pipeline smoke test | `pnpm harness:scan` exit 0 (consistency + anchor scans)                              | doc-only change                                                                        |

## Result

Completed 2026-06-14. All of S1–S7 implemented as the stated skill new/update (S2/S4 took the "update" branch); S6 NEW skill registered in `.agents/skills/index.md`. TC-02 conflict-scan clean (only the documented rg-pattern example in `harness-governance`). TC-03 `pnpm harness:scan` exit 0 (all 25 scans passed). Archived via GATE-COMPLETE.
