---
title: 'ARCH-036: the child-process subagent runner drops deps.builtInAgents (NEUT-003)'
status: done
completed: 2026-08-18
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

Delivered in #1804, and this record is the part that was left open — the code, the tests and the
issue were all closed while the task file stayed `in-progress` in the active directory.

`resolveAgentDefinition` in `packages/agent-subagent-runner/src/child-process-subagent-runner.ts`
threads `deps.builtInAgents`, so the composition root's choice reaches BOTH runners rather than only
the in-process one. NEUT-003's semantics are pinned by three cases in
`packages/agent-subagent-runner/src/__tests__/child-process-subagent-runner.test.ts`: an injected set
REPLACES the module built-ins, an empty array removes them entirely, and nothing injected leaves them
in place. All 16 tests in that file pass.

Verified before closing rather than taken from the issue state: the fix is present, the semantics
match what NEUT-003 requires, and the tests drive the real runner rather than a helper — which the
test file itself notes was necessary, because the defect was a field on a shared deps type that one
runner never read.
