---
title: 'ARCH-005: external product composition — publishable assembleProduct + capability-pack + product-profile'
status: todo
created: 2026-07-25
priority: high
urgency: soon
area: packages/(new agent-product, agent-capability-pack), packages/agent-preset, packages/agent-cli
depends_on: []
---

# ARCH-005: external product composition layer

> **Research-first / owner-critical placement.** Goes through the spec gate
> (`.agents/spec-docs/draft/ARCH-005-*.md` → GATE-WRITE → independent GATE-APPROVAL by
> architecture-auditor + proposal-reviewer) before any code, like REMOTE-001/GUI-001. Owner-approved
> direction 2026-07-25.

> **GATE-APPROVAL passed 2026-07-25 (REVISE → folded → approved); spec in `todo/`.** Both independent
> reviewers (`proposal-reviewer` + `architecture-auditor`) endorsed the direction and returned REVISE with a
> convergent set of contract/justification refinements (R1–R8); all were folded and the spec moved to
> [`.agents/spec-docs/todo/ARCH-005-external-product-composition.md`](../spec-docs/todo/ARCH-005-external-product-composition.md)
> with `status: approved` — `type: INFRA` (ARCH is not an accepted SDLC frontmatter type; the ARCH-005 ID
> keeps its namespace). Deliverables 2 (`agent-capability-pack`) and 3 (`agent-preset` exposure) were
> endorsed as correct; deliverable 1 (`agent-product`) is a defensible direction with the folded refinements.
> The reconciliation with the "no shared product factory" rule (`project-structure.md` L129) now rests on a
> mechanically-enforced **pure-fold property** (3 P0 guards), not "profile-driven" alone; the coupled L129
> amendment lands **with P0** as a flagged governance change. See the spec's `[GATE-APPROVAL]` Evidence Log.
>
> **Spec drafted (GATE-WRITE, 2026-07-25).** Draft spec authored (now in `todo/`) —
> awaited GATE-APPROVAL, now passed (above).

## Problem / Goal

A third party must be able to, **from a separate repo**, (A) build a specific product on our published
`agent-framework`, (B) author their OWN preset in code and layer it to make a distinct product, and
(C) consume OUR presets while packaging a product in a consumer style. Today the contract + opinion
layers are ALL published (agent-core/tools/framework/preset/command/provider-defaults) and
`IPreset` + `registerExternalPresets` already exist — but the **product-assembly kernel is NOT a
published library**: it is hand-wired inside `packages/agent-cli/src/cli.ts` (502 lines: providerDefinitions

- commandModules + transport registry + background runners + preset merge + TUI adapter). So an external
  repo building "their own product" must reimplement agent-cli's composition root or depend on the whole
  CLI product. That is the single linchpin gap.

Secondary gaps: presets are SUBTRACTIVE (allow/deny over a superset agent-cli hardcodes), not
compositional — an external "assistant" product cannot BRING its own tool/command/subagent set; and there
is no "product identity/manifest" unit tying branding + packs + preset + provider-defaults together.

## Proposed direction (to be validated at the gate)

Three published deliverables; **framework/core unchanged (stays neutral)**:

1. **`@robota-sdk/agent-product` (new, published)** — `assembleProduct(profile) → runtime`. Extract the
   agent-cli composition root into a pure library; agent-cli becomes a thin caller. (Mode A gateway.)
2. **`@robota-sdk/agent-capability-pack` (new, published)** — `ICapabilityPack` contract + registry
   merger; tool/command/subagent bundles as the additive composition unit. (Mode C additive axis.)
3. **`agent-preset` (existing, published)** — already provides `IPreset` + `registerExternalPresets`
   for Modes B/C; expose/document, no contract change needed.

Placement mirrors agent-preset's rule (depends on framework option types only; no class/IO in contract
packages). API stability is the product surface: register the new packages in `check-spec-public-surface`

- spec-surface-baseline + semver + api-boundary rule so breaking changes are gated for external consumers.

Responsibility split (spec invariant): preset = behavior/persona; pack = capability (tools/commands/agents);
profile = product assembly (branding + packs + preset + provider-defaults).

Staged, no big-bang: **P0** extract composition kernel → `agent-product` (behavior byte-identical pure
refactor); **P1** `assembleProduct` + re-express `robota` as a profile; **P2** `ICapabilityPack` +
first non-coding pack when a real second product exists.

## Deferred (owner decision, NOT part of this architecture)

**Licensing posture for external product-builders is DEFERRED per owner (2026-07-25): architecture first,
license later.** The spec is license-AGNOSTIC — dual-license AGPL+Commercial (no CLA) is noted only as a
downstream business decision that governs WHO may consume under WHAT terms; it does not shape the
composition contracts. Do not bake a license posture into the design.

## Prior art to cover at GATE-WRITE

Framework-+-preset-+-plugin-pack productization models: ESLint shareable-config + plugin, Docusaurus
presets, Backstage plugins, VS Code extension host, Vercel AI SDK, Claude Agent SDK, LangChain/LlamaIndex
package split. (Product docs only.)

## Test Plan (spec will detail)

P0 is a pure refactor — `robota` behavior byte-identical (CLI golden + full agent-cli/tui suites). New
public surfaces get red-first contract tests + spec-public-surface baseline entries. An external-consumer
smoke (a throwaway out-of-monorepo package importing the published tarballs and calling `assembleProduct`)
proves Modes A/B/C actually work from outside — the agent-run evidence for the done-gate.
