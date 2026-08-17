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
in one PR is a pattern, not bad luck. A warning-COUNT ratchet — frozen at today's 1927, may fall,
never rise — is the neutral mechanism that would have caught all eight, and it is filed as HARNESS-070
rather than added here, because this change is already carrying one new scan.

## Implementation — stage 2 of 3

The item's Test Plan opens with a **required red-first regression**: _"assert that every field of
`IResolvedPresetOptions` reaches the constructed session — i.e. make the type's own claim
mechanical."_ That is stage 2's deliverable, and it now exists as
`scripts/harness/scan-preset-projection.mjs`. It went red on the current tree with **10 findings**
before any exemption was written, which is the demonstration the plan asks for.

### What it measures, and the two things it does NOT

A resolved preset reaches a session through exactly two DECLARED shapes, and both are hand-written
subsets of the 19-field source with nothing tying them to it: `IPresetApplicationOptions` (10 fields,
the live `/preset` path) and `IPresetSurfaceOptions` (7 members, 6 of them preset fields — `activePresetId`
is the preset's id, not one of its options; the startup path). So the scan asks
two questions no reader can answer by inspection — is every source field declared in some projection,
and do the two surfaces agree.

Two corrections were forced by measuring rather than reasoning, and both are recorded because each
would have made the floor lie:

1. **A `Pick` of the source is a projection.** The first run reported the command-module group as a
   startup/live divergence. It is not: `robota-plumbing.ts` projects it through
   `Pick<IResolvedPresetOptions, 'enabledCommandModules' | 'disabledCommandModules'>`, which is the
   _better_ form — it is derived from the source, so renaming a field stops compiling. Calling a real
   projection a defect is how a floor gets allowlisted into silence.
2. **"Undeclared" is not "dropped".** The first messages said an undeclared field was "resolved,
   validated, and then discarded". That is false for `model`: `cli.ts:262` computes
   `resolvedPreset.model ?? providerSettings.model` and threads it to all three construction sites, so
   the value does reach the session — it is HAND-MAPPED rather than declared, which is this item's
   cause rather than its exception. Answering "is this field read anywhere" instead would need the
   type checker, because the value arrives in `cli.ts` as `preset.options` through an interface
   member. The rule was narrowed to what it can decide instead of left claiming more than it knows.

### The measurement

Ten findings, all real: **6 undeclared** (`systemPrompt`, `appendSystemPrompt`, `language`,
`defaultTrustLevel`, `allowedTools`, `deniedTools`) and **4 surface divergences** (`model`,
`temperature`, `maxOutputTokens`, `agentName`).

`agentName` is the one nobody had named, and it runs the OPPOSITE way to `effort`: startup declares it
and the live path does not, so starting with a preset sets the agent name while switching to the same
preset mid-session leaves the old one.

`autonomy` and `defaultPermissionMode` are **not** findings — both are derivation inputs that
`resolvePreset` promotes into `permissionMode` (`resolve-preset.ts:238-242`, verified at those lines,
not taken from the docblock), so a second projection would be a second answer to one question.

### What stage 2 does NOT close

Every one of the ten needs a decision with user-visible consequences that this scan cannot make and
this task file does not answer — the merge order for prompt text, where the `?? providerSettings.model`
fallback lives, whether a preset tool allowlist composes or replaces, whether `/preset` renames the
agent mid-session. Guessing at those inside a change whose subject is "nothing checks this" would be
the same defect one level up.

They are therefore recorded as **named, expiring exemptions** in `presetProjection.pendingProjection`,
one entry per field with its own reason and what would resolve it — not an opaque count. A stale entry
is reported as `preset-exemption-unused`, and emptying the list turns the floor red with all ten, which
was verified. The decisions are filed as [#1820](https://github.com/woojubb/robota/issues/1820).

Also measured and filed there: `buildAppendSystemPrompt` has exactly ONE caller
(`print-mode.ts:91`), so `--task-file`, `--json-schema` and `--append-system-prompt` are silently
ignored in interactive TUI and serve mode — the red-first CLI-flag case the Test Plan names.

The `IResolvedPresetOptions` doc comment still claims every field maps to an existing seam. It is
false for five of them and is deliberately left in place, on the same reasoning stage 1 recorded:
changing the words without changing the fact is the defect, not the fix.

### Review round 1 — five findings, two of them MUST, all applied

An independent review attacked the scan rather than the fields, which is where the risk was. What it
found, and why each mattered:

- **Heritage was invisible in BOTH directions.** `declaredFields` read only `node.members`, so moving
  two brand-new fully-unprojected fields onto a base interface the SOURCE extends left the floor
  **green with nothing reported**. And because `pickedFields` matched only a type reference, rewriting
  the startup surface as `extends Pick<IResolvedPresetOptions, …>` — the exact derived-from-source
  form this scan's own header calls "the BETTER form" — produced **five false divergences**. A floor
  that blocks the refactor it exists to encourage gets removed, not obeyed. Both are fixed: heritage
  is followed, and a name it cannot follow is reported rather than read as a narrower type.

- **The burn-down did not expire when the work was DONE.** Entries were keyed on the field name
  alone, so an exemption lapsed only if the field was DELETED — never when it was resolved. All four
  state changes on a pending field printed green. That made it, as the review put it, a baseline with
  extra words, and stage 1's sibling scan already had the missing half. Each entry now records the
  surfaces it was measured on (`declaredOn`) and a live state differing in EITHER direction is
  reported: gaining a declaration means the exemption is earned out, losing one means the exemption
  was hiding a regression.

- **`pendingProjection` had zero test coverage** while carrying all ten live findings, and the first
  commit message claimed "18 unit cases assert each rule in both directions" — untrue of the one rule
  standing between this floor and red. Now covered in both directions, plus scope (an exemption
  covers the field it names and nothing else).

- **A comment asserted a report that did not exist.** It said a `Pick` whose keys cannot be read "is
  REPORTED by the caller"; nothing reported it, so unreadable and empty printed the same. That is the
  same defect class this whole floor is about, inside its own docblock. The report now exists.

- **`Omit` and aliased imports were unrecognised**, so both produced false findings; and the header
  said "20-field source" where the source declares **19**. The count was wrong in three places and is
  corrected from the mechanism rather than re-copied.

One further defect surfaced from the fix itself, caught by a new unit case rather than by reading:
the cheap file-reject tested only for `Pick<`, so every `Omit<` projection was skipped before it was
ever parsed — the filter silently narrowed the scan to half the forms it claimed to support.

### Review round 2 — two more, both in the resolution layer

The round-1 fixes were verified by mutation rather than by reading, and two new defects surfaced,
both of the same shape as round 1's:

- **Name resolution was scope-blind.** Every `interface` at any nesting depth was collected, keyed
  only by name, so the walk read a WIDER type than the compiler — and wider MASKS findings, which is
  the direction that prints as progress. A nested `interface IStartup { b }` inside a function body
  made `b` count as declared by the configured surface; combined with an external `extends`, the same
  nested declaration also CANCELLED the fail-closed report that should have fired, turning a signal
  into a silent pass with the wrong type. Only top-level declarations are collected now: a nested or
  namespaced one is a different scope, and a namespaced surface reports "not declared" rather than
  being guessed at.

- **Round 1's MUST recurred one level in.** The alias map added in round 1 lived only in
  `pickedFields`, so the heritage walk called `pickFromType` without it and a surface written as
  `extends Pick<AliasedSource, …>` produced a FALSE unresolved report — the recommended derived form
  plus an aliased import, still red. The collector is extracted and shared, so the two readers cannot
  drift apart again.

Three further gaps, each closed: an exemption recorded truthfully for a field with NO defect left was
permanent and silent (gaming the burn-down by telling the truth), so "declared on every surface" now
expires too; a one-for-one SWAP between surfaces was reported as a loss because the direction was
chosen by list LENGTH rather than by set difference, when a move is precisely the divergence shape
this floor exists to catch; and `extends Partial<ISource>` was reported as "a base interface declared
in another file", sending the reader to look for a file that declares `Partial`.

The `unresolved` diagnostic was returned as a non-enumerable property on the field array. Review
measured it surviving `.sort()` but vanishing silently through `.filter()`, `.map()` and spread — so
losing it took one ordinary refactor, and it failed in the direction this floor's own thesis names.
It is a record now; losing it requires deleting code.

### Review round 3 — one live defect, and one wrapper too narrow

- **A comparison the scan could not make was answered anyway.** The pending-state rules compared the
  live projection against the surfaces successfully READ rather than the surfaces CONFIGURED.
  Measured on the real tree: renaming one surface produced the correct
  `preset-projection-surface-missing` PLUS four false findings — three instructing the reader to
  delete live exemptions for fields still one-sidedly declared, and one claiming a field had lost a
  declaration nothing had touched. The run was red either way, so this was never a fail-open; it was
  a message asserting a conclusion the scan had, one finding earlier, declared it could not reach.
  Those rules are now SKIPPED when any surface is unreadable, and the skip says so
  (`preset-pending-state-unknowable`). The same mutation now yields exactly two findings and zero
  false instructions.

- **Identity-preserving wrappers were treated as unresolvable.** `Readonly`, `Required` and `Partial`
  preserve the key set exactly, so `extends Readonly<IResolvedPresetOptions>` is a fully correct
  derived surface — and it was maximally red. That is round 1's MUST one wrapper over: a floor
  blocking the refactor it exists to encourage. They resolve to the source's own field list now, and
  a wrapper still NOT modelled continues to fail closed.

Two wording defects closed with them: a namespaced surface was reported as "declares no interface
named X", which is false — it is declared, just not at module scope — and `declaredFields`' docblock
had been stranded above the helper inserted in round 2, still stating a contract the function no
longer had.

The two readers deliberately disagree about scope, and that is now stated in the header rather than
left to be discovered: `declaredFields` collects module-scope declarations only, because a nested
`interface` is a scope TypeScript does not merge; `pickedFields` walks recursively, because a `Pick`
written inside a function body is a real projection of real code. One asks which declaration exists,
the other which fields something consumes.

**A second wrong expectation of my own, recorded for the same reason as the first.** Rewriting the
real startup surface as `extends Readonly<IResolvedPresetOptions>` is RED with 11 findings, and I had
predicted green. The scan is right: that wrapper genuinely widens the startup projection from 6
preset fields to all 19, which changes nine recorded states and creates two real divergences. Zero of
the eleven are `heritage-unresolved`, which is what proves the resolution itself works. The
fixture-level test is the correct proof of the mechanism; the real-tree probe measures a different
thing, and conflating them is how a correct scan gets "fixed".

### Falsification

The scan was mutated against the real tree before being trusted, because a floor that cannot fail is
worse than none — this repo has shipped two of those (`questionToken`, `.default`), both caught this
way rather than by reading. Removing the real `Pick` returns the two command-module findings; adding
`temperature` to the startup surface drops the count by one; renaming the source interface fails
closed with `preset-projection-source-missing` rather than passing. 18 unit cases assert each rule in
both directions.

### Remaining — stage 3

Unchanged: `guardrails` and `retrievalAdapter`, both advertised capabilities (SELFHOST-005,
SELFHOST-003) that no surface can turn on, plus the two unbridged `guardrails` shapes.
