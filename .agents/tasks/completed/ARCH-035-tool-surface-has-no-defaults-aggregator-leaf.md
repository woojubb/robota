---
title: 'ARCH-035: the tool surface has no defaults-aggregator leaf, so it cannot be cut by a manifest edge'
status: done
completed: 2026-08-19
created: 2026-08-16
priority: high
urgency: soon
area: packages/agent-tool-defaults, packages/agent-framework, packages/pack-coding, packages/agent-subagent-runner
depends_on: []
issue: https://github.com/woojubb/robota/issues/1787
---

# ARCH-035: the tool surface has no defaults-aggregator leaf, so it cannot be cut by a manifest edge

## Problem

Found by `proposal-reviewer` while checking ARCH-021's structural-guarantee claim, and it is the
reason that claim had to be narrowed.

ARCH-021 deletes `@robota-sdk/agent-provider-defaults` from `agent-subagent-runner`'s manifest, which
makes reaching for the default **provider** registry a compile error — `createDefaultProviderDefinitions`
is owned only by that package.

The **tool** axis cannot be cut the same way. `createDefaultTools` is barrel-exported by
`agent-framework`, and `agent-subagent-runner` must keep `agent-framework` for `createSubagentSession`
/ `createSubagentLogger` / `getBuiltInAgent`. So after ARCH-021,
`import { createDefaultTools } from '@robota-sdk/agent-framework'` still compiles there — held by a
mechanical scan rather than by the type system.

That asymmetry matters because the tool axis is the one with the failure history: ARCH-010 (unconfined
child tools) and ARCH-006 (pack-owned tool surface) are both tool-surface findings at this seam.

Related, one layer over: `agent-framework`'s own `assembleSessionTools` falls back with
`defaultTools ?? createDefaultTools(...)` — the same "neutral library imports the default surface"
shape ARCH-021 condemns.

Candidate direction: an `agent-tool-defaults` leaf mirroring `agent-provider-defaults`. This implies a
package extraction and a change to `agent-framework`'s default tool tier — schedule it, do not absorb
it into another item.

## RE-SCOPED 2026-08-18 — the leaf IS the remedy, in the shape this repo already proved

Two passes were needed to get here, and the first was wrong. Both are recorded, because the wrong
turn is the useful part: it was decided on a premise nobody had measured.

### What the depth triage established (correct, and it stands)

The observation reproduces, but the cause sits one level under the site this item names:
**`agent-framework` owns, publishes and self-consumes the product's default tool policy.** Filed as
issue #1854.

1. `.agents/project-structure.md:366` classifies a defaults aggregator as a _composition leaf,
   "imported only at composition roots (entry-point-only)"_. `createDefaultTools` is one, and it sits
   inside a mid-layer library that also consumes it (`assemble-session-tools.ts:63`) and re-publishes
   it (`index.ts:407`).
2. The **barrel export — not the package boundary — is the sole compile-legal route** from
   `agent-subagent-runner` to any default tool set. `agent-framework`'s barrel re-exports no
   `agent-tools` factory, and none of the runner's other four dependencies depends on `agent-tools`.
   Extracting a leaf while the re-export stays therefore closes nothing — that is the evasion class
   `scan-subagent-runner-composition.mjs:106-112` already codes against.
3. There is exactly ONE production importer of `createDefaultTools`: the fallback itself. The
   non-production importers are FIVE, not the four an earlier draft counted —
   `pack-coding/src/__tests__/coding-pack.test.ts`, `create-tools.test.ts`,
   `robota-assembly-equivalence.test.ts`, `create-session-default-tools.test.ts` (two dynamic sites)
   and `scripts/external-proof/fixture/src/mode-c.ts`.
4. `pack-coding` does not import it — it rebuilds the list from `@robota-sdk/agent-tools`, and
   `robota` declines the framework tier with `defaultTools: []` (`robota-profile.ts:60`). ARCH-021's
   first TC-05 could not fail precisely because the two are pinned to each other by name.

### The first recommendation, and why it was rejected

The first pass proposed deleting the tier outright and letting `pack-coding` be the sole owner. A
`proposal-reviewer` returned REJECT, and re-measurement confirmed the rejection. Three claims behind
that recommendation were false:

- **"No caller constructs a session without `defaultTools` today."** False, and it was load-bearing.
  `IQueryOptions` (`query.ts:28`) and `IHeadlessSessionOptions` (`agent-runtime.ts:36-59`) declare
  only `additionalTools` — they have **no `defaultTools` seam at all**, so those two published
  surfaces cannot opt back in. `apps/agent-server`, `apps/starter-nextjs`, six `examples/*` workspace
  members, `agent-framework`'s own maintained examples, and — the strongest case, because it is
  in-package production code rather than an example — `src/evals/session-run-fn.ts:71`
  (`createSessionRunFn`, SELFHOST-011) all construct sessions in that state.
- **"No in-repo contract depends on it."** False. `README.md:100` states the built-in tools "are
  assembled for SDK sessions", and `docs/SPEC.md:2555` — a package SSOT — documents `defaultTools` as
  REPLACING the `createDefaultTools()` tier.
- **"Two owners of one list."** Inaccurate. `createDefaultTools` owns a SUPERSET: the adapter gating
  for `retrievalAdapter` → CodebaseRetrieval (SELFHOST-003) and `computerDriver` → Computer
  (SELFHOST-010), which `coding-pack.ts:57-60` deliberately excludes. Deleting it would leave
  `retrievalAdapter` declared, threaded and reaching nothing — worse than the state ARCH-013 stage 3
  was opened to fix.

The failure mode decides it: this is a **behavioural** change, not a type-breaking one.
`examples:typecheck` stays green while every one of those agents silently loses its tools — the shape
`.agents/rules/enforcement-architecture.md` § "Silence is not success" exists to refuse. (A stated
"26 lines" was also wrong: the interface and function span `create-tools.ts:41-87`, 47 lines.)

### The decision (owner, 2026-08-18)

Extract `@robota-sdk/agent-tool-defaults` as a composition leaf — **in the shape this repository has
already proved on the DAG side.**

`dag-nodes-default` is the same problem, already solved: a mid-layer library (`dag-framework`) that
wants a zero-config default set without a hard edge onto a composition leaf.

- `dag-framework` declares it in `optionalDependencies` ONLY — never `dependencies`.
- It reaches it by dynamic `await import('@robota-sdk/dag-nodes-default')`
  (`load-default-node-registry.ts:21`).
- It does **not** re-export it, and `dag-framework/src/index.ts:5-8` says why in the source: _"a
  pass-through re-export would force a hard `dag-framework → dag-nodes-default` production edge,
  re-creating the concrete-node coupling this stage removes."_

Applied here — with two deliberate departures from the DAG precedent, both argued rather than
inherited:

| Piece                                    | Change                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| New leaf `agent-tool-defaults`           | `createDefaultTools` + `ICreateDefaultToolsOptions` moved verbatim, adapter gating included                                       |
| `agent-framework` manifest               | leaf in **`dependencies`** — see "Departure 1"                                                                                    |
| `assemble-session-tools.ts`              | static import replaced by `await import()`; the tier stays available when `defaultTools` is absent                                |
| `index.ts:407`, `:417`                   | barrel exports deleted — the leaf is never re-exported (STRUCT-07)                                                                |
| `createSession` (`create-session.ts:93`) | becomes **async** — see "The async cost", below. This is a PUBLISHED signature change (`index.ts:406`)                            |
| `agent-subagent-runner`                  | no manifest edge to the leaf ⇒ the tool axis becomes a **compile error**, symmetric with the provider axis under ARCH-021         |
| `pack-coding`                            | consumes the leaf's always-present subset instead of rebuilding it, by STATIC import + a sanctioned-set entry — see "Departure 2" |

**Departure 1 — `dependencies`, not `optionalDependencies`.** `dag-framework` uses the optional field
because its motive is install WEIGHT: `load-default-node-registry.ts:4-9` keeps it free of the concrete
node packages and their heavy SDKs, and its loader's error message is a real contract ("install it, or
pass `nodes`"). Neither transfers. `agent-tool-defaults` would import only `@robota-sdk/agent-tools`
and `@robota-sdk/agent-core`, **both already hard dependencies of `agent-framework`** — zero weight is
avoided. And the guarantee comes from source syntax, not the manifest: Rule 8 matches
`from\s+['"]<pkg>['"]` (`check-dependency-direction.mjs:363`), so `dependencies` + dynamic import
satisfies it exactly as well. Meanwhile the optional field would cost the very contract this remedy
exists to keep — `README.md:100` promises the built-in tools "are assembled for SDK sessions", and an
install with `--omit=optional` would make that throw. Six scans in this repo union optional with
`dependencies` when computing edges, and `scan-agent-tools-neutrality.mjs:14` names the optional field
a dodge channel.

The decisive evidence is in the repo's own published-surface proof: `run-external-proof.mjs:79` walks
`entry.manifest.dependencies` **only**. Under the optional-edge shape the leaf would never be packed
into the external-proof closure, and `mode-c.ts`'s repointed import could not resolve. So: hard edge,
lazy import.

**Departure 2 — `pack-coding` imports the leaf statically.** The lazy alternative is far worse here:
`createCodingPack` (`coding-pack.ts:73`), `createRobotaPacks` and `assembleProduct`
(`assemble-product.ts:131`) are ALL synchronous, so a dynamic import would propagate async through the
entire product-assembly chain for no layering gain. `pack-*` is not a composition root under the layer
diagram, so this needs a deliberate `GUARDED_AGGREGATORS` entry. That is the honest edge: a capability
pack declaring "my tools ARE the default tool set" is exactly what the sanctioned set is for.

### The async cost, measured

`assembleSessionTools` (`assemble-session-tools.ts:54`) is synchronous today, and so is its only
caller `createSession` (`create-session.ts:93`). Both become async. The propagation then STOPS: the
only in-repo caller of `createSession` is `interactive-session-init.ts:152`, inside
`createInteractiveSession`, which is already async — as is `initializeInteractiveSessionAsync`, and
`InteractiveSession` already initialises behind `initPromise`/`ensureInitialized`.
`createSubagentSession` does not route through `assembleSessionTools` and is unaffected.

One hop, and it lands on a published export: `createSession` is barrel-exported at `index.ts:406`.
Recorded here as a completion criterion rather than discovered during implementation. (Sequencing
note: the separate item below — `createSession` is exported while `SPEC.md:1881` and `README.md:347`
both call it internal — would make this change internal-only if resolved first.)

### No module-shape workaround is needed — and the one first proposed was a defect

A previous revision proposed `import type { ICreateDefaultToolsOptions } from '…'` to keep the shape
checked, plus a `GUARDED_AGGREGATORS` entry for `agent-framework` because Rule 8's regex also matches
type-only imports. Review refuted both halves.

**It was unnecessary.** With the hard `dependencies` edge of Departure 1 the specifier resolves at
compile time, so TypeScript types `await import('@robota-sdk/agent-tool-defaults')` natively as
`Promise<typeof import(…)>` — the adapter-gating shape included, transitively. No cast, no hand-copy,
no `import type … from`. (`typeof import('…')` is available if an explicit annotation is ever wanted,
and contains no `from` token either.) The DAG sites cast because their edges are
`optionalDependencies` and may not resolve — a consequence of the manifest choice Departure 1 already
rejected.

**And it was actively harmful.** `checkEntryPointOnly` (`check-dependency-direction.mjs:355`) tests
`sanctioned.has(pkg.name)` and `continue`s BEFORE the file loop. Sanctioning `agent-framework` would
therefore disable Rule 8 for that package wholesale — including a later static VALUE import of the
leaf in `assemble-session-tools.ts`, i.e. the precise regression this item exists to prevent. It would
have granted a blanket exemption to the floor's target package, in the same change that builds the
floor.

So: no cast, no type-only import, and `agent-framework` stays UNSANCTIONED, which is the point of the
floor. The Rule 8 `import type` blindness stays filed as its own item, but this proposal no longer
depends on it landing — a proposal whose correctness waits on another item's queue is a proposal that
can be blocked by it.

### `DEFAULT_TOOL_DESCRIPTIONS` stays, and the move widens a filed defect

`create-tools.ts` has three exports, not two. The third, `DEFAULT_TOOL_DESCRIPTIONS` (line 24), is
consumed SYNCHRONOUSLY by `create-session-runtime.ts:4,124` to build the system prompt, and is
re-exported on the internal assembly barrel (`assembly/index.ts:8`). It is not on the public barrel.

It stays in `agent-framework`, and that is forced rather than chosen: moving it would make
`create-session-runtime.ts` need the leaf synchronously, which is either a static edge that trips the
`GUARDED_AGGREGATORS` entry this item adds, or a second async propagation into system-prompt building.
Neither is green.

Three consequences, stated because an earlier draft of the staging said the wrong thing about one of
them:

- `create-tools.test.ts` is **split**, not moved — the tool cases go with the leaf, the description
  cases stay. An earlier draft said "moves with the file", which would have left the moved test
  importing a constant the leaf does not export.
- `create-tools.ts` is **deleted**, not renamed. Review pointed out that "renamed accordingly" is not
  a criterion a reviewer can check, and the disposition is derivable: the constant has exactly ONE
  production consumer (`create-session-runtime.ts:124`), and the internal re-export at
  `assembly/index.ts:8` has NO consumer at all — nothing imports it from the assembly barrel and it is
  not on the public barrel. So the constant is collocated into `create-session-runtime.ts`, the dead
  re-export is dropped, and the two description assertions fold into that file's coverage. This
  removes a file rather than renaming one down to a single constant, and it puts the constant beside
  the prompt builder — which states the filed defect plainly at the site where that item will be
  fixed.
- The move **widens the already-filed `DEFAULT_TOOL_DESCRIPTIONS` defect**: the coupling between the
  descriptions and the tools they describe goes from in-file to cross-package, with nothing holding
  it. That item is not absorbed here, but "knowingly widened" is a different record from "did not
  notice", and this is the record.

### Staging

Revised twice. The first version's S1 could not be green — keeping the barrel exports while the symbol
lives in another package is a cross-package pass-through re-export (STRUCT-07). The second version
introduced `pack-coding`'s static import in S2 while the floor arrived only in S3, leaving a window
where an unguarded aggregator gained a static importer.

- **S1a (the move)** — extract the leaf and wire it into the build/publish pipelines
  (`build-types-ordered.mjs`, the publish registry — the external proof asserts build output exists,
  so a missing entry makes the `mode-c.ts` repoint unresolvable). `agent-framework` takes a
  `dependencies` edge with a **static** import for now. Delete `index.ts:407` and `:417`; repoint the
  three barrel consumers (`pack-coding/src/__tests__/coding-pack.test.ts:2`,
  `agent-cli/src/__tests__/robota-assembly-equivalence.test.ts:23`,
  `scripts/external-proof/fixture/src/mode-c.ts:18`); split `create-tools.test.ts`. No async, no
  dynamic import, no floor entry yet. Green: the barrel lines go in the same commit as the move so
  STRUCT-07 holds, Rule 8 does not yet guard this aggregator so the static import trips nothing, and
  everything stays synchronous. **The runner's route closes here** — the item's headline guarantee
  lands in the mechanical commit.
- **S1b (the seam)** — replace the static import with `await import()` plus the
  `no-restricted-syntax` suppression and its reason string; `createSession` becomes async; add
  `GUARDED_AGGREGATORS['@robota-sdk/agent-tool-defaults']` with an **empty** sanctioned set. The
  static edge is removed in the same commit the rule appears, so the aggregator is green and guarded
  simultaneously.

  Why the split is here and nowhere else: it separates the mechanical bulk — a package move, six
  repoints, high volume and low judgement — from the two things that need judgement, a layering seam
  and the item's ONLY published breaking change. A sync→async signature change on a barrel-exported
  function is exactly what gets waved through when buried inside a package extraction. No other seam
  works: build/publish wiring cannot precede the package, the repoints are forced by the barrel
  deletion, and the async change is _caused_ by the dynamic import.

  The cost, stated: between S1a and S1b `agent-framework` holds a static edge to a composition leaf —
  the shape this item objects to. It is strictly better than today (the aggregator currently lives
  INSIDE the library, and the barrel route is already closed at S1a) and nothing is silently bypassed,
  because Rule 8 does not guard the aggregator until S1b — there is no rule to evade. They land as two
  commits in ONE PR, so no merged state ever holds the intermediate.

- **S2** — `pack-coding` consumes the leaf's always-present subset; `@robota-sdk/pack-coding` joins
  the sanctioned set **in the same commit as its import**, so the entry is co-located with the thing
  it sanctions. The name-equality pin in `coding-pack.test.ts` dissolves because the relationship
  becomes structural.
- **S3** — SPEC / README / `docs/design/composition.md` name the leaf.

Test-plan note, from an independent re-derivation: `assembleSessionTools` has exactly one caller
(`create-session.ts:120`) and **no direct test anywhere**. So there is no unit-level guard on it, and
S1b's regression proof has to run through `create-session-default-tools.test.ts` — the async change
is what that suite must guard — the only suite that
would catch a broken tier.

### Not closed by this item

The **agent axis** is the same shape and still unguarded: `child-process-subagent-runner.ts:208`
resolves `?? getBuiltInAgent(agentType)` from `agent-framework`'s barrel, and `getBuiltInAgent` is
absent from `FORBIDDEN_IMPORTS` (`scan-subagent-runner-composition.mjs:48`). It belongs to #1854.

Three further defects surfaced while testing premises and are filed separately rather than absorbed.
Rule 8's edge regex (`check-dependency-direction.mjs:363`) cannot distinguish `import type … from`,
which creates no production edge, from a value import — which is why every mid-layer lazy consumer is
pushed toward a hand-copied cast, as `dag-framework` pays today. Also:
`DEFAULT_TOOL_DESCRIPTIONS` injects a model-facing tool inventory independent of the session's real
tool set (`create-session-runtime.ts:124`), and `createSession` is barrel-exported while `SPEC.md:1881`
and `README.md:347` both state it is internal.

## Recommendation gate

`REVIEW VERDICT: ENDORSE` — `proposal-reviewer`, 2026-08-18, after five rounds (REJECT → REVISE ×3 →
ENDORSE). What the rounds changed, because the record is worth more than the verdict:

1. **REJECT.** The first recommendation (delete the tier, `pack-coding` sole owner) rested on "no
   caller constructs a session without `defaultTools` today", which was false — two published option
   surfaces cannot even express the alternative, and the failure mode was a silently toolless agent
   behind a green typecheck.
2. **REVISE.** `optionalDependencies` was copied from the DAG precedent without checking WHY that
   precedent uses it (install weight, which does not transfer). `run-external-proof.mjs:79` follows
   `dependencies` only, so the optional edge would have kept the leaf out of the published-surface
   proof entirely.
3. **REVISE.** A type-only import plus a sanctioned-set entry for `agent-framework` would have
   disabled Rule 8 for the floor's own target package — `checkEntryPointOnly` short-circuits before
   the file loop. It was also unnecessary: a hard `dependencies` edge types `await import()` natively.
4. **REVISE.** `create-tools.ts`'s third export was unaddressed, and both literal readings of the
   staging were red.
5. **ENDORSE.**

Scope shrank in each of the last three rounds, which is the convergence signal the pipeline reads.

## User Execution Test Scenarios

`SCENARIO DRAFTED: automatable | 3` — `user-execution-scenario-author`, 2026-08-18. Every command
below was RUN against the pre-change tree before being written, and the expected values are measured,
not predicted.

**The headline guarantee has no user surface, and none was manufactured.** "`import
{ createDefaultTools } from '@robota-sdk/agent-framework'` no longer compiles in
`agent-subagent-runner`" is a compile-time property belonging to `pnpm typecheck`, Rule 8 and
`scan-subagent-runner-composition.mjs` — the engineering gate, not this one. S-3's fourth assertion
(the symbol is gone from the published runtime barrel) is the closest a user gets, and it is
deliberately weaker than the type-level claim. Nobody judging this should read S-3 as verifying the
layering guarantee.

### S-1 — a zero-config session still receives the default tool tier, and `IAgentRuntime.createSession` stays synchronous

- **Executability:** automatable, fully offline (scripted provider, no key, no network).
- **Prerequisite the work must build:** `packages/agent-framework/examples/verify-zero-config-default-tools.ts`, chained into the existing `scenario:verify` script. Folded into this unit's scope.
- **Command:** `pnpm --filter @robota-sdk/agent-framework scenario:verify`
- **Expected:** exit `0`, and a JSON line with `"createSessionReturnedSynchronously":true` and `"providerObservedTools":["AskUserQuestion","BackgroundProcess","Bash","Edit","Glob","Grep","Read","Shell","WebFetch","WebSearch","Write","report_goal_status"]` — byte-identical to the pre-change measurement. A `Promise` from `runtime.createSession({})`, or any missing name, is a failure.
- **Cleanup:** the example removes its own `mkdtemp` directory.
- **Why it exists:** this is the only scenario where a broken `await import()` inside `assembleSessionTools` shows up as a BEHAVIOUR difference rather than a green typecheck — i.e. the silently-toolless-agent mode the REJECT round was about.
- **Evidence:** run 2026-08-19 — exit 0, 4 records. The new case emitted
  `{"scenario":"ARCH-035","createSessionReturnedSynchronously":true,"providerObservedTools":["AskUserQuestion","BackgroundProcess","Bash","Edit","Glob","Grep","Read","Shell","WebFetch","WebSearch","Write","report_goal_status"],"cleanupRemoved":true}`. Reproduced byte-identically
  by the gate guard.

### S-2 — the `robota` CLI's live tool surface is unchanged end to end

- **Executability:** automatable. Decomposed because the CLI is a TUI by default: print mode (`-p`) is the non-interactive path, and `--session-log` swaps in a deterministic replay provider, so no key and no network.
- **Prerequisite state:** a scratch project with `.robota/settings.json` (dummy key), `HOME` redirected to a scratch dir so the developer's real `~/.robota` is untouched, and `VOLTA_HOME` left pointing at the real Volta install — redirecting `HOME` alone makes the run die with `Volta error: Node is not available` (measured).
- **Command:** `robota -p "hello" --bare --session-log <cross-fidelity.jsonl>`, then read `tools` from the `provider_request` event in `.robota/logs/<id>.jsonl`.
- **Expected:** exits `0`, prints exactly `CROSS_FIDELITY_OK`; the recorded request carries the 19 names measured before the change (the 12 of S-1 plus the seven `robota_command_*` tools). The `No metadata registered for model` warning on stderr is pre-existing and not part of the assertion.
- **Cleanup:** remove the two scratch directories. Nothing is written inside the repo.
- **Why it exists:** it guards S2. `pack-coding` switching from rebuilding the list to consuming the leaf has no honest proof except that the shipped product's tool set did not move — and it is the replacement for the name-equality pin that dissolves in `coding-pack.test.ts`.
- **Evidence:** run 2026-08-19 by the gate guard — I had not run it. Exit 0; stdout exactly
  `CROSS_FIDELITY_OK`; the `provider_request` event carried the 19 names measured before the
  change (the 12 of S-1 plus the seven `robota_command_*` tools). **No regression:**
  `pack-coding` consuming the leaf did not move the shipped tool surface. Nothing was written
  inside the repo.

### S-3 — the new leaf is installable and usable by a third party from the published tarballs

- **Executability:** automatable. Needs the npm registry (for the consumer fixture's `typescript` / `@types/node`); **no credentials**.
- **Prerequisite the work must build:** the leaf wired into `build-types-ordered.mjs` and the publish registry (the proof packs from `dist/` and fails loudly if a closure member has no build output); `mode-c.ts:18` repointed at the leaf; new C5 assertions.
- **Command:** `pnpm build && node scripts/external-proof/run-external-proof.mjs`
- **Expected:** exit `0`, `EXTERNAL PROOF PASSED — <n> assertions` with `n > 69`. Step `[1/5]` must log `packed @robota-sdk/agent-tool-defaults`, which is what proves the hard `dependencies` edge put it in the closure — under `optionalDependencies` it would be absent, and that absence is precisely what this asserts. New C5 assertions: the leaf's `createDefaultTools({ cwd })` returns the ten always-present names; a `retrievalAdapter` adds exactly `CodebaseRetrieval`; `createCodingPack({ cwd }).tools` equals the always-present set STRUCTURALLY (both from the leaf); and `agent-framework` no longer exports `createDefaultTools` from its runtime barrel. C1-C4 and Modes A/B unchanged.
- **Cleanup:** the runner deletes its own `os.tmpdir()` working directory on success.
- **Evidence:** FAILED on the first gate run 2026-08-19, and was fixed rather than argued down.
  The proof reported `69 assertions` against a written expectation of `n > 69`, because the four
  C5 assertions this scenario named as "the work must build" had not been written — unbuilt
  scope, not a mis-measured baseline. They exist now and the proof reports **72 assertions**,
  all four emitting `ok`: the leaf ships exactly the ten always-present names; a
  `retrievalAdapter` adds exactly `CodebaseRetrieval`; `pack-coding`'s tools ARE that set; and
  `agent-framework` no longer exports `createDefaultTools` from its runtime barrel. Step `[1/5]`
  logs `packed @robota-sdk/agent-tool-defaults`, the evidence for the hard `dependencies` edge.
  Red-proved rather than trusted: dropping one name from the expected set turns three of the
  four RED.

### Two traps the scenarios exist to catch

- **`IAgentRuntime.createSession` stays synchronous BY ACCIDENT.** It does not call the assembly
  `createSession` at all — it constructs `new InteractiveSession({...})` directly, and the assembly
  call happens later inside `initializeInteractiveSessionAsync`. So the published signature survives
  through an indirection, not by design. An implementer who "propagates async until it compiles" would
  very plausibly make it `Promise<InteractiveSession>` and break every zero-config consumer the
  re-scope catalogued. S-1 asserts it explicitly for that reason.
- **The tool list is read through a scripted provider's recorded `chatOptions`, not from the session.**
  The framework exposes no public accessor for a built session's final tool list — the external proof
  says so itself. That is a genuine consumer-visible channel but an indirect one; a public accessor
  would make S-1 a one-liner and is worth filing separately.

### Recorded environment concern

S-3 needs the npm registry. It is not a credentialed surface, but it is not hermetic and it is slow.
It was not substituted for, because it is the ONLY surface that can prove a newly published package is
reachable by a consumer. A hermetic variant would need `typescript`/`@types/node` vendored into the
fixture — a repo-level decision, not this item's.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-18

**Status upgrade:** scenario drafted → scenario written (frontmatter `status: todo` is untouched — Stage 1
authorizes the Stage 2 run; moving status is the orchestrator's call, not this gate's)

**Ordering:** exempt — `DONE-GATE-STAGE-1` has no prior gate (gate catalogue > Prior-gate map, line 83).
Input state checked anyway: `## User Execution Test Scenarios` present, file at `.agents/tasks/` root with
`status: todo`, no prior `DONE-GATE` entry in this file (first run), and `REVIEW VERDICT: ENDORSE`
(`proposal-reviewer`, 2026-08-18) recorded above. Implementation has NOT started —
`packages/agent-tool-defaults` does not exist and `index.ts:407`/`:417` still export `createDefaultTools` —
so the section genuinely precedes implementation as `backlog-execution.md` requires.

- **Exact commands / prerequisites / expected observable / evidence field** — MET, all three.
  S-1: command `pnpm --filter @robota-sdk/agent-framework scenario:verify`; prerequisite names the example
  to be built and the chain it joins (`scenario:verify` verified present in
  `packages/agent-framework/package.json` with three `verify-*.ts` siblings); observable is exit `0` plus
  `"createSessionReturnedSynchronously":true` and a byte-exact 12-name array; cleanup (`mkdtemp` self-removal)
  and `**Evidence:** _(gate time)_` present. S-2: exact flags `robota -p "hello" --bare --session-log <fixture>`
  (all three verified in `cli-args.ts:93,172` and `binary-agent-driver.ts:93,98`); prerequisite state is
  specific to the measured failure mode (`.robota/settings.json` dummy key, `HOME` redirected, `VOLTA_HOME`
  preserved — "redirecting `HOME` alone makes the run die with `Volta error: Node is not available`");
  observable is exit `0`, exactly `CROSS_FIDELITY_OK`, 19 named tools, with a pre-existing stderr warning
  explicitly fenced OUT of the assertion; cleanup and evidence field present. S-3: command
  `pnpm build && node scripts/external-proof/run-external-proof.mjs`; observable is exit `0`,
  `EXTERNAL PROOF PASSED — <n> assertions` with `n > 69`, the `packed @robota-sdk/agent-tool-defaults` log
  line at step `[1/5]`, and four enumerated C5 assertions; cleanup and evidence field present.
  Noted weakness, not a breach: S-2's post-run extraction ("read `tools` from the `provider_request` event
  in `.robota/logs/<id>.jsonl`") is prose rather than a literal `jq` line, and the scenario says `robota`
  without naming the repo-local build — `robota-plumbing.ts:44` shows `--session-log` replay needs a dev-only
  package absent from the published CLI. Both resolve to a loud, specific error rather than a false pass, and
  `<id>` is necessarily run-generated (the same per-run-path fencing accepted at ARCH-031's Stage 1).
- **Executability decision per scenario** — MET, all three labelled `automatable`. That is this project's own
  vocabulary for the catalogue's `agent-executable`: `user-execution-scenario-author.md:75,109` defines the
  label set as `automatable | manual | not-applicable`. No scenario claims `manual-only`, so the
  "specific technical reason" sub-clause is **N/A** — recorded rather than skipped. Executability
  independently probed: `npm view typescript version --registry=https://registry.npmjs.org` → `7.0.2`, exit
  `0`, so S-3's one external prerequisite is reachable from this environment.
- **Drives a product surface (no build / typecheck / lint / test / harness / CI / text inspection)** — MET,
  all three, and this criterion decided the gate.
  S-1 drives the public SDK: `IAgentRuntime.createSession` (`agent-runtime.ts:71,100`, verified to return
  `InteractiveSession` synchronously today) with `createScriptedProvider` from
  `@robota-sdk/agent-core/testing` — a declared package `exports` subpath, not a private test util. It runs no
  vitest and no harness script; it is an example in the package's established `scenario:verify` chain.
  S-2 drives the real `robota` binary (`packages/agent-cli/package.json` `bin`) and reads
  `.robota/logs/{sessionId}.jsonl`, which `agent-cli/README.md:512` documents as a user-facing diagnostic
  output; the `tools` field is real product data (`execution-round-streaming.ts:100-107` emits
  `provider_request` with `tools: resolved.availableTools`).
  S-3 drives the published artifact: `proof:external` is a root script (`package.json:110`) that is **not** in
  `pnpm harness:scan` and **not** in any `.github/workflows/` file (both greps empty), and its fixture is
  "dependency-free ... deliberately does NOT install vitest or any Robota test utility"
  (`external-proof/fixture/src/harness.ts:1-5`) — a third-party consumer of the shipped tarballs, which is the
  "public SDK usage" surface the rule names, not a test run.
  The compile-time headline guarantee is correctly EXCLUDED, not dodged: the item states it "belongs to
  `pnpm typecheck`, Rule 8 and `scan-subagent-runner-composition.mjs` — the engineering gate, not this one",
  and fences the nearest observable with "Nobody judging this should read S-3 as verifying the layering
  guarantee." Writing a typecheck- or scan-observable scenario would itself have breached this criterion.
  Capability Reachability is satisfied, not N/A-dodged: the capability at risk (a zero-config session still
  receiving the default tool tier across an extraction that makes `assembleSessionTools` dynamically import it)
  is reachable on three surfaces — SDK, CLI, published closure — each with an agent-run scenario.
  S-1's indirect observable is a genuine consumer channel, tested rather than accepted: the same
  `provider_request.tools` data is reachable by an ordinary CLI user with no harness at all (S-2), and the
  identical scripted-provider-recorded-request channel passed this gate at ARCH-023 Stage 1 (2026-08-15).
  The indirection and the missing public accessor are disclosed in "Two traps", not concealed.
- **Credential / external-service prerequisite stated explicitly** — MET. S-1 "fully offline (scripted
  provider, no key, no network)"; S-2 "no key and no network"; S-3 "Needs the npm registry ... **no
  credentials**", plus a dedicated "Recorded environment concern" stating it is non-hermetic and slow, why it
  was not substituted for, and that the hermetic variant is a repo-level decision out of scope. The
  design-preference invariant (a scenario whose only observable needs credentials the executor may not have) is
  **N/A** — no scenario's observable requires credentials.

**Prerequisites judged foldable, not an environment gap that should have halted planning.** S-1's
`verify-zero-config-default-tools.ts` + `scenario:verify` chain is the rule's "build that environment as part
of the backlog" branch, on an existing pattern (three sibling examples) with direct precedent: ARCH-023 folded
that same script and example into scope and passed this gate. S-3's prerequisites are not scenario scaffolding
at all — `scripts/build-types-ordered.mjs` (exists), the publish registry, and the `mode-c.ts:18` repoint
(verified: line 18 imports `createDefaultTools` from `@robota-sdk/agent-framework`) are the work itself, named
in the ENDORSED staging S1a. Neither touches a root `package.json` script or any repo-wide policy file, so no
stop-and-ask under Agent Decision Authority is triggered.

**"Measured, not predicted" spot-checked rather than accepted:** `createDefaultTools` returns exactly the ten
always-present names S-3 asserts (`create-tools.ts:62-80`); S-1's 12 = those ten + `report_goal_status`
(`includeGoalTool: true`, `create-session-projection.ts:121`) + `BackgroundProcess`; the `n > 69` baseline
matches ARCH-006's recorded "`pnpm proof:external`: 69 assertions, exit 0"; `cross-fidelity.jsonl` exists at
`packages/agent-cli/src/__tests__/e2e/fixtures/`.

**Verdict:** PASS — every scenario drives a product surface, and all four criteria are met.

### [DONE-GATE-STAGE-2] — ❌ FAIL | 2026-08-19

**Status remains:** scenario written (frontmatter `status: todo` untouched — a status change follows a
verdict, it is not part of one)

**Ordering:** PASS. Prior gate `DONE-GATE-STAGE-1` shows `✅ PASS | 2026-08-18` in this same section
(gate catalogue > Prior-gate map: `DONE-GATE-STAGE-2` ← `DONE-GATE-STAGE-1`). Expected input state
"scenarios written, implementation complete" holds: three scenarios written with expected observables,
and the four staged commits are on `fix/arch-035-single-owner-default-tool-set` —
`4952e9b5b` (S1a extract), `94afd229a` (S1b dynamic seam), `2136db66b` (S2 pack-coding consumes the leaf),
`3c7a428c1` (S3 docs + scenario). `packages/agent-tool-defaults/` exists; `pnpm build` exits `0`.

**Failed criteria:**

- **The observed result matched the expected observable result for every scenario** — NOT MET for S-3.
  S-3's written expected observable has four parts. Two matched, two did not.
  Matched: exit `0`; and step `[1/5]` logged `packed @robota-sdk/agent-tool-defaults →
robota-sdk-agent-tool-defaults-3.0.0-beta.79.tgz` (line 21 of the run, closure of 18 published
  packages) — the hard `dependencies` edge is genuinely proven, as written.
  Did NOT match: the run printed `EXTERNAL PROOF PASSED — 69 assertions across Modes A, B and C`,
  but the expected result requires `n > 69`; 69 is not greater than 69. And the four enumerated
  "New C5 assertions" — the leaf's `createDefaultTools({ cwd })` returning the ten always-present
  names, a `retrievalAdapter` adding exactly `CodebaseRetrieval`, `createCodingPack({ cwd }).tools`
  equalling the always-present set structurally, and `agent-framework` no longer exporting
  `createDefaultTools` from its runtime barrel — are absent. Section C5 emitted the same 7 `ok`
  lines it has emitted since ARCH-006; `git diff 9f2284a52..HEAD -- scripts/external-proof/` is
  `1 file changed, 2 insertions(+), 1 deletion(-)` — the `mode-c.ts:19` import repoint from S1a and
  nothing else. The named assertions were listed under S-3's own "Prerequisite the work must build"
  as well as its expected result, so this is unbuilt scope, not a mis-measured baseline.
  Judged NOT an acceptable narrowing. The zero net assertions are exactly the ones that would have
  exercised the NEW leaf's behaviour from the published surface; what remains of S-3 is the closure
  line plus 69 pre-existing assertions that passed before this branch. The repoint does make the
  fixture compile against the leaf, but compilation is a typecheck property, which
  `backlog-execution.md` > Done Gate excludes from this gate by name. The underlying product facts
  were spot-checked and do hold (`packages/agent-framework/src/index.ts` no longer exports
  `createDefaultTools`) — but an unasserted true fact is not an observed scenario result.
  **Required action:** either write the four named C5 assertions so the proof reports `n > 69`, or
  amend S-3's expected observable — the latter is a change to a written scenario and must be
  re-judged by `DONE-GATE-STAGE-1` before this stage can be re-run. Not this gate's call.

- **Concrete evidence recorded under each scenario's evidence field** — NOT MET at run time.
  All three scenarios still read `- **Evidence:** _(gate time)_`. The observed results are recorded
  in this entry, but the per-scenario evidence fields the criterion names are unfilled, and filling
  them belongs to the executing actor, not to this guard. Subordinate to the deciding criterion above.

**Criteria met:**

- **The agent directly executed every scenario against the completed implementation** — MET, all three
  run by this guard against the built tree, not accepted from the caller's report.
  S-1: `pnpm --filter @robota-sdk/agent-framework scenario:verify` → exit `0`, 4 records, final line
  byte-identical to the written expectation:
  `{"scenario":"ARCH-035","createSessionReturnedSynchronously":true,"providerObservedTools":["AskUserQuestion","BackgroundProcess","Bash","Edit","Glob","Grep","Read","Shell","WebFetch","WebSearch","Write","report_goal_status"],"cleanupRemoved":true}`.
  `createSessionReturnedSynchronously:true` confirms `IAgentRuntime.createSession` did not become
  `Promise`-returning across the dynamic-import seam — the trap the scenario exists to catch. S-1 MATCHED.
  S-2: executed (the caller had not run it). Scratch project with `.robota/settings.json` carrying a
  dummy `anthropic` key, `HOME` redirected to a scratch dir, `VOLTA_HOME` preserved, repo-local binary
  `packages/agent-cli/bin/robota.cjs` after `pnpm build`:
  `robota -p "hello" --bare --session-log packages/agent-cli/src/__tests__/e2e/fixtures/cross-fidelity.jsonl`
  → exit `0`; stdout exactly `CROSS_FIDELITY_OK` (18 bytes, nothing else); stderr carried only the
  pre-existing `No metadata registered for model "claude-test-model"` (NEUT-010) warning the scenario
  fences out. The single `provider_request` event in `.robota/logs/session_1787076672154_bevzs3706.jsonl`
  carried **19** tool names, sorted:
  `["AskUserQuestion","BackgroundProcess","Bash","Edit","Glob","Grep","Read","Shell","WebFetch","WebSearch","Write","report_goal_status","robota_command_agent","robota_command_compact","robota_command_memory","robota_command_monitor","robota_command_schedule","robota_command_skills","robota_command_workflows"]`
  — the 12 of S-1 plus the seven `robota_command_*` tools, exactly the pre-change measurement. S-2 MATCHED:
  `pack-coding` switching to consume the leaf did NOT move the shipped tool surface. Scratch dirs removed;
  `git status --porcelain` shows nothing written inside the repo by the run.
  S-3: `pnpm build && node scripts/external-proof/run-external-proof.mjs` → both exit `0`; result judged
  under Failed criteria above.
- **Engineering verification not cited as evidence** — MET. Verified rather than assumed: `proof:external`
  appears only at root `package.json:110` and in no `.github/workflows/` file and no `scripts/harness/`
  file; the harness's `scenario:verify` references are `scan-consistency.mjs` (asserts the script EXISTS),
  `self-check.mjs` (runs agent-core's), and `ci.yml:859` (runs agent-executor's windows-shell one) — none
  is `@robota-sdk/agent-framework scenario:verify`, which is a `tsx examples/verify-*.ts` chain, not vitest.
  S-2 drives the shipped `robota` binary. No build/test/lint/harness/CI output is offered as the observable
  for any scenario. The `pnpm build` in S-3's command line is a precondition of packing the tarballs, not
  the observable.
- **Unprobed capability-absence claim** — N/A, recorded rather than skipped: no scenario was skipped and no
  exception was claimed, so no capability-absence reason exists to probe. S-3's one external dependency
  (the npm registry) was exercised for real — the run packed 18 tarballs and installed the consumer
  fixture successfully.
- **Durable repository artifacts** — MET. Every referenced path exists:
  `packages/agent-framework/examples/verify-zero-config-default-tools.ts`,
  `packages/agent-cli/src/__tests__/e2e/fixtures/cross-fidelity.jsonl`,
  `scripts/external-proof/run-external-proof.mjs`, `scripts/external-proof/fixture/src/mode-c.ts`,
  `packages/agent-tool-defaults/package.json`.
- **`manual-only` exception** — N/A. No scenario claims it; all three were executable and were executed.

**Verdict:** FAIL — S-1 and S-2 matched their expected observables exactly, but S-3's observed result
(`69 assertions`, no C5 additions) does not match its written expected result (`n > 69` plus four named
C5 assertions), and one unmet criterion is a FAIL regardless of the rest.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-19

**Status upgrade:** scenario written → scenario executed (second run of this gate, after the ❌ FAIL
above; frontmatter `status: todo` left untouched — completion is the orchestrator's act on this verdict,
not part of it)

**Ordering:** PASS. `DONE-GATE-STAGE-1` shows `✅ PASS | 2026-08-18` in this section. Input state
"scenarios written, implementation complete" holds, now including `3b8aca066` on
`fix/arch-035-single-owner-default-tool-set` (`scripts/external-proof/fixture/src/mode-c.ts`, +49/-5).
`pnpm build` exits `0`. Working tree carries no uncommitted change to the implementation.

- **The agent directly executed every scenario against the completed implementation** — MET. All three
  re-run by this guard against a freshly rebuilt tree; none of the caller's results were accepted, and
  the caller had still not run S-2.
- **The observed result matched the expected observable result for every scenario** — MET, all three.
  **S-1** — `pnpm --filter @robota-sdk/agent-framework scenario:verify` → exit `0`, 4 records, final line
  byte-identical to the written expectation:
  `{"scenario":"ARCH-035","createSessionReturnedSynchronously":true,"providerObservedTools":["AskUserQuestion","BackgroundProcess","Bash","Edit","Glob","Grep","Read","Shell","WebFetch","WebSearch","Write","report_goal_status"],"cleanupRemoved":true}`.
  `createSessionReturnedSynchronously:true` — the dynamic-import seam did not turn
  `IAgentRuntime.createSession` into a `Promise`, which is the trap S-1 exists to catch.
  **S-2** — repo-local `packages/agent-cli/bin/robota.cjs` (post-build), scratch project with a dummy-key
  `.robota/settings.json`, `HOME` redirected, `VOLTA_HOME` preserved:
  `robota -p "hello" --bare --session-log packages/agent-cli/src/__tests__/e2e/fixtures/cross-fidelity.jsonl`
  → exit `0`; stdout exactly `CROSS_FIDELITY_OK` (18 bytes); stderr only the pre-existing NEUT-010
  `No metadata registered for model` warning the scenario fences out. The single `provider_request` event
  in `.robota/logs/session_1787077935935_pwnqj0jod.jsonl` carried **19** names, sorted:
  `["AskUserQuestion","BackgroundProcess","Bash","Edit","Glob","Grep","Read","Shell","WebFetch","WebSearch","Write","report_goal_status","robota_command_agent","robota_command_compact","robota_command_memory","robota_command_monitor","robota_command_schedule","robota_command_skills","robota_command_workflows"]`
  — identical to the pre-change measurement and to this guard's first run. **No regression: `pack-coding`
  consuming the leaf did not move the shipped tool surface.** Scratch dirs removed; `git status
--porcelain` shows the run wrote nothing inside the repo.
  **S-3** — `pnpm build && node scripts/external-proof/run-external-proof.mjs` → both exit `0`.
  `EXTERNAL PROOF PASSED — 72 assertions across Modes A, B and C` satisfies `n > 69` (was 69 at the
  failed run). Step `[1/5]` logged `packed @robota-sdk/agent-tool-defaults →
robota-sdk-agent-tool-defaults-3.0.0-beta.79.tgz` in an 18-package closure — the hard `dependencies`
  edge. All four named C5 assertions are present and emitted `ok`. "C1-C4 and Modes A/B unchanged"
  verified mechanically, not assumed: the 62 non-C5 `ok` lines are byte-identical between the failed
  69-assertion run and this 72-assertion run (`diff` clean); C5 went 7 → 10 (7 − 1 replaced + 4 added),
  and 62 + 10 = 72, so exactly one assertion was removed and the removal is visible in the arithmetic
  rather than silent.
- **Assertion 4 probed for vacuity rather than accepted** — it is NOT vacuous. Re-ran the proof with
  `--keep` and inspected the consumer environment directly. `import * as frameworkNamespace from
'@robota-sdk/agent-framework'` resolves to
  `consumer/node_modules/@robota-sdk/agent-framework/dist/node/index.js`, installed from the packed
  `file:` tarball — the published artifact, not a workspace link. The object is a real ESM namespace
  (`[object Module]`) carrying **297** exports. Positive controls on the SAME object:
  `hasOwnProperty('InteractiveSession')` → `true`, `hasOwnProperty('createSession')` → `true`; the
  assertion's target `hasOwnProperty('createDefaultTools')` → `false`. The identical predicate applied to
  the leaf's namespace returns `true`, so it discriminates rather than always-passing. The absence is
  also complete across the published surface: the framework declares only two export subpaths (`.` and
  `./testing`), `./testing` does not export it either, and the only occurrence of the name in the packed
  runtime is the call site `await import('@robota-sdk/agent-tool-defaults')` inside the assembly seam —
  `0` re-exports of it from that chunk. The concern was well placed; the assertion survives it.
- **Replacing the old parity check was correct, and did not lose coverage** — verified from source and
  by measurement, not from the author's reading. The old check compared `codingPackToolNames` with
  `frameworkDefaultToolNames`; after S2 `createCodingPack` builds its tools as
  `createDefaultTools(toolOptions)` (`packages/pack-coding/src/coding-pack.ts:87`) with
  `toolOptions = { cwd, ...(sandboxClient ? { sandboxClient } : {}) }`, and `mode-c.ts:39` constructs the
  pack with `{ cwd: process.cwd() }` while `mode-c.ts:179` calls `createDefaultTools({ cwd:
process.cwd() })` — the same function with identical options on both sides, so the equality was a
  tautology that could not fail. Confirmed empirically in the consumer environment (`pack==leaf` → `true`
  by construction). The replacements are strictly stronger: pinning leaf == literal AND pack == literal
  entails the old pack == leaf claim and additionally pins the contents. The pack surface also remains
  exercised by the surviving C5 assertions at `mode-c.ts:240,273`. The removal carries its own
  justification in the fixture comment and the commit message, so it is not a silent deletion.
- **New assertions red-proved independently** — the caller's "drop one name turns three RED" was
  reproduced by this guard rather than trusted, from the packed tarballs in the kept consumer dir:
  with the real expected set all three set assertions are `true`; with `Grep` dropped from it, all three
  flip to `false`. The published `pack-coding` manifest also declares
  `"@robota-sdk/agent-tool-defaults": "3.0.0-beta.79"` as a hard dependency, so "both from the leaf" is
  provable from the published surface and not only from repo source.
- **Concrete evidence recorded under each scenario's evidence field** — MET, and checked for accuracy
  rather than presence. S-1, S-2 and S-3 each carry the command and the observed result; every figure
  quoted there (4 records, the 12-name array, exit 0, `CROSS_FIDELITY_OK`, the 19 names, 72 assertions,
  the `packed` line) matches what this guard observed independently. S-2's field states the run was the
  gate guard's and that the author had not produced it — an accurate attribution, not a borrowed claim.
- **Engineering verification cited as evidence** — no breach. Re-verified: `proof:external` appears only
  at root `package.json:110`, in no `.github/workflows/` file and no `scripts/harness/` script; the
  harness's `scenario:verify` references are `scan-consistency.mjs` (asserts the script exists),
  `self-check.mjs` (agent-core's) and `ci.yml:859` (agent-executor's windows-shell one) — none is the
  agent-framework chain, which is `tsx examples/verify-*.ts`, not vitest. S-2 drives the shipped `robota`
  binary; S-3's fixture is a third-party consumer installing packed tarballs. The `pnpm build` in S-3's
  command is a precondition of packing, not the observable.
- **Unprobed capability-absence claim** — N/A, recorded rather than skipped: no scenario was skipped and
  no exception claimed, so there is no absence to probe. S-3's one external dependency (the npm registry)
  was exercised for real, twice.
- **Durable repository artifacts** — MET. All referenced paths exist:
  `packages/agent-framework/examples/verify-zero-config-default-tools.ts`,
  `packages/agent-cli/src/__tests__/e2e/fixtures/cross-fidelity.jsonl`,
  `scripts/external-proof/run-external-proof.mjs`, `scripts/external-proof/fixture/src/mode-c.ts`,
  `packages/pack-coding/src/coding-pack.ts`, `packages/agent-tool-defaults/`.
- **`manual-only` exception** — N/A. None claimed; all three scenarios were executable and were executed.

**Verdict:** PASS — the criterion that failed the first run, "the observed result matched the expected
observable result for every scenario", is now met for S-3 (72 assertions > 69, all four named C5
assertions present, non-vacuous and red-proved), with S-1 and S-2 unchanged and matching.

## Blockers

- None. The product question that blocked this item — does any consumer construct a session without
  supplying `defaultTools`? — was measured on 2026-08-18: YES, in two published option surfaces that
  cannot express the alternative, two apps and six examples. The owner's decision follows from that:
  keep the zero-config contract, move the aggregator out of the library.

## Result

Delivered as `@robota-sdk/agent-tool-defaults`, a composition leaf, across five commits.

**The guarantee, proved rather than asserted.** A temporary probe in `agent-subagent-runner` was
compiled both ways and then removed: importing from the leaf is `TS2307` (the module does not resolve
there at all — no manifest edge), and the old route through `agent-framework`'s barrel is `TS2305`
(no such export). Under pnpm's isolated layout the leaf is linked into `agent-framework` and absent
from the runner, so this is the type system refusing, not a scan finding. The provider axis got this
from ARCH-021; the tool axis has it now.

**What the leaf did NOT become.** `agent-framework` takes a hard `dependencies` edge and reaches it by
dynamic `import()` only. The manifest field matters: the external proof's closure walks `dependencies`
only, so an `optionalDependencies` edge — the shape the DAG precedent uses for its own reasons — would
have kept the leaf out of the published closure entirely and made the README's "built-in tools are
assembled for SDK sessions" throw under `--omit=optional`. The guarantee comes from the import syntax,
which is what Rule 8 in `scripts/harness/check-dependency-direction.mjs` matches.

**Three defects surfaced that were not the item's subject**, each fixed here rather than filed:

- `TC-09` asserted `expect(() => createSession(...)).not.toThrow()`. Once the factory went async that
  covered only building the promise; the assembly it meant to cover happens after the await, and its
  own ctor-call assertion would have read zero. It could not fail.
- `pack-coding`'s tool list was pinned to the defaults BY NAME. That pin is why ARCH-021's first TC-05
  passed while being unable to fail — comparing tool names cannot distinguish a pack-composed surface
  from an imported-default one when the two are pinned. Consuming the leaf makes the relationship
  structural, and the case now asserts what is still falsifiable.
- The leaf cast every factory result to `IToolWithEventService`, and that erasure was lossy in the one
  direction that mattered: `ICapabilityPack.tools` is `readonly FunctionTool[]`, so a consuming pack
  needed a second cast back. Every factory already returns `FunctionTool`. Both casts are gone.

**Gate history.** `DONE-GATE-STAGE-2` FAILED first, correctly: the external proof reported 69
assertions against a scenario expecting more, because the four C5 assertions the scenario named as
"the work must build" had not been written. The repoint proved only that the fixture COMPILES against
the leaf, which is a typecheck property this gate excludes by name. They exist now, the proof reports
72, and they were red-proved — dropping one name from the expected set turns three of the four red.
The guard also ran S-2, which I had not, and confirmed the shipped tool surface is unchanged at 19
names.

**Not closed here.** The agent axis (`?? getBuiltInAgent`, absent from the composition scan's
`FORBIDDEN_IMPORTS`) is the same shape and belongs to #1854, as does the question of whether a
defaults aggregator should be published at all. `DEFAULT_TOOL_DESCRIPTIONS` stayed in `agent-framework`
beside its only consumer, and this change knowingly widened the coupling between that inventory and the
tools it describes from in-file to cross-package — recorded as widened rather than left unsaid.
