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
