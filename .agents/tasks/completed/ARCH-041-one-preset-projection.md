---
title: 'ARCH-041: the preset→surface projection is written three times, and has already drifted'
status: done
completed: 2026-08-20
created: 2026-08-20
priority: high
urgency: now
area: packages/agent-cli, scripts/harness
depends_on: []
blocks: [ARCH-040]
---

# ARCH-041: three copies of one projection, and a measurement that sees two of them

## Problem

`packages/agent-cli/src/startup/preset-surface-options.ts` says of itself:

> Adding a field here now reaches every surface at once, which is the only property that makes this
> worth extracting.

The property does not hold. Two of the three shell surfaces declare their OWN copy:

| interface                 | file                                | carries `model`? |
| ------------------------- | ----------------------------------- | ---------------- |
| `IPresetSurfaceOptions`   | `startup/preset-surface-options.ts` | no               |
| `IPrintModePresetOptions` | `modes/print-mode.ts`               | **yes**          |
| `IServeModePresetOptions` | `modes/serve-mode.ts`               | no               |

They have already drifted: `model` reached print mode and neither of the others. That is the exact
shape ARCH-013 was filed about — "a field added to the resolved preset arrives at whichever surfaces
someone remembered, and is silently absent from the rest" — surviving the extraction meant to end it.

**The measurement shares the blind spot.** `presetProjection.surfaces` in `.agents/harness.config.json`
lists two interfaces, and neither mode copy is one of them, so the divergence rule cannot see the
surfaces that actually diverged. A guard whose subject excludes the drifting case is a guard that
cannot fire.

## Why it is filed rather than absorbed into ARCH-040

Found while starting ARCH-040's Group C. Every remaining ARCH-040 group (tools, prompts, model
group, language) adds a field to this projection, so with three copies each field lands in three
places while the scan checks two — installing the defect ARCH-040 exists to remove, three times over.
It is a cause one level under that item and blocks it.

It ships on ARCH-040's branch because ARCH-040 cannot proceed without it and GitHub was unreachable
for the whole session, so a separate PR was not openable. The record is separate because the CAUSE is.

## What

One declaration. The mode surfaces take `Partial<IPresetSurfaceOptions>` rather than re-declaring it,
so a field added to the shared type reaches all three by construction — the property the docblock
already claims. `model` moves onto the shared type, which is also the declared projection ARCH-040's
`model` entry was waiting for.

## Test Plan

Red-first: a field added to `IPresetSurfaceOptions` and projected must be visible to all three
surfaces without any per-surface edit, asserted by a case that fails if a surface re-declares its own
shape. Then: `scan-preset-projection` passes with `model` removed from `pendingProjection`, and the
existing print/serve mode tests stay green.

## Result

One declaration. `IPrintModePresetOptions` and `IServeModePresetOptions` are now
`Partial<IPresetSurfaceOptions>`, so a field added to the shared type reaches all three surfaces by
construction — the property the docblock already claimed.

`model` moved onto the shared type and is projected from `resolved.model`. The shell's
`?? providerSettings.model` fallback stays where it is: the two cannot disagree, because whenever the
key is present it holds the value the shell computed, and whenever the preset names no model the key
is ABSENT rather than explicitly `undefined`, so the shell's own key survives the spread. Threading
the fallback in as well would have been a second answer to a question that already has one — and it
also cost `cli.ts` six lines it had no budget for, which is how the simpler design got found.

`presetProjection.pendingProjection`: 9 exemptions to 8.

### Where the enforcement is, and where it is not

The single-declaration property is enforced by the TYPECHECK. Measured: re-declaring
`IPrintModePresetOptions` as its own interface produces 12 `tsgo` errors and 3 GREEN vitest cases,
because vitest does not typecheck. The first draft of the test file called its assignment case "the
enforcement", which would have been a case that cannot fail on the condition it names — the defect
this repository has a scan family about. The file now says plainly that the assignment case
documents a compile-time contract and that `pnpm typecheck`, a stage of `harness:verify-like-ci`, is
the gate. The two `model` cases are ordinary runtime assertions and are red-proofed.

## Unblocks

ARCH-040 Groups C–F can now add a field in ONE place. Group B remains parked on its own re-decision,
which is independent of this.
