---
status: done
type: INFRA
tags: [provider, dag-nodes, dip, skill]
parent: ARCH-PROVIDER-001
---

# ARCH-PROVIDER-005: Stage D — Skill execution port (invert dag-node-skill → agent-framework)

Parent design: [ARCH-PROVIDER-001](../todo/ARCH-PROVIDER-001-provider-dip-architecture.md) (ENDORSED).
Predecessors: Stage A/B/C done (provider split, LLM-node collapse, node-registry injection). Stage C
established the `dag-nodes-default` composition aggregator; Stage D uses it as the injection root for the
skill port.

## Problem

`@robota-sdk/dag-node-skill` — a DAG **leaf** node — statically imports the CONCRETE `SkillCommandSource` +
`executeSkill` from `@robota-sdk/agent-framework`, the **top assembly layer** (`skill/src/runtime-core.ts:1`),
and declares `agent-framework` as a production dependency. This is the ARL-11 **skill-half** leaf breach: the
most-stable layer (a node leaf) is coupled to the least-stable, highest package in the stack. It also inverts
the intended dependency direction — a leaf reaching up into the assembly.

The node ALREADY has a partial injection seam (`ISkillResolverOptions.loadCommands` / `executeSkillFn`), but it
defaults to — and takes the `typeof` of — the concrete `agent-framework` symbols, so the static leaf→assembly
edge remains (both a value import for the defaults and a type import for `typeof executeSkill`).

(Scope note: `@robota-sdk/dag-node-tool` depends on `@robota-sdk/agent-tools` + `agent-core` — a stable LOWER
tools layer, NOT the top assembly, and NOT a `dag-node-*` sibling — so `checkDagNodesLeaf` does not flag it and
ARL-11 never listed it. Inverting the tool node is out of scope for Stage D; see Alternatives.)

The parent's Stage D closes this: introduce an **owned execution port** (contract), have `dag-node-skill`
depend on the contract instead of `agent-framework`, and inject the concrete `agent-framework`-backed
implementation **at the composition root** (`dag-nodes-default`), moving the fan-out above the leaf layer.
Closes ARL-11 skill-half.

## Architecture Review

### Affected Scope

- **`packages/agent-interface-transport`** (contracts-only, already owns `ICommand`) — add the port interface
  `ISkillExecutionPort` (+ its result type):
  - `loadCommands(cwd: string, home?: string): ICommand[]` — skill discovery.
  - `resolveSkill(skill: ICommand, args: string, opts?: { sessionId?: string }): Promise<ISkillResolutionResult>`
    where `ISkillResolutionResult = { prompt?: string; mode: string }`. **Named `ISkillResolutionResult`
    (NOT `ISkillExecutionResult`)** to avoid colliding with `agent-framework`'s existing
    `ISkillExecutionResult` (`skill-executor.ts:36`); this port result is the **SSOT** the node's internal
    `ISkillResolveResult` derives from (one owner of the `{prompt?, mode}` contract, not three copies).
    The port **hides the executeSkill callbacks** the node never uses (the node always passes `{}`; fork is
    rejected before resolution, and the empty-shell inject path strips shell interpolations rather than
    throwing — verified), so the contract stays agent-framework-free. This package is the correct home: it is
    contracts-only, already hosts equivalent behavioral service ports (`ICommandSource.getCommands`,
    `ICommandPluginAdapter`), already depends only on `agent-core`, and BOTH the consumer (`dag-node-skill`)
    and the implementer (`agent-framework`) already depend on it — no new package, no new edge, no cycle.
- **`packages/agent-framework`** — export a thin adapter `createSkillExecutionPort(): ISkillExecutionPort`
  backed by `new SkillCommandSource(cwd, home).getCommands()` + `executeSkill(skill, args, {}, opts)`. This is
  the single concrete implementation; it stays in `agent-framework` (which owns `SkillCommandSource` /
  `executeSkill`).
- **`packages/dag-nodes/skill`** — `SkillResolverRuntime` / `SkillNodeDefinition` take a **required** injected
  `ISkillExecutionPort` (via `ISkillNodeDefinitionOptions.skillPort`); use `port.loadCommands` /
  `port.resolveSkill`; replace the `loadCommands?`/`executeSkillFn?` options with the port; DROP the static
  `agent-framework` import + the `@robota-sdk/agent-framework` production dependency; keep
  `@robota-sdk/agent-interface-transport` (now also the port's home) + `dag-core` + `dag-node`. No default →
  the concrete is always injected (parent: "executeSkill injected at the root"). **Remove (or re-signature to
  require `skillPort`) the in-package `createSkillNodeDefinition()` no-arg factory (`src/index.ts:125`)** — a
  required port makes a no-arg factory invalid; it has no external consumers (only the package test).
- **`packages/dag-nodes-default`** (composition root, Stage C) — the skill entry needs a **bespoke lazy
  loader branch** (it cannot use the uniform `(mod) => new X()` factory, because the port comes from a
  DIFFERENT package): it dynamically imports BOTH `@robota-sdk/dag-node-skill` and `@robota-sdk/agent-framework`,
  builds `createSkillExecutionPort()`, and constructs `new SkillNodeDefinition({ skillPort })`.
  `dag-nodes-default` gains `agent-framework` as an `optionalDependency` (the coupling moves UP from the leaf
  to the aggregator — the ARL-11 remediation). **Graceful-skip now keys on `agent-framework` presence**: since
  `dag-node-skill` no longer depends on `agent-framework`, `import('@robota-sdk/dag-node-skill')` can succeed
  while `agent-framework` is absent — so the try/catch that skips the skill node must wrap the
  `agent-framework` import in the bespoke branch, not the node import.
- **Guard**: `checkDagNodesLeaf` continues to hold for `dag-node-skill` (now depends on no `dag-node-*` sibling
  and no top-assembly package). No rule forbids `dag-nodes-default → agent-framework` (the leaf-scan keys on
  the singular `dag-node-` prefix and does not scan the plural aggregator; `agent-framework` has zero `dag-*`
  deps so no cycle; `dag-cli` already depends on `agent-framework`).

### Alternatives Considered

1. **Keep the partial seam; lazy-import the agent-framework defaults inside `dag-node-skill`.** Removes the
   STATIC edge but keeps `dag-node-skill → agent-framework` as a production (optional) dependency and a runtime
   coupling in the leaf. Rejected: the parent wants the concrete OWNED by the assembly and INJECTED at the
   root, not lazy-loaded inside the leaf; a leaf should not reference the top assembly at all.
2. **Owned port in `agent-interface-transport` + inject the agent-framework impl at the `dag-nodes-default`
   root (chosen).** The leaf depends only on the contract; the single concrete lives in `agent-framework`; the
   aggregator wires them. Adding a skill backend = implementing the port. Matches the parent + the Stage-A/B/C
   DIP pattern (contract down, concrete injected at the composition root).
3. **New `agent-interface-skill` package for the port.** Cleaner separation of concern, but a whole package for
   one interface when `agent-interface-transport` already owns `ICommand` + command-execution contracts and is
   already depended on by both sides. Rejected as unnecessary package overhead; revisit only if the skill
   contract grows.
4. **Also invert `dag-node-tool → agent-tools`.** Out of scope: `agent-tools` is a stable lower layer (not the
   top assembly, not a node sibling), `checkDagNodesLeaf` does not flag it, and ARL-11 never listed it.
   Forcing tool-constructor injection would be churn without a code-justified breach. Deferred.

### Decision

**Alternative 2.** Define `ISkillExecutionPort` in `agent-interface-transport`; `agent-framework` exports a thin
`createSkillExecutionPort()` adapter; `dag-node-skill` depends on the port (drops `agent-framework`); the
`dag-nodes-default` skill loader injects the agent-framework port (coupling moves above the leaf). Closes ARL-11
skill-half. Tool node deferred (Alt 4). Sub-sequence green per commit.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-interface-transport (port), agent-framework (adapter), dag-node-skill (invert), dag-nodes-default (inject), harness (leaf-scan holds)
- [x] Sibling scan 완료 — construction sites: the `dag-nodes-default` optional loader (external), the package's own `createSkillNodeDefinition()` factory (`skill/src/index.ts:125`, removed here), and the test; `SkillCommandSource`/`executeSkill` are agent-framework-owned; the node has a `loadCommands`/`executeSkillFn` seam but tests inject ONLY `loadCommands` (real `executeSkill` runs)
- [x] 대안 최소 2개 검토 완료 — 4개 (lazy-in-leaf / port+inject / new-interface-package / also-tool)
- [x] 결정 근거 문서화 완료 — contract in the package both sides already depend on; concrete owned by the assembly, injected at the aggregator; no new package/edge/cycle

## Solution (sub-sequenced, each commit green)

1. **Port (agent-interface-transport)** — add `ISkillExecutionPort` + `ISkillResolutionResult` (the SSOT
   `{prompt?, mode}` contract). Additive; no consumer change yet.
2. **Adapter (agent-framework)** — export `createSkillExecutionPort()` implementing the port over
   `SkillCommandSource` + `executeSkill`. Unit-tested **against the real prompt shape** (XML wrap +
   `$ARGUMENTS` substitution + empty-shell strip) — this test HOLDS the inject-prompt coverage that TC-03's
   stub-port rewrite removes from the node.
3. **Invert the leaf (dag-node-skill)** — `SkillResolverRuntime`/`SkillNodeDefinition` take a required
   `skillPort: ISkillExecutionPort`; replace the `loadCommands`/`executeSkillFn` options with `port` calls;
   the internal `ISkillResolveResult` derives from the port's `ISkillResolutionResult`; drop the agent-framework
   import + dep; **remove/re-signature the `createSkillNodeDefinition()` no-arg factory**; rewrite tests to
   inject a stub port.
4. **Inject at the root (dag-nodes-default)** — add a **bespoke skill loader branch**: dynamically import
   `dag-node-skill` + `agent-framework`, build `createSkillExecutionPort()`, `new SkillNodeDefinition({
skillPort })`; add `agent-framework` as an `optionalDependency`; the try/catch graceful-skip wraps the
   **agent-framework** import (not the node import).
5. **Verify + gate** — full harness:scan (leaf-scan + entry-point-only stay green) + harness:test + typecheck +
   changeset; GATE-VERIFY/COMPLETE; update ARL-11 (skill-half resolved; tool node explicitly scoped out).

## Affected Files

- `packages/agent-interface-transport/src/**` (new `ISkillExecutionPort`; export; SPEC public-API table)
- `packages/agent-framework/src/**` (new `createSkillExecutionPort` adapter + export + test; SPEC)
- `packages/dag-nodes/skill/src/{runtime-core.ts,index.ts}` (incl. removing/re-signaturing the
  `createSkillNodeDefinition()` factory at `index.ts:125`) + `src/index.test.ts`; `packages/dag-nodes/skill/package.json` (drop agent-framework); skill SPEC public-API
- `packages/dag-nodes-default/src/index.ts` (inject port in the skill loader) + `package.json` (add agent-framework optional)
- `.agents/architecture-remediation-log.md` (ARL-11 skill-half resolved; tool node explicitly scoped out)
- changeset

## Completion Criteria

- [x] TC-01: `ISkillExecutionPort` is defined in `agent-interface-transport` (contracts-only) and exported;
      `dag-node-skill` imports the port from there and has **no** `@robota-sdk/agent-framework` dependency
      (package.json + no static import) — asserted by inspection + `check-dependency-direction` green.
- [x] TC-02: `agent-framework` exports `createSkillExecutionPort()` returning an `ISkillExecutionPort` whose
      `loadCommands`/`resolveSkill` delegate to `SkillCommandSource`/`executeSkill`, and whose `resolveSkill`
      produces the **actual inject-prompt shape** (XML wrap + `$ARGUMENTS` substitution + empty-shell strip) —
      NOT mere delegation. This test RELOCATES the real-`executeSkill` coverage that the node's tests hold today
      (see premise correction) and TC-03 drops.
- [x] TC-03: `SkillNodeDefinition`/`SkillResolverRuntime` require an injected `skillPort` and resolve an
      inject-mode skill through it (discovery → not-found → fork-reject → inject-resolve paths preserved),
      asserted with a **stub port** (no agent-framework, no shell, no real skill I/O). Note: today's node tests
      inject only `loadCommands` and exercise the REAL `executeSkill` — that coverage relocates to TC-02.
- [x] TC-04: `dag-nodes-default`'s skill loader injects the agent-framework-backed port; the default catalog
      still includes a functional `skill` node (integration), and the graceful-skip path holds when the skill
      node/agent-framework is absent.
- [x] TC-05: `checkDagNodesLeaf` + `entry-point-only` stay green; `dag-node-skill` depends on no top-assembly
      package and no `dag-node-*` sibling; `dag-nodes-default → agent-framework` is a sanctioned aggregator edge.
- [x] TC-06: full `pnpm harness:scan` + `pnpm harness:test` + full-repo `pnpm typecheck` 0; changeset present;
      affected suites green (agent-interface-transport, agent-framework, dag-node-skill, dag-nodes-default, dag-cli).

## Test Plan

Unit-test the port adapter in agent-framework (TC-02) asserting the real inject-prompt shape (XML wrap +
`$ARGUMENTS` substitution + empty-shell strip). Rewrite the dag-node-skill tests to inject a stub
`ISkillExecutionPort` (TC-03): today they inject only `loadCommands` and assert the REAL `executeSkill` output,
so this is NOT a mere shape change — the real-executeSkill coverage RELOCATES to TC-02's adapter test, and TC-03
asserts the node's routing (discovery/not-found/fork-reject/inject) over a stub port. Integration:
`dag-nodes-default` default catalog includes a working
skill node via the injected port (TC-04). Harness leaf-scan + entry-point-only + deps green (TC-05). Full
harness:scan + harness:test + typecheck + changeset (TC-06). RED→GREEN per sub-sequence step.

## Resolved Questions (GATE-APPROVAL round 1)

1. **Port home** — RESOLVED: `agent-interface-transport` (contracts-only, already hosts behavioral service
   ports `ICommandSource.getCommands`/`ICommandPluginAdapter`, deps only `agent-core`, both sides already
   depend on it). Consumer-owned would force `agent-framework → dag-node-skill` (worse); a new package is
   unjustified overhead.
2. **`dag-nodes-default → agent-framework`** — RESOLVED: no rule forbids it; `agent-framework` has zero `dag-*`
   deps (no cycle); the leaf-scan keys on the singular `dag-node-` prefix (aggregator not scanned); `dag-cli`
   already depends on `agent-framework`.
3. **Required `skillPort`** — RESOLVED: required (matches "injected at the root"). Construction sites: the
   dag-nodes-default loader (external) + the in-package `createSkillNodeDefinition()` factory (removed) + the
   test. No other `new SkillNodeDefinition` in the repo.
4. **Graceful-skip trigger** — RESOLVED: must key on `agent-framework` presence in the bespoke loader branch
   (the node import now succeeds without agent-framework).
5. **Result-type SSOT** — RESOLVED: port result named `ISkillResolutionResult` (avoids `agent-framework`'s
   `ISkillExecutionResult` collision); it is the SSOT the node's `ISkillResolveResult` derives from.

## Tasks

- [x] Step 1 — agent-interface-transport: add `ISkillExecutionPort` + `ISkillResolutionResult` (+ export, SPEC).
- [x] Step 2 — agent-framework: `createSkillExecutionPort()` adapter (+ export) + test asserting real inject-prompt shape.
- [x] Step 3 — dag-node-skill: require injected `skillPort`; port calls; remove `createSkillNodeDefinition()`; drop agent-framework dep; rewrite tests to stub port.
- [x] Step 4 — dag-nodes-default: bespoke skill loader branch (dynamic agent-framework import → port); optional agent-framework dep; graceful-skip on agent-framework.
- [x] Step 5 — verify (harness:scan + harness:test + typecheck + changeset) + GATE-VERIFY/COMPLETE + ARL-11 update.

## Evidence Log

- 2026-07-10 GATE-DRAFT — authored from ARCH-PROVIDER-001 Stage D. Premises verified against code:
  `dag-node-skill/src/runtime-core.ts:1` statically imports `SkillCommandSource`+`executeSkill` from
  `agent-framework`; `dag-node-skill/package.json` deps include `agent-framework`; the injection seam
  (`loadCommands`/`executeSkillFn`) exists but defaults to the concretes; the sole `SkillNodeDefinition`
  constructor is `dag-nodes-default`'s optional loader; `agent-interface-transport` is contracts-only, owns
  `ICommand`, deps only `agent-core`, and both `dag-node-skill` and `agent-framework` already depend on it;
  `dag-node-tool → agent-tools` is a lower-layer edge the leaf-scan does not flag (out of scope). Pending
  proposal-reviewer ENDORSE.
- 2026-07-10 GATE-APPROVAL round 1 — proposal-reviewer **REVISE** (direction/Alt-2 endorsed; premises verified,
  one false + 4 plan gaps folded in). (1) **False premise corrected**: the node tests inject ONLY `loadCommands`
  and assert the REAL `executeSkill` output (XML wrap + `$ARGUMENTS`), so TC-03's stub-port rewrite REMOVES that
  coverage — TC-02's adapter test now asserts the actual inject-prompt shape (relocated coverage). (2)
  `createSkillNodeDefinition()` no-arg factory (`skill/src/index.ts:125`) is a second construction path invalid
  under required injection — removed/re-signatured, added to Affected Files. (3) The skill loader needs a
  **bespoke branch** (port from a different package) dynamically importing `agent-framework`; **graceful-skip
  keys on agent-framework presence** (the node import now succeeds without it). (4) Result type renamed
  `ISkillResolutionResult` (avoids collision with agent-framework's `ISkillExecutionResult`) and made the SSOT.
  (5) ARL-11 must explicitly scope the **tool** node OUT (agent-tools = stable lower layer, not flagged) so the
  remainder reads closed. All confirmed against code (no cycle: agent-framework has zero dag-\* deps; empty-shell
  inject strips rather than throws). Revised → re-review.
- 2026-07-10 GATE-APPROVAL round 2 — proposal-reviewer **ENDORSE**. All five round-1 corrections verified
  complete + code-grounded: relocated coverage (node tests inject only `loadCommands`, assert real
  `executeSkill`; TC-02 now asserts prompt shape); `createSkillNodeDefinition()` factory removal; bespoke loader
  branch + graceful-skip on agent-framework; `ISkillResolutionResult` name (no collision with agent-framework's
  `ISkillExecutionResult`; SSOT); ARL-11 tool-scoped-out. No new inconsistency, no cycle. Design APPROVED →
  implement (5-step sub-sequence). Spec → active.
- 2026-07-10 GATE-IMPLEMENT — Step 1 `ISkillExecutionPort`+`ISkillResolutionResult` added to
  agent-interface-transport (exported). Step 2 `createSkillExecutionPort()` adapter in agent-framework +
  test asserting the real inject-prompt shape (XML wrap + `$ARGUMENTS` + empty-shell strip). Step 3
  dag-node-skill requires injected `skillPort`, uses `port.loadCommands`/`resolveSkill`, dropped the
  agent-framework import + dependency, removed the `createSkillNodeDefinition()` factory, tests rewritten to a
  stub port. Step 4 dag-nodes-default bespoke skill loader. **Deviation from the plan (Rolldown constraint):**
  the plan called for a _dynamic_ `import('@robota-sdk/agent-framework')` (optional dep). That panics Rolldown
  when `agent-cli` bundles the whole workspace (INFRA-028) — agent-framework is ALSO statically bundled, and the
  mixed static+dynamic import of one module leaves a symbol "not in any chunk". Fixed by importing
  `createSkillExecutionPort` **statically** (agent-framework is a REGULAR dependency of the dag-nodes-default
  aggregator); the `dag-node-skill` NODE stays a dynamic optional import so its graceful-skip is preserved.
  ARL-11's "coupling above the leaf" goal is still met (the aggregator, not the leaf, depends on agent-framework);
  the skill-node graceful-skip keys on the dag-node-skill import (TC-04 adjusted).
- 2026-07-10 GATE-VERIFY — agent-interface-transport 10, agent-framework **1048** (incl. the adapter
  inject-prompt test), dag-node-skill 13 (stub-port), dag-nodes-default 13 (skill node present via injected
  port), dag-cli 1007; **agent-cli bundles green** (Rolldown panic fixed); full `pnpm build`; `pnpm harness:scan`
  **49/49** (deps/leaf/entry-point/spec-public-surface); `pnpm harness:test` 298; full-repo `pnpm typecheck` 0.
  `dag-node-skill` has NO `agent-framework` dependency (package.json + no import — only design-doc comments
  mention it); `check-dependency-direction` green. TC-01..06 met.
- 2026-07-10 GATE-COMPLETE — Stage D done: the DAG skill leaf depends on the `ISkillExecutionPort` contract,
  not on the agent-framework assembly; the concrete is injected at the dag-nodes-default root. **ARL-11 fully
  resolved** (skill-half here; node→node half in Stage B; tool node explicitly scoped out). Spec → done. Stage
  E (husk + policy cleanup) remains per ARCH-PROVIDER-001.
