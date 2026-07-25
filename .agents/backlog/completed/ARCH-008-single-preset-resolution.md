---
title: 'ARCH-008: single preset resolution — route the shell through the kernel per-call registry'
status: done
created: 2026-07-25
completed: 2026-07-25
priority: medium
urgency: soon
area: packages/agent-cli, packages/agent-preset, packages/agent-product
depends_on: [ARCH-005]
---

# ARCH-008: dual preset resolution after the S2 collapse

## Problem

ARCH-005 S2's conformance review found preset resolution happens TWICE. The shell still resolves
through `agent-preset`'s **module-global** `resolvePreset`
(`agent-cli/src/startup/preset-selection.ts:36-40`) and that result drives every behavior (agentName /
model / persona / permissionMode / module delta). The kernel ALSO builds a per-call registry over the
same presets (`agent-product/src/assemble-product.ts:101-103`) whose outputs — `product.resolvePreset`,
`product.defaultPreset` — `cli.ts` never reads.

So ARCH-005's R8 reentrancy property (per-call registry, no module-global mutation) buys robota
nothing, and the global mutation stays load-bearing. Spec boundary-table row 1 ("external-preset
registration + preset-resolve glue → In-kernel", spec:416) is unmet for the dogfooding product.

The S3 external proof (#1392) verified R8 genuinely works **from outside** — so this is specifically
robota not using what the published kernel already provides correctly.

## What

Route the shell through `product.resolvePreset(selectedPresetId, { cliOverrides })` (the reviewer
notes this is essentially a one-line change at the call site), then decide the fate of the
module-global registry that `/preset` and `listPresets` still read — either migrate those consumers
to the per-call registry or document why the global remains for the interactive command surface.

Sibling items from the same audit: ARCH-006 (framework tool-axis neutrality) and ARCH-007 (route
robota through the kernel runtime seam) — this item is the preset half of the same "robota uses the
kernel's materials, not its seams" finding.

## Test Plan

Red-first: assert two `assembleProduct` calls in one process do not contaminate each other's preset
registry AND that robota's resolved preset options are identical to today's (extend the ARCH-005
equivalence suite). `pnpm harness:verify-like-ci` green.

## Outcome (2026-07-25)

**DONE — one resolution path. The literal "one-line change at the call site" is NOT possible; the
property it was after is delivered a different way.**

### The premise that did not survive contact with the code

`product.resolvePreset` cannot be the shell's primary resolver, because the resolved preset is an INPUT
to the profile `assembleProduct` folds:

- `modelId = resolvedPreset.model ?? providerSettings.model` feeds both the profile's `providerSettings`
  and the `subagentRunnerFactory` the shell constructs BEFORE the profile exists;
- `agentName: resolvedPreset.agentName ?? DEFAULT_AGENT_NAME` is a profile field.

A preset can carry the model and identity a product is itself assembled from, so "resolve, then
assemble" is a genuine ordering constraint — not a robota quirk, and not something ARCH-006/007's
reshaping of `cli.ts` introduced. Calling `product.resolvePreset` after assembly would either need the
shell to resolve twice (the dual path this item exists to remove) or move provider/subagent construction
into the kernel behind a lazy plumbing seam (a far larger change, and one the profile contract does not
want).

### What was done instead

The kernel now lets the caller hand its registry IN, so the pre-assembly resolution and the assembler's
resolution run over the same object:

- `IProductProfile.presetRegistry?: IPresetRegistry` — when present, `assembleProduct` ADOPTS that
  instance rather than building a second, equivalent one (`product.presets` **is** that object).
  `presets` is untouched and still works for consumers with no ordering constraint (the S3 external
  fixture's Mode B uses it unchanged).
- `IProductProfile.presetContext?: IResolvePresetContext` — the override layers used when resolving
  `defaultPresetId`, so `product.defaultPreset` is the caller's FULL resolution. Before this it was
  resolved without `cliOverrides`, i.e. a half-resolved value that could silently diverge from the
  shell's; it feeds the runtime overlay's `permissionMode`, so the divergence was live, not theoretical.
- `agent-cli`: `resolveCliPreset` → `resolveShellPreset(externalPresets, args, settingsPreset)`, which
  builds the per-call registry (R8), resolves over it, and returns `{ registry, presetId, context,
options }` as ONE value. `IRobotaProfileInput.preset` takes that whole value, so a shell that resolved
  with one registry cannot hand the kernel a different one — the mismatch is not expressible.

R8 is strengthened, not weakened: the adopted registry is still instance-scoped, still reads and mutates
no module-level state, and two `assembleProduct` calls in one process still cannot contaminate each
other (asserted in both directions).

### The module-global registry: DECIDED — it stays, as DISCOVERY only

Explicitly, with the reasoning recorded so the ambiguity this item exists to remove does not come back:

- **It is off the resolution path.** `robota`'s startup no longer calls `resolvePreset`/`getPreset` for
  resolution. Proven by a test that registers a preset with the SAME id and a DIFFERENT persona in the
  global and asserts the shell resolves the SHELL's copy.
- **It remains the in-session `/preset` surface.** `/preset` lives in `@robota-sdk/agent-command`, is
  executed inside a running session via `ICommandHostContext`, and has no handle on the assembled
  product. Migrating it means threading an `IPresetRegistry` through the command-host context — a
  cross-package contract change in a package this item does not own. Filed as **ARCH-009**.
- **The two cannot disagree.** Both are fed by the one `loadExternalPresets()` call; the anti-split gate
  in `robota-runtime-seam.test.ts` asserts identical resolution through both.

ARCH-005 boundary-table row 1 is updated: In-kernel is now MET for the dogfooding product, and the
global's surviving role is named as discovery rather than resolution (superseding ARCH-007's B2
option iii, whose ordering argument is satisfied by handing the registry in).

### Evidence

- **Red-first, at assertion level (not compile errors):** 3 probes failed against the pre-change code —
  `product.defaultPreset` ≠ the shell's resolution, the shell resolving from the module-global, and
  `product.presets` not being the shell's registry (3 failed / 11 passed).
- **Mutation-proven, three ways.** (a) Ignore `profile.presetRegistry` → 2 agent-product tests fail.
  (b) Drop `profile.presetContext` from the `defaultPresetId` resolve → 2 fail. (c) Resolve through the
  module-global in `resolveShellPreset` → 3 agent-cli tests fail. Each reverted → green. The mutation
  pass also caught a test of mine that passed for the WRONG reason (an "unknown id throws" assertion the
  kernel satisfied one layer later); it was rewritten to assert the resolved VALUE, and re-mutated.
- **The equivalence gate calls the SHIPPED helpers**, never a re-derivation: `resolveShellPreset`,
  `createRobotaProfile`, `buildCommandSetup`, `selectProductCommandModules`. No pinned literal was
  relaxed; `robota-assembly-equivalence` is green with 6 new ARCH-008 cases.
- Suites: agent-cli 266, agent-framework 1269, agent-transport-tui 526, agent-preset 71,
  agent-product 15 — all green. `pnpm -w typecheck` clean. `pnpm proof:external` 69/69.
  `pnpm harness:verify-like-ci` green.
- **Real binary.** With `~/.robota/presets/arch008-smoke.json` on disk: `robota --preset arch008-smoke
-p` reached the model with the external preset's persona applied; `robota -p "/preset"` listed it with
  the correct active marker; `robota -p "/preset arch008-smoke"` switched live; `--preset __nope__`
  exits 1 listing the available ids. Both surfaces work, from the one load.

### Residual

`cli.ts`'s own wiring has no test of its own — the profile taking the resolution as ONE required value
makes a registry/id/context mismatch inexpressible, but nothing mechanically forbids a second
`resolveShellPreset` call being added later. Retiring the module-global entirely (ARCH-009) would remove
the question.
