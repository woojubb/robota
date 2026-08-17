---
title: 'INFRA-097: trusted provenance for required PR workflows'
issue: https://github.com/woojubb/robota/issues/1719
status: todo
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

- [ ] Verify GitHub event/check attribution and ruleset capabilities for trusted required workflows.
- [ ] Compare required-workflow/ruleset, split `pull_request_target`, and external GitHub App/check-run designs.
- [ ] Specify exact SHA/ref identity, permissions, fork behavior, and branch-protection reconciliation.
- [ ] Add adversarial tests proving a PR cannot replace its own required gate with an unconditional pass.
- [ ] Roll out and validate code, docs-only, fork, retarget, cancellation, and genuine-finding paths.

## Progress

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
