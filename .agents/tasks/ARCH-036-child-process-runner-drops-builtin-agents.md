---
title: 'ARCH-036: the child-process subagent runner drops deps.builtInAgents (NEUT-003)'
status: todo
created: 2026-08-16
priority: medium
urgency: later
area: packages/agent-subagent-runner
depends_on: []
issue: https://github.com/woojubb/robota/issues/1788
---

# ARCH-036: the child-process subagent runner drops deps.builtInAgents (NEUT-003)

## Problem

Found by `proposal-reviewer` while testing ARCH-021's premises; same defect class as the dropped
`deps.tools`, in the same file, but outside ARCH-021's stated scope.

NEUT-003 established that an injected `deps.builtInAgents` set REPLACES the module built-ins (an empty
array removes them entirely). The **in-process** runner honours it. The **child-process** runner's
`resolveAgentDefinition` reads only `customAgentRegistry` and otherwise falls back to
`getBuiltInAgent` — so an injected built-in set does not reach a child-process subagent.

**Latent today**: no composition root populates `builtInAgents`, and robota's pack subagents reach the
child through `customAgentRegistry`. It becomes visible the moment a product injects or removes
built-ins.

Small (roughly two lines), but it is a capability the composition root declared and the child ignores —
the same shape ARCH-021 exists to remove.

## Blockers

- None.

## Result

Pending.
