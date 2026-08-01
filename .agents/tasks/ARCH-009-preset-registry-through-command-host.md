---
title: 'ARCH-009: thread the preset registry through the command-host context so `/preset` can drop the module global'
status: todo
created: 2026-07-25
priority: low
urgency: later
area: packages/agent-command, packages/agent-framework, packages/agent-cli
depends_on: [ARCH-008]
---

# ARCH-009: the module-global preset registry survives only because `/preset` cannot reach an instance one

## Problem

ARCH-008 took `robota`'s startup preset resolution off `agent-preset`'s module-global registry: the shell
builds a per-call instance registry (`createPresetRegistry`, R8), resolves over it, and hands it into the
product profile, which adopts it. The module-global registry is now used for exactly one thing —
**discovery inside a running session**:

- `packages/agent-command/src/preset/preset-command.ts` calls `listPresets()`, `getPreset(id)` and
  `resolvePreset(id)`;
- `packages/agent-command/src/preset/preset-command-module.ts` calls `listPresets()` for the command's
  argument source.

Those run inside the session with only an `ICommandHostContext`. There is no path from there to the
assembled product, so they cannot see the instance registry the shell resolved with. Hence
`loadExternalPresets()` still registers into the module global purely to keep `/preset` working.

The two cannot currently disagree — both are fed by the one `loadExternalPresets()` call, and an
anti-split test asserts identical resolution through both — but the process-wide mutable registry is
still there, which is what makes "two products in one process" (the R8 scenario) only half-true for an
embedded host, and it is a state-mutation seam nobody wants to be load-bearing.

## What

Thread an `IPresetRegistry` to the `/preset` command through the command-host context (the same shape the
other host-provided capabilities already use), have `agent-cli` supply the registry it resolved with, and
then delete the module-global registration from the startup path. `registerExternalPresets` /
`clearExternalPresets` / the module-global `resolvePreset` can either become test-only or be removed from
the public surface — decide explicitly and record it, as ARCH-008 did.

Not urgent: nothing is broken today. The value is retiring the last mutable process-global on the preset
axis so R8 holds for an embedded/multi-product host as well as for the CLI.

## Test Plan

Red-first: with the module-global registration removed, an external preset loaded by the shell must still
be listed by `/preset`, resolvable by `/preset <id>`, and applied to the live session — asserted through
the shipped command path, not a re-implementation. Then: two products assembled in one process must each
see only their own external presets from their own `/preset` surface (the property the module global makes
impossible today). `pnpm harness:verify-like-ci` green.
