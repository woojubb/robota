---
title: 'ARCH-REV-010: Create packages/agent-subagent-runner/docs/SPEC.md — only package missing a SPEC'
status: todo
created: 2026-05-18
priority: critical
urgency: now
area: packages/agent-subagent-runner/docs/SPEC.md
depends_on: []
---

## Problem

`packages/agent-subagent-runner` is the **only package in the repository without a `docs/SPEC.md`**. The package was created as part of CLI-AUDIT-022 / ARCH-FIX-020 (branch `refactor/arch-002-slim-agent-cli`, merged 2026-05-17). Its architecture is documented only through CLI audit items and class inventory rows — the package's own boundary has no SSOT owner document.

Without a SPEC.md:

- Any change to the subagent runner has no document to validate against
- Boundary drift is undetectable by harness SPEC coverage checks
- IPC protocol, worker entry contract, opt-in dependency model have no SSOT

Source: Senior Planner (C-03).

## Recommendation

**Proceed without user approval** — creating a SPEC.md for an existing package is a documentation task that can be done by reading the source code. No new design decisions required.

The SPEC.md should cover (using the standard spec template):

- **Scope**: child-process subagent execution, IPC protocol, worker path resolution
- **Boundaries**: must not import from `agent-command` or `agent-cli`; depends on `agent-core`, `agent-executor`, `agent-framework`, `agent-provider`
- **Opt-in model**: installed separately; not a default dependency
- **Architecture**: `ChildProcessSubagentRunner`, `child-process-subagent-worker.ts`, `worker-path-resolver.ts`
- **IPC protocol**: how worker communicates with parent
- **Type ownership**: which types are owned vs imported

Source material: `layering-audit.md` CLI-AUDIT-022, `class-interface-inventory.md` rows for `agent-subagent-runner`, actual source files.

## Test Plan

- Read `packages/agent-subagent-runner/src/` to verify SPEC accuracy
- Verify `packages/agent-subagent-runner/package.json` deps match the SPEC boundaries
- `pnpm harness:scan` must pass (harness checks for SPEC.md existence)
- SPEC follows the standard template from `.agents/templates/spec-template.md`

## User Execution Test Scenarios

Not applicable — documentation-only change with no runnable user-facing behavior.
