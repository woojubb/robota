---
title: 'ARCH-006: make the framework default tool set injectable so the pack TOOL axis is additive everywhere'
status: todo
created: 2026-07-25
priority: medium
urgency: soon
area: packages/agent-framework, packages/agent-product, packages/pack-coding
depends_on: [ARCH-005]
---

# ARCH-006: the capability-pack TOOL axis is only half-additive

## Problem

ARCH-005 gave `ICapabilityPack` three additive axes — **command modules**, **tools**, and **subagents**.
Two of them are additive on every path. The tool axis is not, and the ARCH-005 S3 external-consumer proof
measured exactly where it stops.

`agent-framework`'s `createSession` assembles its tool list unconditionally
(`packages/agent-framework/src/assembly/create-session.ts`):

```ts
const baseDefaultTools = createDefaultTools({ … });
const assembledTools = [
  ...defaultTools,
  ...(options.additionalTools ?? []),
  ...(options.includeGoalTool ? [createGoalStatusTool()] : []),
];
```

There is no dedupe and no suppression hook. Consequences, all confirmed by the S3 proof
(`scripts/external-proof/`, Mode C section C5):

- A pack contributing a **NEW** tool IS additive — it reaches the runtime through
  `assembleProduct`'s `buildRuntimeOptions` overlay (`additionalTools`). Proven.
- A pack contributing a tool the framework **already ships** would be **DUPLICATED**. `pack-coding`'s ten
  tools are name-identical to `createDefaultTools()` by design (its test pins them), so overlaying it onto
  a standard session would list every one of them twice.
- **No pack can remove or replace a framework default.** There is no subtractive or replacement axis at
  the framework tool seam at all.

That is why `robota`'s own surfaces still take their tools from `createDefaultTools()` rather than from
`pack-coding`, even though `pack-coding` IS load-bearing for the command-module axis (`/shell` and
`/editor` genuinely come from the pack). The tool axis is declared on the published contract but is not on
par with the other two.

Note the adjacent seam that already exists and should be reconciled, not duplicated: NEUT-003 added a
`builtInAgents` option that **REPLACES** the built-in subagent set, while ARCH-005's `agentDefinitions`
**PREPENDS INTO** it (documented in `agent-framework/docs/SPEC.md`). The tool axis needs the same
question answered explicitly — replace, prepend, or both — before an option is added.

## Proposed direction

Make the framework's default tool set injectable/suppressible at the `createSession` seam, so a product
profile decides its tool surface the same way it already decides its command-module and subagent surface.
Candidate shapes, to be weighed at the spec gate:

1. **`defaultTools?: readonly IToolWithEventService[]`** — replaces `createDefaultTools()` outright
   (mirrors NEUT-003's `builtInAgents`). Simple, but every consumer that wants "defaults plus one" must
   re-import and re-spread `createDefaultTools()`.
2. **Dedupe `assembledTools` by tool name with a stated precedence** (`additionalTools` wins over a default
   of the same name). Makes `pack-coding` overlayable with no option at all, and gives packs a _replace_
   semantic for free — but it changes existing behaviour for any caller that today relies on duplicates.
3. **Both:** an explicit injection option plus name-dedupe with a documented precedence.

Whichever is chosen, `robota` should then take its tools FROM `pack-coding` (closing the last "declared but
not load-bearing" axis) and the ARCH-005 S3 proof should be tightened to assert the stronger property.

## Neutrality constraint

This is a framework **neutrality** change, not a product change: the framework must not learn about any
product's preferred tool set. The composition-neutrality guards over `agent-product` stay in force, and
`agent-framework` keeps shipping `createDefaultTools()` as the default a profile may accept or override.

## Test Plan

- Red-first: a session assembled with a pack whose tools duplicate the framework defaults currently lists
  each tool twice — assert the duplicate FIRST, then make it fail after the change.
- `robota` behaviour held invariant: the CLI golden output + the full `agent-cli` / `agent-transport-tui`
  suites, plus the `robota-assembly-equivalence` test, stay green with `robota` sourcing tools from
  `pack-coding` instead of the framework default.
- The ARCH-005 external proof (`pnpm proof:external`) upgraded from "a NEW pack tool is additive" to
  "a pack fully owns the product's tool surface", with the C5 limitation notes removed.
