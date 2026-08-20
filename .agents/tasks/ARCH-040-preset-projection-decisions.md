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
- [ ] Group B — `agentName` on the live `/preset` path.
- [ ] Group C — `allowedTools` (replace) and `deniedTools` (compose), resolved together.
- [ ] Group D — `systemPrompt` (seed) and `appendSystemPrompt` (merge order).
- [ ] Group E — the model group: `model` declared, `temperature` and `maxOutputTokens` wired.
- [ ] Group F — `language` as a persona-section instruction.
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
