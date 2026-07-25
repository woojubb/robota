---
title: 'ARCH-006: route robota through the kernel runtime seam (closes the pack TOOL axis)'
status: todo
created: 2026-07-25
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-cli, packages/agent-product
depends_on: [ARCH-005]
---

# ARCH-006: robota consumes the kernel's materials, not its runtime seam

## Problem

ARCH-005 S2's independent conformance review (2026-07-25) found that `robota` uses
`assembleProduct` for its MATERIALS but never calls the kernel's runtime seam:
`product.buildRuntime` / `product.buildRuntimeOptions` are dead code for robota. All three surfaces
(print / serve / TUI) still build their own `TInteractiveSessionOptions`, so the kernel's overlay —
pack tools → `additionalTools`, pack subagents → `agentDefinitions`, default-preset `permissionMode`
— is exercised only by tests, and robota re-threads subagents by hand (`agent-cli/src/cli.ts:320`).

Two spec boundary-table rows are therefore unmet for the dogfooding product (spec:420 "runtime-build
delegation → In-kernel").

**Direct consequence — the pack TOOL axis is partially phantom.** `agent-framework`'s `createSession`
hard-codes `createDefaultTools()` and concatenates `additionalTools` with no dedupe, so overlaying
`pack-coding`'s identical ten tools would DUPLICATE them. An external Mode C consumer using
`buildRuntime` gets a working tool axis; robota's own surfaces still take tools from the framework
default. "robota dogfoods the pack" is true for commands and subagents, not for tools.

## What

1. **Framework:** make the default tool set injectable/suppressible and dedupe `additionalTools` by
   tool name (scoped additive; byte-identical when the option is absent, per the Decision-2 precedent).
2. **agent-cli:** route print / serve / TUI through `product.buildRuntimeOptions(...)` instead of
   hand-building session options; delete the hand-threaded subagent path.
3. Remove the now-dead overlay duplication; the kernel becomes the single assembly path for robota.

## Acceptance (the bar the command + subagent axes already meet)

Removing `codingPack` from `ROBOTA_PACKS` removes the 10 coding TOOLS from robota's surface — proven
by test. Plus: byte-identical behavior otherwise (the ARCH-005 equivalence suite stays green),
`pnpm harness:verify-like-ci` green.
