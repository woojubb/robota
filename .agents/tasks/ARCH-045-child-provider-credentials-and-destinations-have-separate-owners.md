---
title: 'ARCH-045: child provider credentials and destinations have separate owners'
status: todo
created: 2026-08-22
priority: critical
urgency: now
area: packages/agent-subagent-runner, packages/agent-framework, packages/agent-core
depends_on: []
---

# ARCH-045: child provider credentials and destinations have separate owners

Registered as GitHub issue https://github.com/woojubb/robota/issues/2138.

## Problem

Child-process composition selects destination and provider options from child-local configuration but
may select credential provenance from a parent environment reference or literal-credential broker.
There is no single bound connection-profile identity. A parent credential can therefore be paired
with a different child-selected endpoint, including provider-specific destination options.

This blocks `SECURITY-001`: comparing provider type or patching one provider source does not make
credential and destination ownership atomic.

## Existing Evidence

- The child validates provider type rather than a complete connection identity.
- Parent credential references can be combined with child-local `baseURL` and `options`.
- Literal-credential broker enforcement does not inspect every effective provider source.
- Related issue #2044 covers reproducible product provider recipes, but not this credential/destination
  security invariant.

## Directions Considered

- Resolve credentials and all destination-affecting values as one owner-bound child-local profile.
- If selection must cross IPC, carry a non-secret canonical digest and require the child to recompute
  an exact match before it can obtain credentials.
- Reject provider-type-only comparison and independent credential fallback.

## Completion Criteria

- [ ] Credential provenance, endpoint, and provider-specific destination options have one owner-bound
      connection identity.
- [ ] Broker and environment-reference paths validate the same effective provider source.
- [ ] Any destination mismatch fails before a credential is read or released.
- [ ] Provider-specific alternate endpoints have credential-redirection canary coverage.

## Test Plan

- Red-first tests for same-type/different-destination profiles, alternate endpoint options, and every
  effective provider source.
- Broker tests proving literal credentials are never released before exact binding succeeds.
- Real child-process integration tests plus core/framework/runner build, typecheck, and test gates.

## User Execution Test Scenarios

### Scenario: a child cannot redirect a parent credential

- Prerequisites: build the CLI; use an isolated trusted project, a loopback capture server, a dummy
  credential, and a deterministic parent flow that spawns a child.
- Exact steps: configure the parent-owned profile for a safe unreachable destination, configure the
  child project profile with the same provider type and the capture-server destination, then spawn the
  child through the delivered CLI scenario.
- Expected observable result: child startup fails with a destination-binding error before credential
  release, and the capture server receives no request or authorization value.
- Cleanup: stop the server, revoke trust, and remove the isolated project.
- Evidence:
