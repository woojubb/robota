---
title: 'INFRA-097: trusted provenance for required PR workflows'
issue: https://github.com/woojubb/robota/issues/1719
status: blocked
created: 2026-08-14
priority: high
urgency: soon
area: .github/workflows, repository rulesets, scripts/harness
depends_on: []
---

# INFRA-097: trusted provenance for required PR workflows

## Objective

Required checks triggered by `pull_request` load their workflow YAML from the PR merge revision.
Consequently a PR can modify the workflow control plane that reports its own required context; checking
governance scripts out from the base SHA is defense in depth but does not establish trusted workflow
provenance. Design a repository-level required-workflow boundary whose control plane is trusted while
never executing untrusted PR content with write credentials.

## Plan

- [x] Verify GitHub event/check attribution and ruleset capabilities for trusted required workflows.
- [x] Compare required-workflow/ruleset, split `pull_request_target`, and external GitHub App/check-run designs.
- [x] Specify exact SHA/ref identity, permissions, fork behavior, and branch-protection reconciliation.
- [x] Add adversarial tests proving a PR cannot replace its own required gate with an unconditional pass.
- [ ] Roll out and validate code, docs-only, fork, retarget, cancellation, and genuine-finding paths. — allow-unmet-criterion: the context exists and runs, but making it REQUIRED is a live-ruleset edit and therefore the owner's; these paths cannot be validated as a gate until it is one

## The comparison, and what MEASURING the account settled

Two of the three candidate designs were ruled out by facts about this repository rather than by
preference.

**Organization-level required workflows — unavailable.** `gh api repos/woojubb/robota` reports
`owner.type: User`. Required workflows are an organization feature on GitHub Enterprise Cloud, and a
personal account has no organization to define one in. Not "harder"; absent.

**An external GitHub App publishing the check — available but disproportionate.** The ruleset API
does support pinning a required check to one publisher: each entry in `required_status_checks`
carries an `integration_id`. Measured on the live `protect-develop` ruleset, all nine read
`integration_id: none` — any app may publish any of those contexts today. Pinning them to an
external app would give trusted provenance, and it costs a hosted service, a key to rotate, and a
second failure point for a repository whose gates are otherwise self-hosted.

**A split `pull_request_target` plane — available, in-repo, and what landed.**
`pull_request_target` loads its definition from the BASE branch, so a pull request cannot change
what it says about itself; the edit takes effect only after merge, which is after the gate it would
have moved has run.

### Why the existing required checks cannot simply move onto that plane

`pull_request_target` runs with write credentials against the base. `build`, `quality`, `scans`,
`tui-e2e` and the rest exist to COMPILE AND EXECUTE the pull request's code — doing that under those
credentials is the classic pwn-request, a strictly worse hole than the one being closed. Measured:
no workflow in this repository used `pull_request_target` before this change, so nothing was already
carrying that risk.

So the plane is split rather than moved. `.github/workflows/workflow-provenance-gate.yml` answers
the one question that can be answered without running anything: does this pull request modify a file
that a required check loads? It checks out the base and only the base, FETCHES the head without
checking it out (reading a file name is not running the file), installs nothing — the scan it runs
imports Node builtins and two files from the base — and holds `contents: read`.

That turns a self-edit from VISIBLE into UNMERGEABLE, which is the difference between this and
`workflow-provenance`.

### The adversarial tests are about the gate, not its subject

`scripts/harness/__tests__/workflow-provenance-gate.test.mjs`. The boundary here is a workflow file
and a single added line breaches it, so each property is asserted against the file and each was
proven by planting the breach: checking out the head ref, switching the trigger to `pull_request`,
adding an install step, and widening the permissions each turned exactly the intended case red.

### What remains, and it is one action

Making `workflow provenance` a required context is a live-ruleset edit — the owner's. It is
deliberately NOT registered in `.github/required-status-checks.json` yet: that registry is compared
against the live ruleset by `ruleset-drift`, so registering it before the flip would make the
registry state something untrue. The same held-membership shape `regression-red-proof` uses.

## Progress

### 2026-08-22 — the requireable half, owner-assigned

The owner assigned the fifth step, which the item had held as theirs. Making the context REQUIRED has
prerequisites the item did not name, and they were found by trying:

**The gate was inert for two hours and nothing said so.** `workflow-provenance-gate.yml` reached
`develop` at 01:11 UTC and GitHub registered the workflow at **03:21:51 UTC — two seconds after the
promotion that carried it to `main` merged**. A `pull_request_target` workflow is not registered until
it lands on the DEFAULT branch, so pull requests #2010, #2011, #2012 and #2013 got no run at all,
while pull request #2015 (opened at 03:28) got one four seconds after it opened. Measured through
`gh api .../actions/workflows/workflow-provenance-gate.yml/runs`: `total_count` was 2, both after
registration. Requiring the context before that moment would have blocked every open pull request
permanently — the issue #1436 shape.

**R7 was unsatisfied and would have shipped the retarget hole.** The trigger declared
`types: [opened, synchronize, reopened]`. `edited` is the only activity a base retarget fires and
GitHub's default set omits it, so a branch moved `develop`->`main` would have kept the conclusion it
earned against the OLD base while branch protection reported the context satisfied — PR #1442's
measured shape, on the other plane. Added.

**R2 refused the fix as if it were the defect.** `scan-main-required-checks` read only
`^  pull_request:`, so the one workflow whose plane is the entire point reported "declares no
`pull_request:` trigger this scan can read". The rule is about whether a required context can FAIL,
which is plane-independent; it now accepts either plane and names which one it found in every message.

**The self-guarding case was inverted, not excepted.** A test asserted the gate must NOT be in the
guarded set, reasoning that a change editing it "would be judged by the edited version". That is true
of a `pull_request` workflow and false of this one — `pull_request_target` loads the definition from
the base, which is why the plane was split. Once the gate provides a required context it SHOULD guard
itself, and the test now asserts that plus the two properties that make it safe.

Landed here: the `edited` type, the two-plane R2, the `workflow provenance` registration under BOTH
branches in `.github/required-status-checks.json`, and a `guarded-workflow` relevance key so
`verify-like-ci` does not mark the context irrelevant on exactly the diffs it judges (a workflow edit
is not `code` to the `changes` classifier).

**Not yet done, and it is the last action:** flipping the live rulesets. It is deliberately last —
the declaration is now what `ruleset-drift` reconciles against, and the window between the two states
is why this is a sequence rather than one edit.

**Adjacent, measured, and NOT fixed here:** `protect-main` requires three contexts live while the
declaration names four — `promotion closes` was never added. That is issue #1980 and it is a separate
item; recorded because the live read for this step surfaced it again.

### 2026-08-17 — detection landed; trusted provenance remains an owner decision

`scripts/harness/scan-workflow-provenance.mjs` is registered in `pnpm harness:scan`.

**What it establishes.** The guarded set is derived from `.github/required-status-checks.json`, the
SSOT two other scans already read — today that resolves to `ci.yml` and `review-gate.yml`, the only
two files providing a required context. Both are `on: pull_request`, so both load their definition
from the pull request under test, and the scan reports that standing exposure on every run rather
than only when someone touches a file. Given `--base-ref`, it fails a change that edits a guarded
workflow and names which contexts that change can move.

The adversarial case the Test Plan asks for is covered: a fixture pull request that rewrites its own
required `build` job to `run: exit 0` is flagged, while an unguarded workflow, and ordinary work that
leaves the control plane alone, draw no comment. Fail-closed on an absent or workflow-less registry.

**What it deliberately does NOT establish, stated so the item is not read as finished.** It does not
make the control plane trusted. A reviewer can still approve a self-edit and a maintainer can still
merge one — the edit is merely no longer invisible. Trusted provenance needs a control plane the
pull request cannot reach:

| Option                                   | Why it is not takeable here                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Organization-level required workflow     | Needs org configuration outside this repository                                                                             |
| `pull_request_target` split              | Needs a design that never runs PR content with write credentials; changing `ci.yml`'s trigger is a repository-policy change |
| External GitHub App publishing the check | Needs an app registration and its credentials                                                                               |

Each is an owner decision. Note the shape of the constraint: **wiring the scan's `--base-ref` mode
into `ci.yml` would itself be an edit to a guarded workflow**, which this very scan would flag — so
that step is left to the owner rather than taken quietly.

### 2026-08-14

### 2026-08-14

- Discovered during INFRA-096 Round A: exact-base checkout protects loaded scripts but not the
  `pull_request` workflow YAML itself.
- INFRA-096 records labelled containment because this is pre-existing repository-wide control-plane
  debt; it does not claim to solve workflow provenance.

## Blockers

None. Owner decisions may be required if the chosen design needs live ruleset, GitHub App, or
organization-level required-workflow configuration.

## Test Plan

- Parsed workflow/ruleset fixtures for untrusted self-edit, fork permissions, exact check attribution,
  cancellation, and missing/malformed configuration.
- Live throwaway PR proof that editing the candidate workflow cannot forge the protected context.
- Existing required-check, permission, action-reference, and full harness regressions.

## User Execution Test Scenarios

Not applicable — this is repository-internal CI governance and branch-protection infrastructure, not a
shipped CLI, TUI, browser, application, or public SDK behavior.

## Progress

### 2026-08-21 — BLOCKED, and the blocking set is closed rather than open-ended

Re-verified on 2026-08-21. `scan-workflow-provenance` runs in `pnpm harness:scan` and reports the
standing exposure on every run:

```
2 of 2 guarded workflow(s) load their definition from the pull request (`on: pull_request`):
.github/workflows/ci.yml, .github/workflows/review-gate.yml
```

That is the detection half, and it is complete. The trusted-provenance half needs a control plane the
pull request cannot reach, and the table in the entry above enumerates all three ways to get one:
an organization-level required workflow, a `pull_request_target` split, or an external GitHub App.
**Every one requires configuration outside this repository** — org settings, a repository-policy
change to `ci.yml`'s trigger, or an app registration with credentials.

There is no fourth option that an agent can take. A guard that verified the running workflow against
the base ref would itself live in `ci.yml`, where the same pull request could edit it — the
circularity this item exists to name.

The one step short of that — wiring the scan's `--base-ref` mode into `ci.yml` so an edit to a
guarded workflow fails the PR — is still not taken, and for the reason the entry above already gives:
**that wiring is itself an edit to a guarded workflow**, which this very scan flags. Taking it
quietly would be the thing the item is about.

Recorded as `blocked` rather than `todo` so it is not read as unstarted work.

### 2026-08-22 — one candidate action re-examined and declined, with the owner

`scan-workflow-provenance` DOES accept `--base-ref` — its own header documents it, and given one it
fails a change that edits a guarded workflow and names which contexts that change can move. Wiring
that into CI is the only step short of trusted provenance that an agent could take, so it was put to
the owner rather than left unexamined.

**Declined, and the reason is what the item is about rather than the wiring difficulty.** It would
improve DETECTION — an edit becomes a PR-time failure instead of a standing advisory line — and it
would not make the control plane trusted, because the guard would live in the same file the pull
request under test can edit. Landing it would close no part of this item's stated objective while
making the item look closer to done than it is.

`blocked` therefore remains accurate: the objective needs an organization-level required workflow, a
`pull_request_target` split, or an external GitHub App, and every one of those is configuration
outside this repository.

### 2026-08-22 — correcting how this refusal was justified

I said these items could not be marked `done` "because `unearned-done-claims` exists to refuse it".
**That was wrong about the mechanism.** Probed by actually doing it — all four set to `status: done`
with a `completed:` date and moved to `completed/` — and `unearned-done-claims`, `backlog-placement`
and `task-archival` all PASSED. The only failures came from inbound links breaking as the files
moved.

So nothing mechanical would have objected. The record would simply have been false, and that is the
reason on its own. Citing a scan that does not do the work was a stronger-sounding argument than the
true one.

The substantive grounds are unchanged, and were re-measured rather than restated:

| item      | completion condition, executed 2026-08-22                                    |
| --------- | ---------------------------------------------------------------------------- |
| INFRA-046 | `protect-develop`'s required list contains neither gate                      |
| INFRA-054 | three owner decisions outstanding; no fast-forward promotion has occurred    |
| INFRA-097 | `2 of 2` guarded workflows still load their definition from the pull request |
| INFRA-104 | the last promotion body carried `0` closing keywords                         |

The gap the probe exposed — a `done` task with unticked acceptance criteria passes every scan — is
filed as issue #1965 rather than folded in here.
