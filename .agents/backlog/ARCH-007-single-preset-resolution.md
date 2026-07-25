---
title: 'ARCH-007: single preset resolution — route the shell through product.resolvePreset'
status: todo
created: 2026-07-25
priority: medium
urgency: soon
area: packages/agent-cli, packages/agent-preset, packages/agent-product
depends_on: [ARCH-005]
---

# ARCH-007: dual preset resolution after the S2 collapse

## Problem

ARCH-005 S2's conformance review found preset resolution happens TWICE. The shell still resolves
through `agent-preset`'s **module-global** `resolvePreset` (`agent-cli/src/startup/preset-selection.ts:36-40`)
and that result drives every behavior (agentName / model / persona / permissionMode / module delta).
The kernel ALSO builds a per-call registry over the same presets (`agent-product/src/assemble-product.ts:101-103`)
whose outputs — `product.resolvePreset`, `product.defaultPreset` — `cli.ts` never reads.

So ARCH-005's R8 reentrancy property (per-call registry, no module-global mutation) buys robota
nothing, and the global mutation stays load-bearing. Spec boundary-table row 1 ("external-preset
registration + preset-resolve glue → In-kernel", spec:416) is unmet for the dogfooding product.

## What

Route the shell through `product.resolvePreset(selectedPresetId, { cliOverrides })` (the reviewer
notes this is essentially a one-line change at the call site), then decide the fate of the
module-global registry that `/preset` and `listPresets` still read — either migrate those consumers
to the per-call registry or document why the global remains for the interactive command surface.

## Test Plan

Red-first: assert two `assembleProduct` calls in one process do not contaminate each other's preset
registry AND that robota's resolved preset options are identical to today's (extend the ARCH-005
equivalence suite). `pnpm harness:verify-like-ci` green.
