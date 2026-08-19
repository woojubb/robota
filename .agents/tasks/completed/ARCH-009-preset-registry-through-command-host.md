---
title: 'ARCH-009: thread the preset registry through the command-host context so `/preset` can drop the module global'
status: done
completed: 2026-08-20
created: 2026-07-25
priority: low
urgency: later
area: packages/agent-command, packages/agent-framework, packages/agent-cli
depends_on: [ARCH-008]
---

# ARCH-009: the module-global preset registry survives only because `/preset` cannot reach an instance one

## Problem

ARCH-008 took `robota`'s startup preset resolution off `agent-preset`'s module-global registry: the shell
builds a per-call instance registry (`createPresetRegistry`, R8), resolves over it, and hands it into the
product profile, which adopts it. The module-global registry is now used for exactly one thing —
**discovery inside a running session**:

- `packages/agent-command/src/preset/preset-command.ts` calls `listPresets()`, `getPreset(id)` and
  `resolvePreset(id)`;
- `packages/agent-command/src/preset/preset-command-module.ts` calls `listPresets()` for the command's
  argument source.

Those run inside the session with only an `ICommandHostContext`. There is no path from there to the
assembled product, so they cannot see the instance registry the shell resolved with. Hence
`loadExternalPresets()` still registers into the module global purely to keep `/preset` working.

The two cannot currently disagree — both are fed by the one `loadExternalPresets()` call, and an
anti-split test asserts identical resolution through both — but the process-wide mutable registry is
still there, which is what makes "two products in one process" (the R8 scenario) only half-true for an
embedded host, and it is a state-mutation seam nobody wants to be load-bearing.

## What

Thread an `IPresetRegistry` to the `/preset` command through the command-host context (the same shape the
other host-provided capabilities already use), have `agent-cli` supply the registry it resolved with, and
then delete the module-global registration from the startup path. `registerExternalPresets` /
`clearExternalPresets` / the module-global `resolvePreset` can either become test-only or be removed from
the public surface — decide explicitly and record it, as ARCH-008 did.

Not urgent: nothing is broken today. The value is retiring the last mutable process-global on the preset
axis so R8 holds for an embedded/multi-product host as well as for the CLI.

## Test Plan

Red-first: with the module-global registration removed, an external preset loaded by the shell must still
be listed by `/preset`, resolvable by `/preset <id>`, and applied to the live session — asserted through
the shipped command path, not a re-implementation. Then: two products assembled in one process must each
see only their own external presets from their own `/preset` surface (the property the module global makes
impossible today). `pnpm harness:verify-like-ci` green.

## What was decided, and what shipped

**The seam is the host-ADAPTER bag, not a new host-role member.** The first cut added
`getPresetRegistry()` to `ICommandHostPresetApplication` and an implementation on
`InteractiveSession`. It typechecked and it worked, and it was the wrong shape twice over:
`ICommandHostAdapters` already IS "capabilities the composition root supplies to commands"
(`/permission-mode` and `/plugin` reach theirs that way), and the role-member version put a stored
field, a constructor assignment and an accessor into a file the size ratchet had frozen. `/preset`
now reads `context.getCommandHostAdapters?.().presetRegistry`, which costs the framework one optional
adapter field and no session code at all. The mechanical floor is what surfaced it: `option-reachability`
reported `IInitOptions.presetRegistry` as declared-and-never-assigned, which was true — a capability
that cannot be turned on — and `file-size` refused the growth of two ratcheted files. Two guards
disagreeing with a design is a design worth re-reading.

**The module-global registry is REMOVED, not kept test-only.** `registerExternalPresets`,
`clearExternalPresets`, the mutable `externalPresets` array, and the process-wide
`resolvePreset`/`listPresets`/`getPreset` are gone from `packages/agent-preset`. What replaces them is
`partitionExternalPresets`, the same conflict policy applied to ONE list and reading nothing outside
it, shared by `createPresetRegistry` and the loader. `createPresetRegistry()` with no argument is the
built-ins, so the fallback `/preset` needs is a value someone constructs rather than process state.

That is the stronger of the two options the item allowed. Keeping the functions as test-only would
have left the mutable array alive with tests as its only justification, and a global that only tests
touch is still a global the next consumer can find.

**`loadExternalPresets` registers nothing.** It returns the presets it loaded on
`IExternalPresetLoadResult.presets`; the caller builds a registry over them and owns it. The old
`loaded` id list survives beside it, since the CLI reports loaded ids to the user. The shell then
hands that registry to `assembleProduct`, which merges it into the session's adapter bag — MERGED,
never substituted, so the shell's own adapters survive.

## Test Plan — result

- `packages/agent-command/src/preset/__tests__/host-supplied-preset-registry.test.ts`, 4 cases. The
  decisive one is two hosts in ONE process each listing only their own presets: the property a
  process-wide registry makes impossible, and therefore the one that proves the seam instead of
  exercising it. Red-proofed — cutting the adapter lookup turns 3 of 4 red (75%).
- The INFRA-032 case in `preset-command-module.test.ts` now reaches `/preset` with an external preset
  through the HOST instead of registering it process-wide, and lost the `afterEach` teardown that
  existed only because the list was shared.
- Two cases that asserted "nothing leaked into the module global" were rewritten rather than deleted:
  with no global to leak into they could no longer fail on the condition they named, so they now ask a
  registry constructed AFTERWARDS, which still can.
- One case was deleted with its reason recorded in the file it left: ARCH-008's dual-posture test
  ("the global says FROM-THE-GLOBAL, the shell says FROM-THE-SHELL") had no global half left. The
  surviving half — the VALUE comes from the shell's list — is asserted in its place.
- `pnpm harness:scan` 125 passed, 1 skipped. Full suite green.

## Stated limit

`buildPresetSubcommands` in `preset-command-module.ts` still lists the BUILT-INS for its static
tab-completion catalog, because it is built at module-construction time with no host context to read.
What ARCH-009 changed is what that limit costs: the hints used to come from a process-wide mutable
registry, so what one host saw depended on which other host had loaded presets first. They are now the
built-ins and nothing else — wrong the same way for everyone, and never someone else's. Closing it
needs the catalog built per host rather than per module, which is a change to how command modules are
constructed.
