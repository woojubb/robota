---
title: 'ARCH-013: the (preset, CLI args) → session options projection chain has no owner — eleven assembly seams are unreachable and nine resolved preset fields are computed and discarded'
status: in-progress
created: 2026-08-02
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-preset, packages/agent-product, packages/agent-cli, packages/agent-transport-tui
depends_on: []
---

# ARCH-013: resolved intent is mapped to session options by hand at four sites and checked at none

## Problem

Three shipped "capabilities" — guardrails, retrieval and effort — **cannot fire in any shipped
surface**, and user-visible CLI flags are parsed, validated, and then dropped. All of it is silent.
This blocks the capability work that believes it landed.

The mapping from resolved intent to session options is hand-written at four sites and mechanically
checked at none, so a field added anywhere in the chain is silently dropped everywhere it was not
remembered.

## Evidence

Observed independently by **L2 (assembly, the `ICreateSessionOptions` hop)** and **L4 (product, the
`IResolvedPresetOptions` hop)** — two adjacent hops of one chain, each report naming the _other's_
layer as contributing.

- L2 F4 — `runtime-host.ts:4-6` declares `buildRuntimeSession` the _single_ session-construction seam
  and `assemble-product.ts:177` delegates to it; the option surface is mapped **by hand** in
  `interactive/interactive-session-init.ts`. Eleven keys of `ICreateSessionOptions`
  (`assembly/create-session-types.ts`) are never set on that path: `sessionStore`,
  `promptForApproval`, `onCompact`, `compactInstructions`, `toolDescriptions`, `providerFactory`,
  `sessionFactory`, `additionalHookExecutors`, `guardrails`, `effort`, `retrievalAdapter`. Three are
  advertised capabilities: **`guardrails`** (SELFHOST-005, read only at `create-session.ts:147-161`),
  **`retrievalAdapter`** (SELFHOST-003, gates `CodebaseRetrieval` at `assemble-session-tools.ts:68` /
  `create-tools.ts:72-74`), **`effort`** (documented at `create-session-types.ts:172-177` as
  "Resolved from a preset's `effort` (PRESET-008)", applied at `create-session.ts:270`, carried by no
  field — so startup drops it while the in-session `/preset` switch applies it,
  `command-api/preset/preset-application.ts:91-95`).
- L4 F2 — `packages/agent-preset/src/preset-types.ts:32-79` defines `IResolvedPresetOptions` with 20
  fields and claims _"Every field maps to an existing agent-framework session/assembly seam"_.
  `agent-product/src/assemble-product.ts:143-150` overlays exactly **one**
  (`defaultPermissionMode`). The shell hand-writes the rest **four times**:
  `agent-cli/src/modes/print-mode.ts:105-145`, `modes/serve-mode.ts:94-126`, `cli.ts:449-501`,
  `agent-transport-tui/src/tui-session-options.ts:17-56`, with `render.tsx:102-143` a fifth reshaping
  hop and the same preset literal rebuilt three times inside `cli.ts` alone (`:374-387`, `:422-433`,
  `:492-500`). Nine resolved fields reach no session: `systemPrompt`, `appendSystemPrompt`,
  `language`, `effort`, `temperature`, `maxOutputTokens`, `defaultTrustLevel`, `allowedTools`,
  `deniedTools`. `--system-prompt`, `--append-system-prompt`, `--task-file` and `--json-schema` are
  dropped in interactive TUI mode while `cli-args.ts:124` advertises `robota --task-file task.md`.
- L2 F16 — `interactive-session-options.ts:42-158` vs `:187-275`: `IInitOptions` hand-duplicates ~40
  fields of `IInteractiveSessionStandardOptions`; L2 verified all 47 keys are currently referenced, so
  this is the same root with no live drop _today_.

The synthesis re-verified, read-only: `guardrails` and `retrievalAdapter` have no production setter —
every non-test hit is a declaration or a consumption site. `resolvedPreset.<field>` in `agent-cli/src`
resolves to exactly the six fields L4 names (`agentName`, `enableParallelSubagents`, `model`,
`permissionMode`, `persona`, `selfVerification`), and `temperature`/`maxOutputTokens` appear nowhere
in `agent-cli/src`.

**One qualification the synthesis records against its own source (correction 7):** L2 says "a
repo-wide grep finds no production caller anywhere that sets `guardrails`". That is true for the
session option (`ICreateSessionOptions.guardrails: Record<string, TGuardrail>`), which the synthesis
verified. But there is a _different_ `guardrails` field in the config schema —
`packages/agent-framework/src/config/config-types.ts:82`,
`guardrails: z.array(z.string()).optional()` — a string array, not a guardrail map. L2 did not
mention it. The synthesis judges that it **strengthens** the finding rather than weakening it: there
are now _two_ declared guardrail surfaces, the two shapes cannot satisfy each other, no code bridges
them, and neither reaches the executor.

The cause in one sentence, from the synthesis: _the mapping from resolved intent to session options
is hand-written at four sites and mechanically checked at none, so a field added anywhere in the
chain is silently dropped everywhere it was not remembered._

## Why this is foundational (or not)

**FOUNDATIONAL — both reports agree**, and each names the other's layer as contributing. This is one
chain with two broken hops, not two independent defects; fixing either hop alone leaves the field
dropped at the other.

Severity HIGH; the synthesis notes it _blocks the capability work that thinks it landed_.

## Direction

The invariant the synthesis states for this class (theme T2): _a declared seam must be reachable from
the construction path the product actually uses, and a capability that cannot fire must not be
recorded as delivered._

What the synthesis establishes about the shape of a fix:

- A **single owner** for the projection. `runtime-host.ts:4-6` already declares `buildRuntimeSession`
  the single session-construction seam and `assemble-product.ts:177` already delegates to it — but the
  option surface is then mapped by hand in `interactive-session-init.ts`, and the shell re-does it
  four more times. The declared single seam exists; the projection into it does not run through one
  place.
- A **mechanical check**, because the defect is precisely that no check exists. `preset-types.ts:32-79`
  _claims_ "every field maps to an existing agent-framework session/assembly seam"; that claim is
  currently unverified and false for nine of twenty fields.

The synthesis does not choose between "make the eleven seams reachable" and "delete the ones that are
not capabilities" — but it does mark three of the eleven (`guardrails`, `retrievalAdapter`, `effort`)
as **advertised capabilities**, which constrains the answer for those three.

Risks named by the synthesis:

- The `effort` field is already **inconsistent within one session**: startup drops it while the
  in-session `/preset` switch applies it (`preset-application.ts:91-95`), so turning it on at startup
  is a behaviour change users will observe.
- `IInitOptions` hand-duplicates ~40 fields with **no live drop today** (L2 F16) — it is the same root
  with a currently-correct copy, so it must be included in the fix even though nothing is broken there
  yet.

## Test Plan

- **Required red-first regression:** assert that every field of `IResolvedPresetOptions`
  (`preset-types.ts:32-79`) reaches the constructed session — i.e. make the type's own claim
  mechanical. Against current code this must FAIL for the nine fields L4 names (`systemPrompt`,
  `appendSystemPrompt`, `language`, `effort`, `temperature`, `maxOutputTokens`, `defaultTrustLevel`,
  `allowedTools`, `deniedTools`).
- Red-first: `--system-prompt`, `--append-system-prompt`, `--task-file` and `--json-schema` must take
  effect in interactive TUI mode (`cli-args.ts:124` advertises `--task-file`). Today they are dropped.
- Red-first: a session constructed with `guardrails` and with a `retrievalAdapter` must actually gate
  `CodebaseRetrieval` (`assemble-session-tools.ts:68`, `create-tools.ts:72-74`) and run guardrails
  (`create-session.ts:147-161`).
- Red-first: `effort` resolved from a preset at **startup** must produce the same applied state as
  switching to that preset in-session (`preset-application.ts:91-95`).
- A scan that fails when a key exists on `ICreateSessionOptions` / `IResolvedPresetOptions` with no
  production setter, so the chain cannot silently regrow a dropped field.
- Reconcile the two `guardrails` shapes (`create-session-types.ts` map vs `config-types.ts:82` string
  array) or fail the build while both exist unbridged.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies.** These are user-visible CLI flags and advertised capabilities.

- **Prerequisites:** built `robota` CLI; a provider key. A `task.md` file and a preset that sets
  `systemPrompt`, `effort` and `temperature` are needed; both are trivially authored and **will be
  created by this work**. No server or fixture project is required.
- **Steps:**
  1. Create `task.md` containing a distinctive instruction.
  2. Run the CLI in **interactive TUI mode** with `--task-file task.md` (the form `cli-args.ts:124`
     advertises) and with `--system-prompt "always answer in exactly one word"`.
  3. Observe the first turn.
  4. Start the CLI with a preset that sets `effort`, and compare the applied state against switching
     to the same preset in-session with `/preset`.
- **Expected observable result (after the fix):** in step 3 the task file's instruction is loaded and
  the system prompt is honoured (answers are one word). In step 4 the startup state and the
  `/preset`-switched state are identical.
- **Expected observable result (before the fix, for contrast):** in step 3 both flags are silently
  ignored in TUI mode; in step 4 the `/preset` switch applies `effort` and startup does not.
- **Cleanup:** delete `task.md` and the scratch preset.
- **Evidence (fill in after implementation):** TUI transcript for steps 2–3, and the two applied-state
  readouts for step 4.

## Implementation — stage 1 of 3

This item is three separable pieces of work and this is the first. It is NOT closed by this change.

### Verified before anything was changed

Every premise held, and an independent read of the code produced three corrections to the audit,
which are recorded because a plan built on a wrong map is worse than no plan:

- `cli.ts` never reads `resolvedPreset.permissionMode`. What it forwards comes back out of the kernel
  overlay (ARCH-007), so the hand-written expression the audit describes was already removed.
- Sites 1, 2, 4, 5 and 7 do not consume `IResolvedPresetOptions` at all — each declares its own
  preset-SHAPED interface. That is the duplication, stated more precisely than "mapped by hand".
- `defaultTrustLevel` is not merely unprojected: it is validated and then read by nothing. Fully dead.

And one addition: the audit lists eleven unreachable `ICreateSessionOptions` keys. There are
**twelve** — `autoCompactThreshold` is the one nobody named. It was found by the scan below rather
than by reading, which is the point of having it.

### The mechanism

`scripts/harness/scan-option-reachability.mjs` fails when a declared option is set by no production
code. For each configured interface it takes the declared property names and looks for assignments on
object literals that either reach a configured constructor (`createSession`) or are returned by a
function declaring that return type.

Two things about its construction are worth recording, because both were errors caught by measuring:

1. **The first version matched property names anywhere in the tree and found 1 of the 12.**
   `guardrails` also names a key of an unrelated zod schema and `retrievalAdapter` a key of the
   tool-assembly options, so both looked set. Scoping to the constructor is what makes the answer mean
   anything.
2. **The producer branch exists because this change broke its own scan.** Extracting the options
   literal into `buildCreateSessionOptions` — the fix below — made all 39 previously-assigned keys
   report as unreachable, because the literal was no longer a constructor argument. The scan fired
   rather than passing quietly, which is the behaviour it exists for.

A spread whose keys cannot be read (`...base`) is reported as OPAQUE rather than assumed empty or
assumed complete. The baseline is frozen at 11 keys, may shrink, and must never grow.

### The capability that now fires: `effort`

`TPresetEffort` is declared as `NonNullable<ICreateSessionOptions['effort']>` precisely to thread onto
that seam, and three of the four built-in presets set it — `neutral-executor` asks for `'medium'`
while the core defaults to `'high'`. At startup it reached nothing. The same preset chosen mid-session
with `/preset` DID apply it, so one session could hold two different answers for the same preset
depending on when it was chosen.

Wired end to end, at every surface rather than the one that was convenient: the session option
surface and `IInitOptions`, the framework projection, the TUI channel and its projection, the
renderer, the headless channel, and print/serve mode. Red-proved at the TUI and headless hops by
removing each hop and watching its case fail.

The types are derived FROM the seam (`ICreateSessionOptions['effort']`) at every hop rather than
re-declared beside it, since a parallel declaration is how two definitions drift apart again.

**One thing this change did wrong and then fixed:** the first attempt passed `effort` into print and
serve mode without adding it to their own preset-shaped types. It typechecked — a conditional spread
is not subject to excess-property checking — and the field was silently dropped. That is this item's
defect, committed while fixing it.

### Single owners, where the size ratchet asked for them

Three files grew past their frozen size. Rather than trimming comments, each grew because a projection
was inline, so each projection was extracted — which is what this item asks for anyway:

- `buildPresetSurfaceOptions` (`agent-cli/src/startup/preset-surface-options.ts`) — the preset fields
  every shell surface forwards, written out three times inside `cli.ts` and kept in step by memory.
- `buildCreateSessionOptions` (`agent-framework/src/interactive/create-session-projection.ts`) — the
  `IInitOptions → ICreateSessionOptions` hop, previously mixed in with config merging and path
  resolution inside a 332-line initializer.
- `ITuiInteractionChannelOptions` moved beside its projection (`tui-channel-options.ts`), out of a
  698-line implementation file.

All three files fell below their baselines and were re-frozen in this change.

### Remaining — stages 2 and 3

- **Stage 2: the resolved-preset side.** Nine fields still reach no session: `systemPrompt`,
  `appendSystemPrompt`, `language`, `temperature`, `maxOutputTokens`, `defaultTrustLevel`,
  `allowedTools`, `deniedTools`, plus `autonomy`/`defaultPermissionMode` which are derivation-only
  inputs. `--system-prompt`, `--append-system-prompt`, `--task-file` and `--json-schema` are still
  dropped in interactive TUI mode. This needs the OPPOSITE direction of scan — consumption
  reachability, not assignment — which is why it is not folded in here.
- **Stage 3: `guardrails` and `retrievalAdapter`.** Both remain in the frozen baseline; both are
  advertised capabilities (SELFHOST-005, SELFHOST-003) that no surface can turn on. The two
  `guardrails` shapes (`ICreateSessionOptions.guardrails` as a map vs `config-types.ts:82` as a string
  array) are still unbridged and must be reconciled as part of it.
- The `IResolvedPresetOptions` doc comment still claims "Every field maps to an existing
  agent-framework session/assembly seam". It is left in place deliberately until stage 2 makes it
  true or narrows it — changing the words without changing the fact is the defect, not the fix.

### Review round 2 (PR #1607)

One SHOULD, upheld, and it is the sharpest kind — a comment of mine recording a measurement that was
not the behaviour that fires.

The classification note beside `scan-option-reachability` in `MANDATORY_TREE_GUARDS` said "Measured
against a bare root: throws `<declaring file> does not exist`". The guard harness invokes every finder
as `finder(bare)` — ONE argument — and `findUnreachableOptions(root, configs)` had no default, so what
actually threw was `TypeError: Cannot read properties of undefined (reading 'length')`. The floor was
still satisfied, because it only asks whether the finder threw. My measurement had been taken with two
arguments.

Fixed at the mechanism rather than in the prose: `configs` now defaults to the live configuration, so
the call the harness makes exercises the real fail-closed path, and a case pins that
`findUnreachableOptions(bare)` — exactly one argument — throws `does not exist`. The note now says
which call it measured.

This is the second instance this session of citing a measurement taken against a different setup than
the one being claimed (the first was two `prettier --check` runs over two different trees). Recorded
in `.agents/memory/claimed-without-reading-back.md`, which this PR also adds.

Also removed eleven type-only imports left dead in `TuiInteractionChannel.ts` by the interface move —
an ESLint warning, not a break, but the point of the extraction was a file with one job.

### Review round 3 (PR #1607)

One SHOULD, upheld: a dead `NOOP_TERMINAL` import left in `interactive-session-init.ts` by the
projection extraction — in the same change whose commit message said it had removed exactly this kind
of leftover from another file. Fixing the named instance alone would have been the defect again, so
the whole class was swept: `FileSessionLogger` was dead for the same reason in that file, and six more
(`IAIProvider`, `IToolWithEventService`, `TPermissionMode`, `IInteractiveSession`,
`IInteractiveSessionStore`, `ITransportRegistryView`) were left dead in `TuiInteractionChannel.ts` by
the interface move — two more than review named. Verified by typecheck, not by the count: a first pass
of the detector mis-read `TActionResponse as TUserActionResponse` as dead when it has five live uses.

**No mechanism yet, and that is a gap.** `@typescript-eslint/no-unused-vars` is a WARNING and
`pnpm lint` runs without `--max-warnings`, so nothing objects to any of this. Three separate instances
in one PR is a pattern, not bad luck. A warning-COUNT ratchet — frozen at today's number, may fall,
never rise — is the neutral mechanism that would have caught all eight, and it is filed as HARNESS-070
rather than added here, because this change is already carrying one new scan.
