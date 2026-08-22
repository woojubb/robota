---
title: 'ARCH-042: public SDK project authority is ambient'
status: todo
created: 2026-08-22
priority: critical
urgency: now
area: packages/agent-framework, packages/agent-session, packages/agent-provider-replay
depends_on: []
---

# ARCH-042: public SDK project authority is ambient

Registered as GitHub issue https://github.com/woojubb/robota/issues/2137.

## Problem

Public SDK project APIs still encode authority as a path, raw Node filesystem access, or an optional
reader. Session persistence, memory, checkpoints, task context, prompt references, and provider
settings repeat that shape. Securing one loader therefore leaves both existing bypasses and a contract
that will recreate the same bypass in the next project-scoped API.

This blocks `SECURITY-001`: its Restricted Mode claim cannot be true for direct SDK consumers while
public project loaders silently fall back to ambient filesystem access.

## Existing Evidence

- `packages/agent-framework/src/interactive/session-persistence.ts` defaults a project session store
  to raw Node I/O.
- Project memory, checkpoint, task-context, prompt-reference, and provider-settings surfaces each
  expose a capabilityless project path or raw-I/O fallback.
- The SECURITY-001 architecture refresh classified the repeated published contract as FOUNDATIONAL,
  not as a set of independent call-site bugs.

## Directions Considered

- Design one explicit public authority model separating host-owned content and generic filesystem
  adapters from project-scoped operations.
- Reject another optional-reader convention: absence has already acquired incompatible meanings.
- Reject per-loader patches because they retain ambient authority as the public extension pattern.

## Completion Criteria

- [ ] Every public project-scoped SDK entry point requires authenticated workspace authority or
      returns a documented restricted/refused result.
- [ ] Host-owned prebuilt content and generic filesystem adapters remain possible through contracts
      that do not imply workspace trust.
- [ ] Package public-surface documentation and examples expose one authority model.
- [ ] A mechanical or type-level guard prevents a new public project loader from adding an ambient
      path/raw-I/O fallback.

## Test Plan

- Type-level contract tests for project APIs with and without workspace authority.
- Runtime tests proving capabilityless calls cannot consume project settings, context, session logs,
  memory, checkpoints, tasks, or prompt references.
- Package builds, typechecks, tests, public-surface scans, and SDK documentation examples.

## User Execution Test Scenarios

### Scenario: a reader-less SDK session cannot consume project state

- Prerequisites: build the affected packages; create an isolated Git project containing canary
  settings, context, memory, and session data.
- Exact steps: run the delivered public SDK example once without workspace authority and once after
  obtaining authority through the supported trust service.
- Expected observable result: the first run reports restricted project access and exposes none of
  the canaries; the second run reads only the explicitly authorized project contributions.
- Cleanup: remove the isolated project and trust grant.
- Evidence:
