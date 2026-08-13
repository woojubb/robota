---
title: 'CLI-080: the composition-root agent-executor exemption is granted to a concrete git-worktree adapter, wider than the documented "single permitted exception" — align the rule text or relocate the contract'
status: todo
created: 2026-08-13
priority: low
urgency: later
area: packages/agent-cli, .agents/project-structure.md, scripts/harness/check-background-workspace-conformance.mjs
depends_on: []
---

# CLI-080: executor-import exemption exceeds its documented scope

## Problem

The project-structure rule says `agent-cli`'s only permitted direct import of `@robota-sdk/agent-executor`
is the composition root (app assembly point). The mechanical guard grants a third exemption to a
concrete git-worktree adapter that value-imports `BackgroundTaskError` — which is an implementation
class doing git/fs I/O, not the assembly point. The guard's exemption set and the rule text disagree
about what "composition root" covers.

## Evidence

- `.agents/project-structure.md:357-370` — "the **single permitted exception** is the **composition
  root** … composition-root wiring is the only valid exemption category."
- `packages/agent-cli/src/subagents/git-worktree-isolation-adapter.ts:6-11` — value-imports
  `BackgroundTaskError` (plus port types) from `@robota-sdk/agent-executor`.
- `scripts/harness/check-background-workspace-conformance.mjs:74-78` — a third exemption entry:
  "`…/git-worktree-isolation-adapter.ts`: 'composition root — concrete worktree adapter wiring'". The
  adapter is a concrete I/O class, not the assembly point.

## Direction

Doc-side (likely): extend the project-structure exemption text to name the third sanctioned shape (a
CLI host adapter implementing an executor-owned port), so the rule and the guard agree. Code-side
alternative: move `ISubagentWorktreeAdapter`/`BackgroundTaskError` to a contract layer the CLI may
reach without the executor import, retiring the exemption.

## Test Plan

- If doc-side: the rule text names the adapter category; the guard's three exemptions all match a
  documented category.
- If code-side: `rg` shows no `@robota-sdk/agent-executor` value import outside the assembly point; the
  guard's exemption list drops to two.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — rule/guard alignment (or a type relocation) with no user-facing behavior change.
