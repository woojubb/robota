---
title: 'ARCH-043: workspace access is not a session-owned policy'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2139#issuecomment-5454701029
created: 2026-08-22
priority: critical
urgency: now
area: packages/agent-framework, packages/agent-command, packages/agent-cli
depends_on: []
---

# ARCH-043: workspace access is not a session-owned policy

Registered as GitHub issue https://github.com/woojubb/robota/issues/2139.

## Problem

Workspace authority is copied through optional reader fields while Restricted Mode exists only as a
CLI startup boolean. The session does not own one immutable workspace-access policy. Lazy provider
switching, permission persistence, replay validation, and mode transitions can consequently lose the
original authority or increase permissions after a restricted startup.

This blocks `SECURITY-001`: patching the current transition sites would preserve the duplicated
representation that caused them.

## Existing Evidence

- Provider switching does not preserve the session's trusted reader.
- Project allow-tool persistence and replay validation reopen project state outside the initial
  decision.
- Mode and plan-approval transitions can raise a session that the CLI initialized in Restricted Mode.
- The SECURITY-001 architecture refresh classified the repeated representation as FOUNDATIONAL.

## Directions Considered

- Design one immutable workspace-access policy owned by the session recipe/runtime and consumed by
  every eager and lazy operation.
- Reject a second set of CLI transition guards because non-CLI hosts and new lazy paths would bypass
  them.
- Preserve trusted sessions' reader capability while making authority-increasing restricted
  transitions unrepresentable or explicitly refused.

## Completion Criteria

- [ ] Session construction has one workspace-access policy with explicit restricted, trusted, and
      host-owned semantics.
- [ ] Provider switching, replay, project permission persistence, context refresh, and future lazy
      operations consume that same policy.
- [ ] Restricted sessions cannot increase project or tool authority through mode/preset/approval
      transitions.
- [ ] Direct SDK and CLI composition use the same contract.

## Test Plan

- Red-first tests for every current lazy authority-loss path and permission-increasing transition.
- Construction tests for CLI, direct SDK, replay, TUI, and headless hosts.
- Framework/command/CLI builds, typechecks, tests, and scenario verification.

## User Execution Test Scenarios

### Scenario: Restricted Mode remains restricted for the whole session

- Prerequisites: build the CLI; create an isolated untrusted Git project with project provider,
  permission, and replay canaries; use the deterministic scripted provider.
- Exact steps: start the delivered interactive CLI in the project, attempt `/mode`, plan approval,
  provider switching, and replay operations that would increase or reopen project authority.
- Expected observable result: each authority-increasing operation is refused with recovery guidance,
  and no project canary is consumed; after an explicit trust grant a fresh session can use them.
- Cleanup: revoke the grant and remove the isolated project.
- Evidence:
