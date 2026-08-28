---
title: 'PROC-016: the pipeline has one lane, and every gate runs as an agent regardless of risk'
issue: https://github.com/woojubb/robota/issues/2398
status: done
completed: 2026-08-28
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

## The measurement after landing the lane (TC-13)

One L1 item — INFRA-136, issue #2406, a one-function fix in `scripts/harness/loop-run.mjs` — run
end to end through the new lane on this branch by a fresh subagent, three times. Each run stopped
where the tooling was wrong, the defect was fixed on this branch, and the run restarted from zero:

| Run | Stopped at                                        | Defect found (fixed in this branch)                                                                                                       |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ID allocation, 2 min                              | allocator hands out a live ID (issue #2390, not this item's); harness scripts fell to L0; L1 sent to the research step                    |
| 2   | affected scans after implementation, 6 min 17 s   | plan-order scan knew no L1 checkpoint; `new-spec --title` broke the pair's basename; approve UTC date, `--evidence`, judge-before-approve |
| 3   | `git push`, 11 min 39 s (lane complete at ~7 min) | pre-push demanded 81 packages' build output and the CLI smoke for a harness-only push; hook `GIT_DIR` made a finder vacuous               |
| 4   | **completed** — PR opened                         | none; INFRA-137 (issue #2415), PR #2417 — the criterion's own clock, see below                                                            |

**Run 4 — the criterion's own clock, after every fix and with the base on the remote.** INFRA-137
(issue #2415, the allocator's UTC `created:` stamp), a fresh subagent, session
`3e0c1f6e-bce9-4f8c-8a71-199fe78fc73c`: first command `2026-08-28T21:11:56+09:00`, PR #2417 opened
`2026-08-28T21:24:52+09:00` — **12 min 56 s prompt → PR, 2 reviewer rounds (1 dispatch + 1 resume),
4 commits** against ≤ 20 min / ≤ 2 / ≤ 3. Time and dispatches met; commits missed by one: the fourth
commit fixed the reviewer's single SHOULD (a JSDoc attached to the wrong function), because
`record-local-review` records only a zero-finding round at the head it reviewed. The planning phase
(allocate → Task → scaffold → approve → PLAN → advance → commit) took under 4 minutes; PLAN judged 28
criteria with 0 FAIL, DONE 13/13.

Run 3, the lane proper (allocate → scaffold → approve → PLAN → implement → record → DONE →
review recorded): **≈ 7 min wall clock, 1 subagent dispatch (the local reviewer), 3 commits** —
against the criterion's ≤ 20 min / ≤ 2 / ≤ 3. The push landed after the third fix, at 09:44:52
KST, from the orchestrator's checkout (same three commits, range-diff identical). The same item
through the L2 pipeline (HARNESS-127, the comparison this Task opens with) took 72 min, 15
dispatches and 7 commits.

## Plan

- [x] Amend `spec-workflow.md` § HARD GATE: three lanes with mechanically derived lower bounds, and a
      user-declared fast track that replaces the unrecorded "skip the spec" waiver.
- [x] `scan-lane-declaration.mjs`: refuse a lane whose lower bound the diff violates; upward is always
      accepted; fast track refused on the excluded classes.
- [x] Amend `gate-catalogue.md`: per-lane gate table (L0 none, L1 PLAN + DONE, L2 unchanged) and
      tag every criterion under the five spec-document gates `mechanical` or `semantic` (TC-03);
      status vocabulary untouched.
- [x] `gate.mjs` — `judge`, `advance`, `approve`: the mechanical criteria composed from the scans that
      already exist, the Evidence Log entry written in the catalogue's form, the folder/frontmatter/Task
      transition performed; the guardian dispatched only on a non-PASS or an L2 semantic criterion.
- [x] Route the three callers — `backlog-pipeline`, `user-request-gate`,
      `backlog-execution-orchestrator` — through `gate.mjs`, dispatching `backlog-gate-guard` only on a
      non-PASS or an L2 semantic set (TC-05).
- [x] `new-spec.mjs` + `mini-spec-template.md`: an L1 draft that passes GATE-WRITE's form criteria as
      generated.
- [x] `run-all-scans.mjs --affected`, wired into `pre-push.mjs`, `gate.mjs`, and the CI `scans` job on
      pull requests; the full suite moves to the post-merge run on `develop` and nightly.
- [x] Mark the prose- and transcript-grading scans (`scan-progress-report-quantification`,
      `scan-reference-kind-qualified`) advisory on pull requests and blocking on the `develop` full run
      (TC-09).
- [x] `merge-gate.sh`: a verdict stays valid across a base move when the moved range and the branch
      touch no common file and the merge is clean (delivers issue #2386).
- [x] Register the Route CLASS row for L0/L1 items — the row text is the owner's, recorded verbatim at
      GATE-APPROVAL; never authored by the agent.
- [x] Red-proof every refusal path; the control (an accepted case) beside each.
- [x] Re-measure one L1 item end to end after landing and record the numbers next to the table above.

## Test Plan

Fixture tests under `scripts/harness/__tests__/` for `scan-lane-declaration`, `gate`, `new-spec`,
`run-all-scans --affected`, and `merge-gate` (fixtures B and C from RULE-015: base moved, file overlap
0, must pass without a rebase; a real overlap must still refuse). `rg` assertions pin the amended rule
text. `pnpm harness:scan` and the harness suites exit 0. The exact criteria are TC-01..TC-13 in the
paired spec.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable. The independent scenario author's verdict, with the reason recorded rather than
asserted: every affected path is a rule (`spec-workflow.md`, `backlog-execution.md`), a spec
(`gate-catalogue.md`), a skill, a template, a harness script under `scripts/harness/`, the git hook
`.claude/hooks/merge-gate.sh`, or the CI workflow `.github/workflows/ci.yml`. Nothing under
`packages/` or `apps/` changes, so no `robota` CLI command, TUI action, browser flow, or public SDK
export behaves differently before and after. The nearest executable surfaces — `pnpm harness:scan`,
`node scripts/harness/gate.mjs`, `new-spec.mjs`, `pre-push.mjs`, and the merge-gate hook — are
developer gates; `.agents/tasks/README.md` and the User Execution Test Scenario Rule place harness
commands and hooks in `## Test Plan`, and a scenario written against them would be an engineering
check wearing a user-execution label. This is not a capability behind an internal seam: its entire
effect is on the project's own pipeline machinery, and there is no user-facing behaviour left
unreachable. Verification evidence is the engineering Test Plan above (TC-01..TC-13 in the paired
spec).
