---
title: 'STRUCT-010: agent-interface-tui documents an interaction pipeline with no producer and no renderer — retire or re-charter the package (user decision)'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-interface-tui, packages/agent-transport-tui, packages/agent-cli
depends_on: []
---

# STRUCT-010: agent-interface-tui is a published, documented shell

## Problem

`agent-interface-tui`'s entire documented protocol — command modules annotate `onMissingArgs`, the
TUI renders `TAnyTuiCommandInteraction` — has neither end in the codebase. The package is published,
its SPEC draws a live pipeline, two other documents describe the flow as current, and its only
"consumer" is a blind pass-through re-export. Under the Forward-Provisioned Surface Rule, removal is
a PRODUCT decision — so this task proposes the options rather than deleting anything.

## Evidence

- `packages/agent-interface-tui/docs/SPEC.md:8-9,27-31` — "defines the interaction protocol between
  command handlers … and TUI renderers"; diagram: `agent-transport-tui/useSideEffects` renders the
  interactions; `agent-command/*` descriptors "annotate onMissingArgs to trigger interaction".
- Reality: `rg onMissingArgs` outside the package → **zero hits** (no agent-command descriptor
  carries it); `agent-transport-tui/src/hooks/useSideEffects.ts:1-17` renders CMD-004
  `ui_intent`/`session_renamed` and imports nothing from agent-interface-tui; the former real
  renderers (`CommandPicker.tsx`/`CommandConfirm.tsx`, ARCH-003-p9) no longer exist.
- The sole consumer is `agent-transport-tui/src/command-interaction.ts:1-8` — a verbatim re-export of
  all six types with zero internal consumption, republished at `src/index.ts:8-14`: a pass-through
  re-export of another package's ownership, which `.agents/project-structure.md:232-233` bans.
- Contradicting live design: `agent-interface-transport/src/interaction-contracts.ts:38-40` claims
  `askUser` is "the sole 'ask the user' seam" — the two contract packages both claim the
  solicit-missing-input interaction; one is live (CMD-004 ask), the other is a shell.
- Stale cross-doc anchors: `packages/agent-cli/docs/SPEC.md:502-506` describes the phantom flow as
  current; `agent-interface-tui/src/command-interaction.ts:25-26` routes readers to runtime
  type-guards "in `@robota-sdk/agent-transport`" that exist nowhere (its own SPEC:45-47 says no
  guards are provided). `TOnMissingArgsAction`'s `'wizard'` member has no interface in the union.
- Published surface: `@robota-sdk/agent-interface-tui` is in the publish registry's Published table
  and `agent-framework` deliberately does not depend on it (project-structure.md:311 holds).

## Direction

User decision between:

- **(a) Retire.** Deprecate and remove the package (publish/semver gate applies), delete the
  pass-through re-export in agent-transport-tui, rewrite the agent-cli SPEC § Command Interactions
  and the interface-tui rows in project-structure.md/publish-registry around the CMD-004 reality
  (`ui_intent`, prompt events, unified ask). Rationale: the ask seam superseded the picker-on-missing-
  args design; keeping two contract owners for one interaction invites the next drift.
- **(b) Re-charter as forward-provisioned.** Keep the types, rewrite the SPEC to say explicitly:
  no wired producer/renderer today, superseded-by-CMD-004 for missing-args, retained for a future
  rich-TUI interaction protocol; delete the phantom pipeline diagram and the type-guard pointer;
  still delete the unconsumed pass-through re-export (the ban is about ownership, not consumption).

Either way the pass-through re-export goes, and the stale anchors (agent-cli SPEC, comment pointer)
are corrected.

## Test Plan

- (a): changeset + publish-registry update; `rg` proves zero imports remain; build/test green.
- (b): SPEC rewrite; `rg onMissingArgs` documented as intentionally zero; pass-through file deleted
  and `agent-transport-tui` build green.
- `pnpm harness:scan` green in both options.

## User Execution Test Scenarios

Not applicable — contract-package disposition with no runnable behavior change today (the pipeline
already has no producer and no renderer; nothing user-observable can change until a future feature
consumes the re-chartered contract).
