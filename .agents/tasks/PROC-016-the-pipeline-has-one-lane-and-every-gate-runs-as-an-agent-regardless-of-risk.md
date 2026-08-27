---
title: 'PROC-016: the pipeline has one lane, and every gate runs as an agent regardless of risk'
issue: https://github.com/woojubb/robota/issues/2398
status: todo
created: 2026-08-27
priority: high
urgency: now
area: .agents/rules, .agents/specs, .agents/skills, .agents/templates, scripts/harness, .claude/hooks, .github/workflows
depends_on: []
---

# PROC-016: the pipeline has one lane, and every gate runs as an agent regardless of risk

## Objective

Make the cost of a change proportional to its risk, without removing any check: a risk lane decides
how many gates apply; the mechanical half of every gate runs as a script and the guardian agent is
dispatched only when the script cannot pass it; scan selection follows the changed paths; and a merge
gate that measured "the base moved" starts measuring "the base moved **on a file this branch touches**".

Source: https://github.com/woojubb/robota/issues/2398

## The measurement this rests on

One item, end to end, on session `92807a20` (2026-08-27 22:47–23:58 KST): issue #2378 → HARNESS-127 →
PR #2396. The change is one regex token and one test `describe`.

| Measurement                                | Value                                              |
| ------------------------------------------ | -------------------------------------------------- |
| wall clock, prompt → PR opened             | 72 min                                             |
| implementation (red-proof → fix → mutants) | 4 min (5.6%)                                       |
| gates, reviews, ledgers, checkpoints       | ~50 min (69%)                                      |
| subagent dispatches                        | 15 — 59.4 agent-minutes, 303 tool calls            |
| gate-guard dispatches                      | 7, all PASS, 0 defects found                       |
| proposal-reviewer rounds                   | 3, all about document wording                      |
| local review rounds                        | 2; the CI reviewer reached the same verdict in 1 m |
| commits on the PR                          | 7 — 2 code, 5 ceremony                             |
| issues opened while closing one            | 2                                                  |
| full `harness:scan` runs (147 scans)       | 2, both failures unrelated to the change           |

Across the tree: 283 `done/` specs average 249 lines; 14% carry a GATE-WRITE FAIL, mostly form. 71%
of the last 31 `develop` merges are `fix`/`docs`/`chore`. Of 21 rebases in the five-day session
`1dab1a14`, 2 hit a conflict and 19 were forced by `merge-gate.sh:352` (reviewed base OID must equal
current base OID; the GitHub ruleset itself is non-strict). Files shared by ≥4 of the last 44 PRs are
four registry/baseline files. Issue #2348 already records that two-thirds of recent completions carry
no spec document — the "no exceptions" rule is paid by not following it.

## Plan

- [ ] Amend `spec-workflow.md` § HARD GATE: three lanes with mechanically derived lower bounds, and a
      user-declared fast track that replaces the unrecorded "skip the spec" waiver.
- [ ] `scan-lane-declaration.mjs`: refuse a lane whose lower bound the diff violates; upward is always
      accepted; fast track refused on the excluded classes.
- [ ] Amend `gate-catalogue.md` and `backlog-pipeline`: per-lane gate table (L0 none, L1 PLAN + DONE,
      L2 unchanged); status vocabulary untouched.
- [ ] `gate.mjs` — `judge`, `advance`, `approve`: the mechanical criteria composed from the scans that
      already exist, the Evidence Log entry written in the catalogue's form, the folder/frontmatter/Task
      transition performed; the guardian dispatched only on a non-PASS or an L2 semantic criterion.
- [ ] `new-spec.mjs` + `mini-spec-template.md`: an L1 draft that passes GATE-WRITE's form criteria as
      generated.
- [ ] `run-all-scans.mjs --affected`, wired into `pre-push.mjs`, `gate.mjs`, and the CI `scans` job on
      pull requests; the full suite moves to the post-merge run on `develop` and nightly.
- [ ] `merge-gate.sh`: a verdict stays valid across a base move when the moved range and the branch
      touch no common file and the merge is clean (delivers issue #2386).
- [ ] Register the Route CLASS row for L0/L1 items — the row text is the owner's, recorded verbatim at
      GATE-APPROVAL; never authored by the agent.
- [ ] Red-proof every refusal path; the control (an accepted case) beside each.
- [ ] Re-measure one L1 item end to end after landing and record the numbers next to the table above.

## Test Plan

Fixture tests under `scripts/harness/__tests__/` for `scan-lane-declaration`, `gate`, `new-spec`,
`run-all-scans --affected`, and `merge-gate` (fixtures B and C from RULE-015: base moved, file overlap
0, must pass without a rebase; a real overlap must still refuse). `rg` assertions pin the amended rule
text. `pnpm harness:scan` and the harness suites exit 0. The exact criteria are TC-01..TC-11 in the
paired spec.

## User Execution Test Scenarios

Not applicable — rules, gate scripts, hooks, and CI selection; no runnable user-facing product
behaviour changes. Document and script checks belong to the Test Plan above, per
`.agents/tasks/README.md`.
