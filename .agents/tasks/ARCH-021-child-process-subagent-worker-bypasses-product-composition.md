---
title: "ARCH-021: the child-process subagent worker (robota's default runner) hard-codes the default provider set and rebuilds default tools — a product's custom providers and pack-owned tools cannot reach its subagents"
status: done
created: 2026-08-13
completed: 2026-08-16
priority: high
urgency: soon
area: packages/agent-subagent-runner, packages/agent-cli, packages/pack-coding, packages/agent-product
depends_on: [ARCH-025]
---

# ARCH-021: subagent worker ignores the product's composition

## Problem

The child-process subagent worker — robota's DEFAULT subagent runner — reconstructs providers from a
hard-coded default vendor registry and rebuilds the framework default tool set, and its options offer
no seam to inject the product's provider surface or composed tools. So a product that declares custom
`IProductProfile.providerDefinitions` or contributes tools through a pack gets child-process
subagents that cannot use them, while the in-process runner passes the parent's composed surface. It
directly contradicts ARCH-006 ("every tool robota runs comes from a pack").

## Evidence (adversarially verified 2026-08-13, CONFIRMED)

- `packages/agent-subagent-runner/src/child-process-subagent-worker.ts:87-91` —
  `createProviderFromProfile(payload.providerProfile, model, createDefaultProviderDefinitions())` — a
  fixed six-vendor registry; a custom provider type throws "Unknown provider" in agent-core's
  `createProviderFromConfig`.
- `child-process-subagent-worker.ts:103` — `parentTools: createDefaultTools({ cwd })`, no sandbox/
  retrieval adapters, no pack tools.
- `IChildProcessSubagentRunnerOptions` (`child-process-subagent-runner.ts:43-52`) has no
  `providerDefinitions` or `tools` field; `providerConfig` (`:144`) only shapes the serialized
  profile, never the worker's registry; the runner receives `deps.tools` and never uses them.
- Contrast: the in-process runner passes the composed surface —
  `agent-framework/src/subagents/in-process-subagent-runner.ts:139` `parentTools: deps.tools`.
- robota wires the child-process runner as the default unconditionally (`agent-cli/src/cli.ts:277-282`);
  the shell's `providerDefinitions` seam (`command-setup.ts:99`) and pack-owned tool surface
  (`robota-profile.ts:55-60`, `robota-plumbing.ts:210`, `defaultTools: []`) are both bypassed in the
  child.
- Nuances (do not defeat the finding): `workerPath` (`SPEC.md:116`) lets a product author a wholly
  custom worker — escape requires reimplementing the worker, not an injection seam. For robota today
  the tool-surface divergence is LATENT because `pack-coding` is name-equality-tested against
  `createDefaultTools()` (`coding-pack.ts:55-60`) — it becomes user-visible the moment a pack
  contributes a tool outside that mirror or a product supplies custom packs/providers.

## Direction

**Root item: #1777.** A `finding-depth-triager` verdict of FOUNDATIONAL routed this item's cause to
its own issue: _Robota's composition contract is carried by live instances and has no projection
across a process boundary._ The owner approved re-scoping this item to be that root.

**The Direction below REPLACES the capability-broker design this file previously carried.** That
design was written when the worker was a standalone neutral module located on disk. DIST-006 (#1783,
merged 2026-08-16) changed the premise: the worker is now **robota's own entry**, re-executed with
`--__robota-subagent-worker`, so the product's profile is already compiled into the child.

**The composition contract is expressed as a RECIPE, not as instances.** A composition cannot be
projected, because it is code: `IProviderDefinition.createProvider` is a function and
`IToolWithEventService` carries `execute`. There are exactly two structurally sound responses —
project the instances (a broker) or stop expressing the contract as instances (a recipe). The recipe
wins, and not because it is smaller:

- **A broker re-breaks ARCH-010 containment.** Proxied tools execute in the PARENT, bound to the
  parent's checkout. Under worktree isolation the child's execution root is a different directory,
  so a proxied `Read`/`Write` would touch the wrong tree. The only way a broker avoids this is to
  build a fresh root-bound tool set per job in the parent — which is this design plus an IPC hop.
- **A broker's codec is misplaced.** `agent-interface-transport` is mechanically guarded to be
  runtime-inert (INFRA-035); a tagged serialization codec is runtime behaviour.
- **A broker inverts assembly ownership.** It routes the product's assembly through a neutral
  library, which `project-structure.md` § per-product assembly ownership forbids.

So: `agent-subagent-runner` declares a port, robota's composition root implements it, and the
neutral package **stops importing product defaults at all** — the `@robota-sdk/agent-provider-defaults`
dependency is removed from its manifest, so the next contributor who reaches for the default registry
does not compile. This is the sibling of the seam DIST-006 established one level down: _the only party
that knows what a product composes is that product._

**Fail closed on what the recipe cannot reproduce.** A recipe carries anything that is a pure function
of (execution root, serialized payload, ambient durable state). It cannot carry a live, unrepeatable
handle — today `ICodingPackOptions.sandboxClient`. Leaving that silent would re-create ARCH-010's
fail-open shape (sandboxed parent, host-tool child), and it is reachable with in-repo public code:
`E2BSandboxClient` and `InMemorySandboxClient` are both exported from `agent-tools`'s barrel. So the
composition root must REFUSE to select the child-process runner when it composed such a capability,
naming it. Actually projecting live capability is filed separately; it is the honest residue of #1777.

## Test Plan

> **Rewritten with the Direction.** The plan that stood here tested the **broker** — "execute through
> the parent broker", "broker handshake failure", tagged-extension round trips, cyclic/over-limit
> codec rejection. That is Alternative 1, which the approved design rejects; a breakdown written
> against it would have implemented the rejected design. Keys are the design document's TC-N.

- **TC-01** — cross-process integration in `agent-subagent-runner`: a test entry module calling
  `runSubagentWorkerMain(scratchComposition)` over a real IPC channel, with a uniquely-named tool and
  a custom `IProviderDefinition`. Red-first. This is the level at which a scratch composition is
  constructible at all — the built binary composes statically, there is no runtime pack-injection
  path, and the worker spawn forwards no user argv.
- **TC-02** — extend `packages/agent-cli/src/__tests__/e2e/subagent-worker-entry.bintest.ts` so the
  BUILT binary's worker reports robota's pack tool-name set in `ready`. Needs no model provider and no
  scratch pack, runs the real artifact, red against unfixed code.
- **TC-03** — `tsgo --noEmit` against a fixture omitting the composition argument: a required
  parameter, not optional-with-default.
- **TC-04** — a `scripts/harness/scan-*.mjs` check in `pnpm harness:scan`, alongside
  `scan-interface-runtime.mjs`: the manifest edge is gone and `src/` imports neither
  `createDefaultTools` nor `createDefaultProviderDefinitions`. This is the floor on the TOOL axis,
  which the manifest edge cannot cut (#1787).
- **TC-05** — unit: the worker composition and the parent's product composition yield the same
  tool-name set for the same `cwd`.
- **TC-06** — unit: given a pack context carrying a `sandboxClient`, the composition root refuses the
  child-process runner, naming the capability.
- **TC-07** — `pnpm harness:verify-like-ci` green.
- Regression: existing in-process subagent tool-surface parity still holds.

## User Execution Test Scenarios

**Applies** (subagents are a CLI product surface; custom packs are public SDK usage).

- Prerequisites: built CLI; a scratch product/pack that contributes a uniquely-named tool and a custom
  provider definition — authored by this work; a prompt that spawns a subagent which uses that tool.
- Steps: run the CLI (default child-process subagent runner), ask it to delegate to a subagent that
  calls the custom pack tool.
- Expected (after fix): the subagent runs on the custom provider and successfully calls the pack tool.
- Expected (before fix, contrast): the subagent cannot see the custom tool (and errors on a custom
  provider).
- Cleanup: remove the scratch pack/provider.
- Evidence (fill in after implementation): subagent transcript showing the custom tool call.

## Plan

Design document: [`.agents/spec-docs/active/ARCH-021-child-process-subagent-composition.md`](../spec-docs/active/ARCH-021-child-process-subagent-composition.md).
One task per Completion Criterion.

- [x] **TC-03** — declare `ISubagentWorkerComposition` in `agent-subagent-runner` (`createTools({ cwd })` + `readonly providerDefinitions`) and change `runSubagentWorkerMain` to take it as a **required**
      parameter; export both from the barrel.
- [x] **TC-01** — make the worker build its surface from the injected composition instead of
      `createDefaultTools` / `createDefaultProviderDefinitions`, keeping `createSubagentSession` and the
      CORE-024 / CORE-025 / ARCH-010 wiring where they are. Add the cross-process integration test.
- [x] **TC-05** — add `createRobotaSubagentComposition()` in `agent-cli/src/product/` as the single
      source resolving through `createRobotaPacks`, and wire `bin.ts`'s worker branch and `cli.ts`'s
      parent composition through it. Add the tool-name-set parity test.
- [x] **TC-04** — delete `@robota-sdk/agent-provider-defaults` from `agent-subagent-runner`'s
      `dependencies`, and add the harness scan that holds the tool axis the manifest cannot cut.
- [x] **TC-06** — make robota's parent-side pack context one named value read by both
      `createRobotaPacks` and the runner selection, and refuse the child-process runner when it carries
      a `sandboxClient`. Add the refusal test.
- [x] **TC-02** — extend the built-binary bintest so the worker reports its composed tool names in
      `ready` (Alternative 3's parity declaration), asserting robota's pack tool-name set.
- [x] Update `.agents/project-structure.md:15`, which records this package as "depends on
      agent-framework + agent-provider-defaults" — the manifest is the fact, the document is the drift.
- [x] Update `packages/agent-subagent-runner/docs/SPEC.md` for the new port and the removed dependency.
- [x] Changeset: `agent-subagent-runner` **major**, `agent-cli` patch.
- [x] **TC-07** — `pnpm harness:verify-like-ci` green.

## Blockers

- None. The approved design is `.agents/spec-docs/active/ARCH-021-child-process-subagent-composition.md`;
  GATE-APPROVAL passed 2026-08-16.

## Result

**Delivered.** The child-process subagent worker composes the PRODUCT's surface. `ISubagentWorkerComposition`
is a port declared by `agent-subagent-runner` and implemented by robota's composition root; the parameter is
**required**, because an optional one falling back to imported defaults reinstates the exact defect.

**Why a recipe, not the broker this item originally specified.** DIST-006 (#1783) changed the premise
mid-item: the worker is now robota's own entry, so the product's profile is already compiled into the child.
And a broker turned out to be _wrong_, not merely larger — proxied tools execute in the PARENT, bound to the
parent's checkout, while a worktree-isolated child's execution root is a different directory, so it would
re-break the ARCH-010 containment it was meant to honour. A prior-art sweep found **no specification that
defines a per-call working root for a proxied tool invocation**; MCP roots are session-scoped and pull-based,
and the industry answer to "N callers, N roots" is N processes. Recorded in
`.agents/spec-docs/active/ARCH-021-child-process-subagent-composition.md`, ENDORSE'd after three review rounds.

**Measured on the real artifact**, which is the point — this defect was invisible from in-package tests:

```
READY: {"type":"ready","composedToolNames":
  ["Shell","Bash","Read","Write","Edit","Glob","Grep","WebFetch","WebSearch","AskUserQuestion"]}
```

That is `pack-coding`'s surface, from the product's own packs. Breaking the recipe turns exactly that
bintest case red.

**The structural guarantee reaches one axis, stated rather than glossed.** Deleting the
`agent-provider-defaults` manifest edge makes the PROVIDER axis a compile error. The TOOL axis cannot be cut
the same way — `createDefaultTools` is barrel-exported by `agent-framework`, which this package must keep —
and that is the axis with the failure history (ARCH-010, ARCH-006). It is held by
`scan-subagent-runner-composition.mjs` instead; the cause is ARCH-035 (#1787).

**Two of my own checks could not fail, and both were caught.** The first TC-05 compared robota's parent and
child tool-name sets — but `pack-coding` is pinned by name to `createDefaultTools()`, so that comparison
passes whether the child composes from packs or from imported defaults. Replaced with a discriminating pair
(a uniquely-named pack tool must reach the child; dropping a pack must drop its tools), proved red by
restoring the old behaviour. The harness separately rejected the new scan three times: untested, hardcoded
npm scope, and unclassified fail-closed behaviour — each a reason it could have passed while measuring
nothing.

**Verification.** `pnpm harness:verify-like-ci` all 12 stages; 113 scans; `test:bin` 8/8; the composition
unit suite 8/8; the scan's own suite 6/6. Every fix red-proved against the pre-fix state.

**Filed rather than folded in:** ARCH-033 (#1784) projecting live owner-bound capability, ARCH-034 (#1785)
in-process vs child-process surface divergence, ARCH-035 (#1787) no defaults-aggregator leaf for the tool
surface, ARCH-036 (#1788) `deps.builtInAgents` dropped by the child path, SEC-009 (#1786) `apiKey` in the IPC
start payload.
