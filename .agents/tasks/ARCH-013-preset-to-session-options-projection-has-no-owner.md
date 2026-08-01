---
title: 'ARCH-013: the (preset, CLI args) → session options projection chain has no owner — eleven assembly seams are unreachable and nine resolved preset fields are computed and discarded'
status: todo
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
