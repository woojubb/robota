---
title: 'ARCH-006: make the framework default tool set injectable so the pack TOOL axis is additive everywhere'
status: done
created: 2026-07-25
completed: 2026-07-25
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

## Progress — framework half DONE (2026-07-25); one hop remains

**DONE (landed with ARCH-007; see the ARCH-005 spec's `[ARCH-006 + ARCH-007]` evidence entry).** Proposed
direction **3 (both)** was taken:

- **`defaultTools`** on `ICreateSessionOptions` / `IInitOptions` / `IInteractiveSessionStandardOptions`
  REPLACES the `createDefaultTools()` tier; `[]` suppresses it entirely — the tool-axis mirror of NEUT-003's
  `builtInAgents`, reconciled with it explicitly in `packages/agent-framework/docs/SPEC.md`.
- **Name dedupe** over `defaultTools ⊕ additionalTools ⊕ goalTool`, **first occurrence wins** — the rule
  `AgentDefinitionLoader` already applies within the subagent built-in tier. Absent `defaultTools` and
  absent a duplicate name, every path is byte-identical.
- The edit-checkpoint wrap now covers the assembled set, so a pack-contributed `Write`/`Edit` is
  checkpointed.
- `pnpm proof:external` § C5 rewritten from "the tool axis's limitation" to "the tool axis at PARITY" —
  **68 assertions, exit 0** (was 65).

**PRECEDENCE — answered, and the answer is the opposite of the sketch above.** This item proposed
"`additionalTools` wins over a default of the same name". It must NOT: the framework default tier is
constructed WITH the session context, and `cwd` is what arms `agent-tools`' working-directory path guard.
Measured directly — `createDefaultTools({cwd}).Read('/etc/hostname')` → `Access denied: … is outside the
working directory`; `codingPack.tools`' `Read` on the same path → **reads the file**, because
`checkPathWithinCwd` is a no-op when `cwd` is `undefined` and a pack builds its tools at module load with no
options. Letting a name collision silently swap a context-free instance in for a context-bound one would
have shipped a silent security regression. Replacement stays fully expressible — through the EXPLICIT
`defaultTools` seam, never as a side effect of a collision (`mergeCapabilityPacks`' own rule, applied to
tools).

**REMAINING — `robota` does not yet SOURCE its tools from `pack-coding`.** The seam that would let it is
landed and proven (a profile passing `defaultTools: []` hands its packs the whole tool surface; removing a
pack then removes its tools — asserted in `agent-cli`'s `robota-runtime-seam.test.ts` and in the external
proof's C5). `robota` does not use it yet for exactly the reason above: `ICapabilityPack.tools` is a list of
PRE-CONSTRUCTED instances, so suppressing the framework tier today would hand robota `Read`/`Write`/`Edit`
with the path guard disarmed.

The fix is small and its shape is already anticipated by `pack-coding`'s own SPEC comment ("if a future
contribution carries per-product mutable state, export a `createCodingPack()` factory instead of widening
this constant"):

1. `@robota-sdk/pack-coding` exports `createCodingPack(options?: { cwd?: string; sandboxClient?: ISandboxClient })`
   that passes those options into the `agent-tools` factories it already calls. `codingPack` stays as the
   zero-context constant for consumers that do not need it.
2. `robota`'s profile builds its pack with the shell's `cwd` and passes `defaultTools: []` in the kernel's
   runtime-seam input, so the coding tools come from the pack. The equivalence bar is unchanged: the ten
   tool names, the CLI golden output, and the full `agent-cli` / `agent-transport-tui` suites.
3. `agent-transport` + `agent-transport-tui` each take the same one-line optional `additionalTools`
   pass-through the Decision-2 `agentDefinitions` seam already has, so the pack's tools reach the print and
   TUI channels (today the overlay's tools reach `--serve` only, which is behaviourally inert while the
   pack's tools are name-identical to the defaults).

None of the three files above was inside the ownership boundary of the change that landed the seam, which
is why this item stayed open rather than being marked done at that point.

## COMPLETE (2026-07-25) — all three steps landed

1. **`createCodingPack({ cwd, sandboxClient })`**, with `cwd` **required**. The module-level `codingPack`
   constant was **REMOVED**, not deprecated: its tools were exactly the hazard this item documented, and a
   "zero-option default" sitting beside the `defaultTools: []` seam would be a loaded gun. Pre-release
   package, two in-tree consumers, both migrated in the same change. The scoping property is asserted by
   EXECUTION — `Read`/`Write`/`Edit` each deny a path outside the supplied `cwd`, and two packs built with
   different roots do not share a scope.
2. **`robota`'s packs own its tool surface.** The shell builds the packs from its resolved `cwd` before
   command setup (the same instances feed the pack command-module names, the profile, and the overlay), and
   `buildRobotaRuntimeOptions` passes `ROBOTA_PACKS_OWN_TOOL_SURFACE` — an empty `defaultTools` — into the
   runtime seam. Removing the pack now removes robota's ten coding tools.
3. **`agent-transport` + `agent-transport-tui`** each took the optional `additionalTools`/`defaultTools`
   pass-through mirroring the `agentDefinitions` seam, so print, serve and TUI carry an identical surface.

**Mutation-proving found a real gate hole first.** Removing the suppression initially left the acceptance
test GREEN, because the shell helper defaulted `defaultTools` to `[]` on the way out and thereby collapsed
"suppressed" and "absent" into one value. The default was removed; the same mutation now fails 2
assertions, and dropping `cwd` from the pack fails 4 pack cases plus the agent-cli scoping case.

**Agent-run evidence.** The real binary answers `robota -p "Read the file /etc/hostname …"` with
`Access denied: "/etc/hostname" is outside the working directory` — the regression this item was written to
prevent, proven absent with the pack as the source. `pnpm proof:external`: 69 assertions, exit 0. 2207
tests green across the eight touched packages. ARCH-005 **TC-4** is met and the spec is `done`.
