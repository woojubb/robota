---
title: 'ARCH-035: the tool surface has no defaults-aggregator leaf, so it cannot be cut by a manifest edge'
status: todo
created: 2026-08-16
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-tools, packages/agent-subagent-runner
depends_on: []
issue: https://github.com/woojubb/robota/issues/1787
---

# ARCH-035: the tool surface has no defaults-aggregator leaf, so it cannot be cut by a manifest edge

## Problem

Found by `proposal-reviewer` while checking ARCH-021's structural-guarantee claim, and it is the
reason that claim had to be narrowed.

ARCH-021 deletes `@robota-sdk/agent-provider-defaults` from `agent-subagent-runner`'s manifest, which
makes reaching for the default **provider** registry a compile error — `createDefaultProviderDefinitions`
is owned only by that package.

The **tool** axis cannot be cut the same way. `createDefaultTools` is barrel-exported by
`agent-framework`, and `agent-subagent-runner` must keep `agent-framework` for `createSubagentSession`
/ `createSubagentLogger` / `getBuiltInAgent`. So after ARCH-021,
`import { createDefaultTools } from '@robota-sdk/agent-framework'` still compiles there — held by a
mechanical scan rather than by the type system.

That asymmetry matters because the tool axis is the one with the failure history: ARCH-010 (unconfined
child tools) and ARCH-006 (pack-owned tool surface) are both tool-surface findings at this seam.

Related, one layer over: `agent-framework`'s own `assembleSessionTools` falls back with
`defaultTools ?? createDefaultTools(...)` — the same "neutral library imports the default surface"
shape ARCH-021 condemns.

Candidate direction: an `agent-tool-defaults` leaf mirroring `agent-provider-defaults`. This implies a
package extraction and a change to `agent-framework`'s default tool tier — schedule it, do not absorb
it into another item.

## Blockers

- None.

## Result

Pending.
