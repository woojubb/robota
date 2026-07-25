---
title: 'ARCH-007: robota consumes the product kernel MATERIALS but not its runtime seam or preset resolver'
status: done
created: 2026-07-25
completed: 2026-07-25
priority: medium
urgency: soon
area: packages/agent-cli, packages/agent-product, packages/agent-preset
depends_on: [ARCH-005]
---

# ARCH-007: close the two seams `robota` does not eat (the ARCH-005 S2 B1/B2 disclosure)

## Problem

ARCH-005 S2's conformance review recorded a disclosure and said closure was "tracked by the follow-up
backlog items filed from the review (B1/B2)". **Those items were never actually filed** — the S3
external-consumer proof found the reference dangling. This file is them, written down.

Two In-kernel rows of the ARCH-005 boundary table are unmet **for the dogfooding product itself**, even
though `agent-product` implements both and external Mode-A consumers exercise them (the S3 proof does):

- **B1 — runtime-build delegation.** `cli.ts` does not call `product.buildRuntime` /
  `product.buildRuntimeOptions`. It passes the assembled materials (provider, command modules,
  `agentDefinitions`) into `renderApp` / `runPrintMode` / `runServeMode`, each of which constructs its
  session through its own channel. Those channels do reach `buildRuntimeSession`, so there is no competing
  runtime-construction SSOT — but the kernel's OVERLAY (which is what applies pack tools, pack subagents and
  the default preset's `permissionMode`) is exercised only by tests and by external consumers, never by
  `robota`.
- **B2 — preset-resolve glue.** `cli.ts` does not call `product.resolvePreset`. It still resolves through
  `agent-preset`'s module-global `resolvePreset` (via `resolveCliPreset`), for two stated reasons: the
  resolved preset is needed BEFORE the base command modules are built (its module-selection delta feeds
  them), and the in-session `/preset` command reads that same module-global registry — so moving the shell
  to the instance registry alone would split that SSOT.

Neither is a defect in the kernel and neither affects any external consumption mode. But "robota builds
robota" means the reference consumer should be the FIRST consumer of every seam it ships, and today it is
not. Two consequences worth naming: the kernel's overlay path has no product-level regression pressure, and
the ARCH-005 dogfooding claim is weaker than the spec's boundary table reads.

## Proposed direction

**B1** — route `cli.ts`'s three presentation channels through `product.buildRuntimeOptions` so the shell
resolves its own session options as it does today and the kernel lays the product-owned materials on top,
before each channel hands the result to `buildRuntimeSession`. The equivalence bar is the existing one:
`robota` behaviour unchanged (CLI golden + full `agent-cli`/`agent-transport-tui` suites +
`robota-assembly-equivalence`).

**B2** — decide the preset-registry SSOT explicitly rather than leaving the shell on the module-global by
default. The ordering constraint is real (preset resolution precedes base command-module construction), so
the options are (i) resolve twice — once early from the instance registry for the module delta, once for the
session — (ii) let the shell build the `IPresetRegistry` itself and pass it into the profile so the
in-session `/preset` command reads the same instance, or (iii) accept the module-global for the shell and
document that `IAssembledProduct.resolvePreset` is the external-consumer path only. Whichever is chosen, the
spec's In-kernel/stays-in-shell table must be corrected to match.

## Test Plan

- B1: assert the pack-supplied `agentDefinitions` and `additionalTools` reach a session built by each of the
  three real `robota` channels (not only by `product.buildRuntime`) — red-first, since today they do not for
  the overlay path.
- B1: `robota` behaviour held invariant — CLI golden output, the full `agent-cli` and `agent-transport-tui`
  suites, and the `robota-assembly-equivalence` test.
- B2: whichever option is chosen, a test that a preset registered through the chosen path is visible to BOTH
  the startup module-selection delta and the in-session `/preset` command — the split-SSOT failure mode.

## Outcome (2026-07-25)

Both halves landed; see the ARCH-005 spec's `[ARCH-006 + ARCH-007]` evidence entry for the full record.

- **B1 — runtime-build delegation. DONE.** `startCli` calls `product.buildRuntimeOptions(...)` once,
  through the shipped `buildRobotaRuntimeOptions` helper. The shell resolves its own session inputs (the
  preset's module-selection delta over the merged `base ⊕ packs` superset, and the explicit
  `--permission-mode`); the kernel lays the product-owned materials on top — pack tools →
  `additionalTools`, pack subagents → `agentDefinitions`, and the default preset's `permissionMode` when
  the shell left it unset. All three surfaces bind to that one result. The hand-threaded
  `const agentDefinitions = product.subagents` and the three per-surface
  `args.permissionMode ?? resolvedPreset.permissionMode` expressions are deleted. `agent-product`'s
  overlay was corrected to stop overwriting a caller-supplied `commandModules`, which would otherwise have
  silently undone robota's preset delta.
- **B2 — preset-resolve glue. DECIDED (option iii) + documented.** The shell KEEPS `agent-preset`'s
  module-global registry as its preset SSOT, because the resolved preset is needed BEFORE the base command
  modules are built and the in-session `/preset` command reads that same registry — moving only the shell
  to the instance registry would split it. `IAssembledProduct.resolvePreset` is the external-consumer
  path. The ARCH-005 In-kernel/stays-in-shell table row is corrected accordingly, and an anti-split test
  asserts an external preset resolves identically through both paths.

Red-first (all 6 new cases failed before the helper existed), mutation-proven, 255 agent-cli tests green
including the unchanged ARCH-005 equivalence suite. ARCH-005 **TC-7** is now checked.

One residual belongs to ARCH-006, not here: `additionalTools` reaches `--serve` (whose session options
`agent-cli` owns) but not the print/TUI channels, which build theirs inside `agent-transport` /
`agent-transport-tui` and still need the same one-line optional pass-through the `agentDefinitions` seam
already has. Behaviourally inert today under first-wins dedupe.
