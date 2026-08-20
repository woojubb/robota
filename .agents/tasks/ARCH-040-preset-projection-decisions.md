---
title: 'ARCH-040: ten resolved-preset fields need a projection DECISION, not just a seam'
status: in-progress
created: 2026-08-20
priority: medium
urgency: soon
area: packages/agent-preset, packages/agent-framework, packages/agent-cli
depends_on: [ARCH-013]
issue: https://github.com/woojubb/robota/issues/1820
---

# ARCH-040: the ten fields ARCH-013 stage 2 measured but could not decide

## Problem

ARCH-013 stage 2 landed the MEASUREMENT: `scripts/harness/scan-preset-projection.mjs` checks that
every `IResolvedPresetOptions` field appears in a **declared** projection — a surface interface
member or a `Pick` of the source — and that the two projection surfaces do not diverge.

Ten fields could not be resolved in that change, because each needs a decision with **user-visible
consequences** that a scan cannot make. They were recorded as named, expiring exemptions in
`.agents/harness.config.json` → `presetProjection.pendingProjection`, each carrying its own reason,
so the list is visible in review and a stale entry is reported as `preset-exemption-unused`.

Filed as issue #1820. This item executes the decisions.

## The decisions, and who made them

The owner decided all four groups on 2026-08-20. Recorded here rather than in a commit message,
because a decision is the thing a later reader needs and a commit message is not where they look.

| Group                                                             | Decision                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentName`                                                       | `/preset` **renames** the agent mid-session. Startup already applies it; the divergence meant the same preset gave two different results depending on when it was chosen.                                                                                                          |
| `allowedTools` / `deniedTools`                                    | An allowlist **REPLACES** — it is a statement of the complete permitted set. A denylist **COMPOSES** (union) — a denial is never weakened by a preset.                                                                                                                             |
| `systemPrompt` / `appendSystemPrompt`                             | `systemPrompt` **SEEDS** the framework's composed prompt rather than replacing it; a full replacement would silently drop the AGENTS.md and skill context the framework composes. `appendSystemPrompt` appends **after** the CLI-sourced text.                                     |
| `temperature`, `maxOutputTokens`, `language`, `defaultTrustLevel` | Wire the first two through a provider-config seam (the live `/preset` path already applies them, so startup is the asymmetry). `language` becomes a persona-section instruction. `defaultTrustLevel` is **removed from the contract** — the ARCH-013 audit measured it fully dead. |

`model` needs no owner decision: the value already reaches the session by hand
(`cli.ts` computes `resolvedPreset.model ?? providerSettings.model`). What is missing is the DECLARED
projection, and where the fallback lives is an implementation choice made in this item.

## Plan

- [x] Group A — remove `defaultTrustLevel` from `IResolvedPresetOptions` and its validator.
- [ ] Group B — `agentName` on the live `/preset` path. **PARKED on a measured cost the decision did
      not have in front of it** (see below); every other group is independent of it.
- [ ] Group C — `allowedTools` (replace) and `deniedTools` (compose), resolved together. **BLOCKED on a
      missing capability**, see below. The RULE is decided and its home is identified; only the live
      seam is absent.
- [ ] Group D — `systemPrompt` (seed) and `appendSystemPrompt` (merge order).
- [x] Group E — the model group: `model` declared (ARCH-041), `temperature` and `maxOutputTokens` wired.
- [x] Group F — `language` as a prompt-section instruction, live and at startup.
- [ ] Empty `presetProjection.pendingProjection`, and make the `IResolvedPresetOptions` docblock TRUE.

## Test Plan

Red-first per group: each decision is asserted through the shipped path, and each is red-proofed —
the mutation that undoes it fails the named case and nothing else. The composing/replacing pair is
asserted in BOTH directions, since a rule about combination can fail either way.

`pnpm harness:verify-like-ci` green, and `scan-preset-projection` passing with an EMPTY
`pendingProjection` — which is the measurement this item exists to satisfy.

## The claim that must become true

`IResolvedPresetOptions`' docblock says _"Every field maps to an existing `agent-framework`
session/assembly seam"_. It is false today for `systemPrompt`, `language`, `temperature`,
`maxOutputTokens` and `defaultTrustLevel`. Changing the words without changing the fact is the
defect, not the fix; this item makes it true.

## Group B is parked, and why

The owner decided `/preset` should rename the agent. Implementing it turned up a cost the decision
was not made against, so it is recorded here rather than paid silently.

**What `agentName` actually reaches.** Its only reader is `Robota.name` — a `public readonly`
identity label. No surface displays it: the TUI's `agentName` option is forwarded straight into
session construction and rendered nowhere, and `Robota.name` is read by the module-manager
construction and by `getConfig()`/`getStats()`. So a mid-session rename changes a label almost
nothing observes.

**What it costs.** `Robota.name` is assigned once in the constructor and declared `readonly`.
`updateConfiguration` is not a general seam — it throws for any patch that is not `tools`. Making the
name renameable therefore means either a mutable field on a core class or a split of
`packages/agent-core/src/core/robota.ts`, which the file-size ratchet freezes at 411 lines. A
first cut measured +25 lines; compressed to the minimum it is still +8, and offsetting that by
trimming unrelated code in the same file is the "regenerate the baseline" move ARCH-038 argued
against three days earlier.

**The question to re-decide:** is a renameable identity label worth a mutable field on
`Robota`, or is the honest resolution of the divergence the other direction — `agentName` is
construction-time identity, and the STARTUP surface should stop implying otherwise?

Nothing about this blocks Groups C–F, which touch neither the field nor the file.

## Found while starting Group C: the projection is still written THREE times

`IPresetSurfaceOptions` says of itself that "adding a field here now reaches every surface at once,
which is the only property that makes this worth extracting." That property does not hold. Two of the
three shell surfaces declare their OWN copy of the projection:

| interface                 | file                                                       | carries `model`? |
| ------------------------- | ---------------------------------------------------------- | ---------------- |
| `IPresetSurfaceOptions`   | `packages/agent-cli/src/startup/preset-surface-options.ts` | no               |
| `IPrintModePresetOptions` | `packages/agent-cli/src/modes/print-mode.ts`               | **yes**          |
| `IServeModePresetOptions` | `packages/agent-cli/src/modes/serve-mode.ts`               | no               |

They have already drifted — `model` reached print mode and neither of the others, which is the exact
shape ARCH-013 was filed about, surviving the extraction meant to end it.

**The measurement has the same blind spot.** `presetProjection.surfaces` in
`.agents/harness.config.json` lists two interfaces, and neither of the two mode copies is one of
them, so the divergence rule cannot see the surfaces that actually diverged.

**Why it blocks the remaining groups rather than being an aside.** Every one of C, D, E and F adds a
field to the projection. With three copies, each field must be added in three places and the scan
checks two of them — so the work would install exactly the defect this item exists to remove, three
times over.

**Disposition.** This is a separate cause, one level under ARCH-040, and it should be filed as its own
item rather than folded in — the repository's own rule. It could not be filed as a GitHub issue in
this session because GitHub was unreachable (both `git push` and `api.github.com` time out); FILE IT
before Groups C–F resume.

## Group C is blocked on a capability, not on a decision

The combine rule is settled — allow REPLACES, deny UNIONS — and its home is
`resolvePreset`'s `mergeDefined`, not a surface: precedence is the resolver's job, and a union
applied by one of three shells is a rule the other two disagree with.

**What is missing is a live seam.** `create-session.ts` turns both lists into permission PATTERNS and
merges them into the enforcer's allow/deny sets **at construction**. `PermissionEnforcer` exposes only
an additive `sessionAllowedTools` set — the "always allow" prompt path — so there is no way to REPLACE
the configured rules on a running session.

Wiring the startup half alone would have been worse than leaving both: it CREATES the divergence this
scan exists to measure, with startup applying a preset's tool lists and `/preset` silently not. The
implementation was written, measured against the scan, and reverted for that reason rather than
landed half-applied.

**What it needs:** live permission-rule re-application on `PermissionEnforcer` — a real capability
with its own consequences (what happens to a tool mid-call, whether a denial can be added to a session
that already allowed it), and therefore its own item.

## The shape the remaining groups actually have

Checked after C, so the next reader does not discover it one group at a time:

| group           | live seam                                            | startup seam                    | verdict                 |
| --------------- | ---------------------------------------------------- | ------------------------------- | ----------------------- |
| C — tools       | **absent** (patterns fixed at construction)          | present                         | blocked on a capability |
| D — prompts     | present (`applyPersona` rebuilds the system message) | present                         | feasible                |
| E — model group | present (`applyModelOptions` already applies both)   | absent (session `defaultModel`) | feasible                |
| F — `language`  | present, once it is a persona section                | present                         | feasible                |

Groups B and C are the two that need a capability. D, E and F are wiring on seams that already exist.
