---
status: in-progress
type: API
tags: [mcp, configuration]
lane: L2
---

# MCP-001: Add a typed MCP configuration and management control plane

Paired with `.agents/tasks/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md`. Arising from [issue #2519](https://github.com/woojubb/robota/issues/2519), under initiative AGREEMENT-014 and the architecture prerequisite ARCH-1985.

## Problem

Robota has no reachable owner for an MCP server *definition*. Measured on
`integration/agreement-014@139097e83c` (2026-09-21):

- `@robota-sdk/agent-core` exports `IMCPToolConfig` and `IToolFactory.createMCPTool()`
  (`packages/agent-core/src/interfaces/tool-integration.ts:45,78`, re-exported at
  `interfaces/index.ts:167`). `grep -rn 'IToolFactory' packages/*/src apps/*/src` returns the
  declaration and its export line and nothing else: **no type in this repository implements
  `IToolFactory`**, and no caller constructs an `IMCPToolConfig`. It is an exported contract with no
  producer and no consumer.
- `packages/agent-playground/src/lib/playground/universal-tool-factory.ts:69` declares a
  same-named `createMCPTool(...)` that logs `MCPTool not available in current SDK version` and
  returns `null`. The class neither declares nor structurally satisfies `IToolFactory` (its method
  returns `null`, not `ITool`). It reads as a second MCP creation surface while being a stale stub.
- `@robota-sdk/agent-tool-mcp` (private) owns the only real MCP client-side code — an HTTP-endpoint
  tool plus the MCP-2520 activation/admission policy — but its name classifies it as one tool among
  many, and `grep -rn 'agent-tool-mcp' --include=package.json packages apps` finds **no dependent
  package**. Nothing consumes it.
- The `/mcp` command (`packages/agent-command/src/mcp-activation/`) can only see activation
  decisions, because `IMCPActivationDefinitionRegistry.list()`
  (`packages/agent-tool-mcp/src/mcp-activation-controller.ts:9`) is handed activation *requests*.
  There is no definition to list, get, or resolve, so `/mcp` cannot answer "what servers are
  configured, from where, and which entry won".

So MCP-002's SDK client, MCP-003's supervision, MCP-004's background calls and MCP-005's provider
projection have no typed configuration to stand on, and two dead contracts would become three.

**External model revalidated, not copied.** ARCH-1985 froze the configuration semantics this spec
implements. The current official Claude Code MCP documentation (https://code.claude.com/docs/en/mcp,
re-read 2026-09-21) confirms the load-bearing ones: a server is chosen whole from the
highest-precedence source and **fields are not merged across scopes**; `${VAR}` and `${VAR:-default}`
expand in `command`, `args`, `env`, `url` and `headers`; an unset variable with no default produces a
warning and the literal `${VAR}` text is preserved. One divergence is recorded rather than silently
adopted — see § Decision, "Recorded divergence".

## Prior Art Research

Waived: ARCH-1985 and ADR-005 already researched and froze this product decision (shared owner, migration boundary, precedence, side-effect ban); the current official Claude Code MCP documentation was re-read on 2026-09-21 to revalidate the external configuration model this spec implements, and its findings are recorded in Problem and Decision rather than researched again.

## Architecture Review

### Affected Scope

- `packages/agent-tool-mcp/**` → `packages/agent-mcp/**` (directory and npm identity rename; stays `private`)
- `packages/agent-mcp/src/definition/**` — new: raw/validated/resolved definitions, provenance and
  shadow metadata, strict foreign decoding, environment templates, precedence resolution, reversible
  disable overlays, redacted projections, activation identity/fingerprints
- `packages/agent-mcp/src/management/**` — new: pure management results for list/get/status
- `packages/agent-mcp/examples/verify-mcp-definition-control-plane.ts` — new: the runnable scenario
  a person executes to observe precedence, shadowing, redaction and the no-connect property
- `packages/agent-mcp/src/index.ts` — the owner's single export surface
- `packages/agent-core/src/interfaces/tool-integration.ts` — remove `IMCPToolConfig` and
  `IToolFactory.createMCPTool()`
- `packages/agent-core/src/interfaces/index.ts` — remove the `IMCPToolConfig` export
- `packages/agent-playground/src/lib/playground/universal-tool-factory.ts` — remove the stale stub
- `packages/agent-mcp/docs/SPEC.md`, `packages/agent-mcp/README.md`, `packages/agent-core/docs/SPEC.md`
- `.agents/harness.config.json`, `.agents/package-boundaries.json`, `.agents/publish-registry.md`,
  `.agents/project-structure.md` — machine-read package inventories
- `.agents/specs/architecture-map/{repository-overview,agent-system,dependency-direction,transport-architecture,capability-placement}.md`
- `.changeset/` — one changeset for the breaking `agent-core` removal

Not in scope, by ADR-005: publication, the official MCP TypeScript SDK client, any transport,
discovery, connection lifecycle, and the DAG client migration (MCP-002); stdio execution (MCP-2522).

### Alternatives Considered

ADR-005 already chose the owner and the migration boundary; these are the implementation-level
choices it left open.

1. **One `definition.ts` module owning decode → resolve → project.**
   - Pro: fewest files; the whole pipeline is read top to bottom.
   - Con: the side-effect-free property (TC-05) is then asserted over a module that also holds the
     activation types, so a later transport import would not be visibly out of place. The ban is
     easier to enforce when the pure stages are their own directory.
2. **A `definition/` directory with one module per stage, re-exported by `index.ts`.**
   - Pro: each stage is independently testable; `definition/**` can be asserted to import nothing
     from `node:child_process`, `node:net`, `undici`, or the MCP SDK, which is exactly TC-05's claim.
   - Con: more files for the same behaviour.
3. **Keep `IMCPToolConfig` as a deprecated alias re-exported from `agent-mcp`.**
   - Pro: nothing breaks for a hypothetical external consumer of the prerelease.
   - Con: ADR-005 explicitly refuses a compatibility facade, and the alias would re-create the
     "two contracts, one of them dead" state this child exists to end. There is no consumer to
     protect: the repository has none, and `agent-core`'s `IToolFactory` has no implementer.

### Decision

Alternative 2, and the ADR's removals without a facade (alternative 3 rejected).

`packages/agent-mcp` becomes the sole owner. `definition/` holds the pure pipeline, one module per
stage — `types` (raw/validated/resolved + provenance + shadow), `decode` (strict foreign
`mcpServers` decoding, fail-closed), `env-template` (`${VAR}` / `${VAR:-default}`), `precedence`
(entire-entry resolution), `overlay` (reversible disable/enable), `projection` (redacted, secret-free)
and `identity` (activation identity/fingerprint). `management/` returns pure results for list/get/status.
The existing activation modules keep their place and gain the definition registry they were written
against, so `MCPActivationController` can finally be handed real definitions.

Frozen semantics, implemented exactly as ARCH-1985 and ADR-005 state them:

- Entire-entry precedence `managed > local > project > user > plugin`; entries are never field-merged.
- A malformed or unresolved higher-precedence winner **still shadows** the lower entries and fails
  closed — the lower entry does not silently take over, because that would let a broken managed policy
  be replaced by a plugin's definition.
- `${VAR}` and `${VAR:-default}` in `command`, `args`, `env`, `url`, `headers`. An unset variable with
  no default yields a warning and preserves the literal reference.
- Parse, import, resolve, list, get and status open no socket and spawn no process.

The dependency direction stays `agent-mcp → agent-core`. `agent-framework` does not import or
re-export the private package. `agent-command` and `agent-cli` are not touched by this child beyond
what the rename requires. That split is ADR-005's, not a narrowing invented here: it assigns "the
first product-reachable HTTP vertical slice" to MCP-002, and the CLI composition additionally needs
a decision this child does not own — where a Robota MCP configuration lives on disk for each of the
five scopes. `agent-cli`'s `mcpActivationAdapter` port already exists
(`packages/agent-cli/src/startup/command-setup.ts:86`) and no production caller supplies it, so
`/mcp` answers "not available in this environment" today; this child builds the registry that port
will be handed, and MCP-002 supplies it from disk.

What a person can run *now* is therefore not `/mcp` but the package's own scenario surface — the
same one `agent-tool-mcp` already ships and which this child extends
(`pnpm --filter @robota-sdk/agent-mcp scenario:verify` after the rename; the surface itself was
proven on this tree on 2026-09-21 by running the package's current script under its current name,
`pnpm --filter @robota-sdk/agent-tool-mcp scenario:verify`, which exited 0). The scenario section below states it, and the paired Task's `automatable | 1` verdict
is the one being honoured.

**Recorded divergence (for the owner, not resolved here).** The current official Claude Code
documentation places plugin-provided servers *above* user scope ("Additional sources that override
user scope: 4. Plugin-provided servers"), while the approved contract places `plugin` last. ARCH-1985
pins the literal string `managed > local > project > user > plugin` with a mechanical assertion
(its TC-04) and was approved and merged; ADR-005 repeats it. This spec implements the approved order
and does not reopen it. The divergence is filed as [issue #2790](https://github.com/woojubb/robota/issues/2790) so the
choice is made deliberately and with the docs in hand, rather than by a spec quietly copying one
source or the other.
A second observation from the same re-read, also filed rather than adopted: Claude Code refuses to
expand credential-shaped variables (`*TOKEN*`, `*SECRET*`, `*KEY*`, …) in a remote server's `url` and
`headers`. That is a security property this control plane does not yet have, and adding it here would
widen an already large child; it is filed as
[issue #2791](https://github.com/woojubb/robota/issues/2791), to land no later than MCP-002, which
introduces the transport that would carry the leak.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `agent-tool-mcp` (the renamed owner), `agent-core`'s `IToolFactory`,
      the playground stub, `agent-command`'s `/mcp` module, and `dag-node-mcp-tool` (the second SDK
      owner ADR-005 assigns to MCP-002) were all inspected on this tree; no other MCP definition
      surface exists.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface. The
      package already exists and is renamed in place; ADR-005 owns that placement decision and
      ARCH-1985 recorded its independent review.

## Fallback & Degradation Declaration

None for resolution: a definition that cannot be decoded or whose higher-precedence winner is
malformed fails closed and is reported as unresolved, and it keeps shadowing lower entries rather
than falling back to them. The one degradation is an unset environment variable with no default,
which is a declared, warned, literal-preserving outcome rather than a substitution.

## Solution

1. `git mv packages/agent-tool-mcp packages/agent-mcp`; set `name` to `@robota-sdk/agent-mcp`,
   keeping `private: true`; update the package's own internal `--scope` script path. Update the four
   machine-read inventories and the five architecture-map documents in the same commit.
2. Add `packages/agent-mcp/src/definition/types.ts`: `IMCPServerDefinitionRaw`,
   `IMCPServerDefinition` (validated), `IMCPServerDefinitionResolved`, `IMCPDefinitionProvenance`
   (source + origin path + entry name), `IMCPDefinitionShadow` (the entries a winner shadowed), and
   the transport discriminant (`stdio` / `http` / `sse` / `ws`, with `streamable-http` accepted as an
   alias of `http`).
3. Add `definition/decode.ts`: strict decoding of a foreign `mcpServers` object. Unknown transport,
   missing `command` for stdio, missing `url` for a remote type, or a non-object entry produce a
   typed refusal carrying the entry name — never a partially built definition.
4. Add `definition/env-template.ts`: `${VAR}` and `${VAR:-default}` materialization across `command`,
   `args`, `env`, `url`, `headers`, returning the materialized value plus the list of unset
   references, each of which preserves its literal text.
5. Add `definition/precedence.ts`: group decoded entries by name, order sources
   `managed > local > project > user > plugin`, take the whole winning entry, and record every
   shadowed entry with its provenance. A winner that failed decoding or materialization is reported
   `unresolved` and still shadows.
6. Add `definition/overlay.ts`: reversible disable/enable overlays applied after precedence, so a
   disabled entry remains listed with its provenance and its disabled reason.
7. Add `definition/projection.ts`: redacted, secret-free management projections — `env` values and
   `headers` values are replaced by a redaction marker; the keys survive.
8. Add `definition/identity.ts`: a stable activation identity and fingerprint over the resolved
   entry, so MCP-2520's approval binding can name exactly one definition.
9. Add `management/results.ts` and wire `IMCPActivationDefinitionRegistry` to the resolved set, so a
   definition list is what the controller enumerates.
10. Remove `IMCPToolConfig` and `IToolFactory.createMCPTool()` from `agent-core` and its export line;
    remove the playground stub method. Add the changeset recording the breaking removal.
11. Add `examples/verify-mcp-definition-control-plane.ts` and extend the package's `scenario:verify`
    script so one command builds a five-scope fixture, resolves it, and prints the winning entries,
    what each shadowed, the redacted projection, and the count of processes and sockets opened (zero).
12. Update `packages/agent-mcp/docs/SPEC.md`, its README, and `packages/agent-core/docs/SPEC.md`.

## Affected Files

- `packages/agent-tool-mcp/**` → `packages/agent-mcp/**` (rename)
- `packages/agent-mcp/src/definition/{types,decode,env-template,precedence,overlay,projection,identity}.ts`
- `packages/agent-mcp/src/management/results.ts`
- `packages/agent-mcp/src/index.ts`
- `packages/agent-mcp/src/__tests__/definition-{precedence,env-template,decode,projection,no-side-effects,overlay,identity}.test.ts`
- `packages/agent-mcp/src/__tests__/management-results.test.ts`
- `packages/agent-mcp/examples/verify-mcp-definition-control-plane.ts`
- `packages/agent-mcp/package.json`, `docs/SPEC.md`, `README.md`
- `packages/agent-core/src/interfaces/tool-integration.ts`
- `packages/agent-core/src/interfaces/index.ts`
- `packages/agent-core/docs/SPEC.md`
- `packages/agent-playground/src/lib/playground/universal-tool-factory.ts`
- `.agents/harness.config.json`, `.agents/package-boundaries.json`, `.agents/publish-registry.md`, `.agents/project-structure.md`
- `.agents/specs/architecture-map/{repository-overview,agent-system,dependency-direction,transport-architecture,capability-placement}.md`
- `.changeset/<generated>.md`
- `.agents/spec-docs/draft/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md`
- `.agents/tasks/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run packages/agent-mcp/src/__tests__/definition-precedence.test.ts` → exits 0, and exits 1 when the source order is permuted — whole-entry precedence `managed > local > project > user > plugin`, no field merge, and a malformed winner still shadowing and reporting `unresolved`
- [ ] TC-02: `pnpm exec vitest run packages/agent-mcp/src/__tests__/definition-env-template.test.ts` → exits 0 — `${VAR}` and `${VAR:-default}` materialize in `command`, `args`, `env`, `url` and `headers`; an unset reference with no default yields a warning and the literal text survives
- [ ] TC-03: `pnpm exec vitest run packages/agent-mcp/src/__tests__/definition-decode.test.ts packages/agent-mcp/src/__tests__/definition-projection.test.ts` → exits 0 — foreign `mcpServers` decoding refuses an unknown transport, a stdio entry with no `command` and a remote entry with no `url`, each naming the entry; and a projection carries no `env` or `headers` value
- [ ] TC-04: `grep -rn 'IMCPToolConfig\|createMCPTool' packages/*/src apps/*/src` returns no hit outside `packages/agent-mcp`, and `pnpm --filter @robota-sdk/agent-core build` exits 0 — the dead contract and the playground stub are gone with no facade left behind
- [ ] TC-05: `pnpm exec vitest run packages/agent-mcp/src/__tests__/definition-no-side-effects.test.ts` → exits 0 — every module under `src/definition/` and `src/management/` is asserted to import no process, socket or MCP-SDK module, so parse/import/resolve/list/get/status cannot connect or spawn
- [ ] TC-06: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0 with `HARNESS_BASE_REF=origin/integration/agreement-014` — the rename is consistent across every machine-read inventory and architecture map
- [ ] TC-07: `pnpm --filter @robota-sdk/agent-mcp build && pnpm --filter @robota-sdk/agent-mcp test` → exits 0 — the renamed package builds and its pre-existing activation suites still pass
- [ ] TC-08: `pnpm exec tsx examples/verify-mcp-definition-control-plane.ts` from `packages/agent-mcp` → exits 0 and prints one `result=` line carrying `winner=alpha:managed`, `alphaShadowed=4`, `betaUnresolved=true`, `unsetVarPreservedLiterally=true`, `envRedacted=true`, `headersRedacted=true`, `processesSpawned=0` and `socketsOpened=0`
- [ ] TC-09: `pnpm exec vitest run packages/agent-mcp/src/__tests__/definition-overlay.test.ts` → exits 0 — a disabled entry stays listed with its provenance and a disabled reason rather than disappearing, re-enabling restores the identical resolved entry, and an overlay naming an unknown server is refused instead of silently creating one
- [ ] TC-10: `pnpm exec vitest run packages/agent-mcp/src/__tests__/definition-identity.test.ts` → exits 0 — the activation identity and fingerprint are stable across re-resolution of an unchanged entry, change when any materialized field changes, and differ between two entries that share a server name but come from different scopes
- [ ] TC-11: `pnpm exec vitest run packages/agent-mcp/src/__tests__/management-results.test.ts` → exits 0 — `list`, `get` and `status` return resolved entries with provenance and shadow records, `get` on an unknown name returns a typed not-found result rather than throwing, and `MCPActivationController` enumerates exactly the resolved set it is given through `IMCPActivationDefinitionRegistry`

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                         | Notes                                                                                 |
| ----- | ----------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| TC-01 | Unit        | `vitest run` on `definition-precedence.test.ts`                         | RED when the source order is permuted; covers shadowing and fail-closed unresolved    |
| TC-02 | Unit        | `vitest run` on `definition-env-template.test.ts`                       | Covers all five templated fields and the unset-with-no-default warning                |
| TC-03 | Unit        | `vitest run` on `definition-decode.test.ts` + `definition-projection.test.ts` | Negative decoding paths and secret-free projection                                    |
| TC-04 | Boundary    | `grep` over `packages/*/src apps/*/src` + `agent-core` build            | The removal is proven by absence, not asserted                                        |
| TC-05 | Unit        | `vitest run` on `definition-no-side-effects.test.ts`                    | Static import assertion over the pure directories — the side-effect ban made checkable |
| TC-06 | Suite       | `run-all-scans.mjs --affected --context pr`                             | Rename consistency across inventories and maps; base bound to the integration branch  |
| TC-07 | Package     | `pnpm --filter @robota-sdk/agent-mcp build && … test`                   | The renamed package still builds and its MCP-2520 suites still pass                   |
| TC-08 | Scenario    | `pnpm --filter @robota-sdk/agent-mcp scenario:verify`                   | The runnable user-execution scenario; recorded with `scenario:record`                 |
| TC-09 | Unit        | `vitest run` on `definition-overlay.test.ts`                            | Reversible disable/enable; a disabled entry stays visible; unknown-server overlay refused |
| TC-10 | Unit        | `vitest run` on `definition-identity.test.ts`                           | Fingerprint stability, change detection, and scope-distinct identities                |
| TC-11 | Unit        | `vitest run` on `management-results.test.ts`                            | Pure list/get/status results and the registry the activation controller enumerates    |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

### Scenario 1 — see which MCP definition wins, what it hid, and that nothing connected

**Surface:** the `agent-mcp` package scenario script — the same surface this package already ships
for MCP-2520 under its pre-rename name. Executability was proven before this scenario was written by
running `pnpm --filter @robota-sdk/agent-tool-mcp scenario:verify` on this tree on 2026-09-21; it
exited 0 and printed its two result lines.

**Prerequisites:** a clone of this repository with `pnpm install` completed. No network, no MCP
server, and no credentials are required — the scenario asserts that nothing is contacted.

**Steps:**

1. From `packages/agent-mcp`, run `pnpm exec tsx examples/verify-mcp-definition-control-plane.ts`
   (the package's `scenario:verify` script runs the same runner).

**Expected observable outcome:** the command exits 0 and prints, for a fixture that defines the same
server name in several scopes:

- the winning entry for each server name together with the scope it came from, following
  `managed > local > project > user > plugin`;
- the entries that winner shadowed, each with its own scope, so a hidden definition is visible rather
  than absent;
- a server whose higher-precedence winner is malformed reported as `unresolved` while still shadowing
  the lower entries — it does not silently fall through to a lower scope;
- a `${VAR}` reference with no value and no `:-default` reported as a warning with its literal text
  preserved in the output;
- a management projection in which every `env` and `headers` value is redacted while the keys remain;
- the final line `processesSpawned=0; socketsOpened=0`.

**Why this is the surface:** `/mcp` cannot yet show any of this, because the CLI port that feeds it
has no supplier until MCP-002 (see § Decision). This scenario is what a person can actually execute
today to observe the delivered behaviour, and it is recorded with
`pnpm --filter @robota-sdk/agent-mcp scenario:record`.

## Tasks

- [ ] `.agents/tasks/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md` — todo

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-21

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: three deliverables this spec's own
  § Decision and § Solution enumerate as distinct features carry no Completion Criterion and no Test Plan
  row. (a) `definition/overlay.ts` — reversible disable/enable overlays (Solution step 6; ADR-005 lists
  "reversible disable overlays" among the owner's responsibilities): no TC names disable, enable, or the
  retained provenance and disabled reason. (b) `definition/identity.ts` — the stable activation identity
  and fingerprint (Solution step 8), which the spec states MCP-2520's approval binding depends on: no TC
  asserts identity stability or fingerprint behaviour. (c) `management/results.ts` plus wiring
  `IMCPActivationDefinitionRegistry` to the resolved set (Solution step 9) — the direct fix for the
  fourth Problem symptom, verified on this tree as
  `list(): readonly IMCPActivationRequest[]` at `packages/agent-tool-mcp/src/mcp-activation-controller.ts:9`:
  no TC asserts a list/get/status result or that the controller now enumerates definitions. TC-05 names
  `src/management/` only inside the import-purity assertion, and TC-07's own text scopes
  `pnpm --filter @robota-sdk/agent-mcp build && … test` to "the renamed package builds and its
  pre-existing activation suites still pass", so neither substitutes for a behavioural criterion. TC-01
  through TC-08 contain no occurrence of "disable", "overlay", "identity", "fingerprint", or a
  list/get/status result assertion. Required: at least one criterion per distinct feature or sub-item.
  **Required action:** Add one Completion Criterion for the reversible disable/enable overlay behaviour,
  one for activation identity/fingerprint stability, and one for the management results plus
  `IMCPActivationDefinitionRegistry` wiring, add the matching `## Test Plan` rows so the TC counts stay
  equal, then re-run GATE-WRITE.

**Semantic criteria that passed:**

- GATE-WRITE — Contains a concrete symptom: PASS — four measured symptoms, each re-verified on this tree:
  `IMCPToolConfig` at `packages/agent-core/src/interfaces/tool-integration.ts:45` and
  `createMCPTool(config: IMCPToolConfig): ITool` at `:78`, exported at `interfaces/index.ts:167`;
  `grep -rn 'IToolFactory' packages/*/src apps/*/src` returns exactly the declaration
  (`tool-integration.ts:64`) and that export line, with no implementer and no `IMCPToolConfig`
  constructor; `universal-tool-factory.ts` declares `createMCPTool(...): null` logging
  `MCPTool not available in current SDK version`;
  `grep -rn 'agent-tool-mcp' --include=package.json packages apps` returns only the package's own
  `name` and `scenario:record` lines, i.e. no dependent package; and
  `IMCPActivationDefinitionRegistry.list()` returns `readonly IMCPActivationRequest[]`, not definitions.
- GATE-WRITE — Contains a reproduction condition: PASS — the Problem states when and where
  ("Measured on `integration/agreement-014@139097e83c` (2026-09-21)"; HEAD on this clone is
  `139097e83c1df1129d5210e5abd764bbbfc4a1f6`) and every symptom is bound to a re-runnable grep or an
  exact file:line, so each is independently reproducible.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision`: PASS — the section takes the
  `Waived:` route (ARCH-1985/ADR-005 already researched the product decision) and the recorded external
  re-read still reaches § Decision as evidence rather than assertion: whole-entry precedence with no
  field merge, `${VAR}` / `${VAR:-default}` across `command`/`args`/`env`/`url`/`headers`, and the
  unset-variable warning are implemented as frozen semantics, while the two findings that conflict with
  the approved contract (plugin scope placed above user scope; refusal to expand credential-shaped
  variables in remote `url`/`headers`) are named as a recorded divergence and deliberately not adopted.
  See the additional finding below on the unverifiable "filed as its own item" claim.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — alternative 2 is chosen
  over alternative 1 on a named trade-off ("more files for the same behaviour" accepted so the
  side-effect-free property of TC-05 is asserted over a directory holding only the pure stages, where a
  later transport import is visibly out of place), and alternative 3 is rejected on another (no consumer
  exists to protect, against re-creating the "two contracts, one of them dead" state).
- GATE-WRITE — New-surface placement (conditional): PASS — no new package, app, presentation or interface
  surface is introduced; `packages/agent-tool-mcp` is renamed in place to `packages/agent-mcp` and stays
  `private`. The reclassification itself is owned upstream, not self-claimed here: ADR-005
  (`.design/decisions/ADR-005-shared-mcp-owner-and-migration-boundary.md`, alternative 3, "Rename/reclassify
  private `agent-tool-mcp` to private `agent-mcp`") decides the placement, and the done spec ARCH-1985
  records the independent placement review (`New-surface placement: agent-session is the closest lower
  neutral-contract/host-adapter analog`, with `REVIEW VERDICT: ENDORSE` from an independent
  `proposal-reviewer` and a GATE-WRITE guardian line judging the same conditional PASS). Requirement (b) is
  restated in this document's own § Decision: the dependency stays `agent-mcp → agent-core`,
  `agent-framework` does not import or re-export the private package, and no sibling PRODUCT is depended
  on. Note for GATE-APPROVAL: the checklist labels this "N/A", which understates it — the accurate reading
  is "owned by ADR-005/ARCH-1985", so the independent-validation criterion at GATE-APPROVAL must be
  satisfied by that recorded review, not treated as inapplicable.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form: PASS — all eight criteria are
  Command form with an exit expectation plus a named observable: TC-01 also requires exit 1 under a
  permuted source order; TC-04 proves removal by absence of grep hits plus an `agent-core` build; TC-06
  pins `HARNESS_BASE_REF=origin/integration/agreement-014`; TC-08 names the exact printed line
  `processesSpawned=0; socketsOpened=0`. No vague phrasing appears.

**Additional findings (not the deciding criterion, to be resolved with the failure above):**

- § Decision asserts of the plugin-precedence divergence that "The divergence is filed as its own item"
  and, of the credential-shaped-variable finding, "also filed rather than adopted". Neither item exists at
  judgement time: no matching record under `.agents/tasks/` or `.agents/spec-docs/`, and no matching
  GitHub issue was found. The claim is unverifiable as written — either file the items and name them, or
  state the disposition without claiming a filing.
- § Decision cites "`pnpm --filter @robota-sdk/agent-mcp scenario:verify`, verified executable on this
  tree on 2026-09-21". No package named `@robota-sdk/agent-mcp` exists on this tree; the executable
  surface is `@robota-sdk/agent-tool-mcp` (`packages/agent-tool-mcp/package.json:40`), which is what the
  § User Execution Test Scenarios section correctly names.

**Mechanical evidence:** `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc .agents/spec-docs/draft/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md --dry-run` re-run independently by this guardian reported `27 criteria judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN` (exit 2, no entry written). The guardian judged six of the seven semantic criteria PASS and one FAIL above.

**Ordering:** GATE-WRITE is the entry gate (no prior status gate per the prior-gate map); input state verified — `status: draft`, document under `.agents/spec-docs/draft/`, `## Evidence Log` empty before this entry, and no implementation path modified (`git status --porcelain` shows only this untracked spec document).

**Judged by:** independent `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `139097e83c1df1129d5210e5abd764bbbfc4a1f6` · base `origin/integration/agreement-014@139097e83c1df1129d5210e5abd764bbbfc4a1f6` · document `.agents/spec-docs/draft/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md` blob `4c9206772de93ff62dd92388edf70c1e43f39213` (untracked before this evidence entry)

GATE VERDICT: FAIL

### [GATE-WRITE] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → review-ready

Re-run after the `❌ FAIL` entry above; judged against the corrected content, not against the earlier
judgement. Ordering: GATE-WRITE is the entry gate and has no prior status gate (prior-gate map,
`.agents/specs/gate-catalogue.md`); input state re-verified as `status: draft` under
`.agents/spec-docs/draft/`, with the one prior entry being this same gate's FAIL and none from a later
gate, and `git status --porcelain` showing only this untracked spec document — no implementation path
was touched between the two runs.

- GATE-WRITE — Contains a concrete symptom: PASS — the Problem section is unchanged from the failed run
  and its four symptoms were re-verified against this tree: `IMCPToolConfig` at
  `packages/agent-core/src/interfaces/tool-integration.ts:45` with
  `createMCPTool(config: IMCPToolConfig): ITool` at `:78`, exported at `interfaces/index.ts:167`;
  `grep -rn 'IToolFactory' packages/*/src apps/*/src` returning only the declaration (`:64`) and that
  export line, so the contract has no implementer and no caller; `universal-tool-factory.ts` declaring
  `createMCPTool(...): null` that logs `MCPTool not available in current SDK version`;
  `grep -rn 'agent-tool-mcp' --include=package.json packages apps` returning only the package's own
  `name` and `scenario:record` lines, i.e. no dependent; and `IMCPActivationDefinitionRegistry.list()`
  returning `readonly IMCPActivationRequest[]` at `packages/agent-tool-mcp/src/mcp-activation-controller.ts:9`.
- GATE-WRITE — Contains a reproduction condition: PASS — "Measured on `integration/agreement-014@139097e83c`
  (2026-09-21)"; this clone's HEAD is `139097e83c1df1129d5210e5abd764bbbfc4a1f6`, and every symptom is
  bound to a re-runnable grep or an exact `file:line`, so each is independently reproducible.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision`: PASS — the `Waived:` route is
  taken because ARCH-1985/ADR-005 own the product research, and the recorded external re-read still
  reaches § Decision as evidence: whole-entry precedence with no field merge, `${VAR}` /
  `${VAR:-default}` across `command`/`args`/`env`/`url`/`headers`, and the unset-variable warning are
  implemented as frozen semantics, while the two findings that conflict with the approved contract are
  named and deliberately not adopted. The disposition is now verifiable, which it was not at the failed
  run: `gh issue view 2790` → OPEN, created 2026-09-21T06:55:08Z, "MCP definition precedence places
  `plugin` below `user`, while the current Claude Code docs place plugin-provided servers above user
  scope", quoting the documentation passage and naming what a resolution would move; `gh issue view 2791`
  → OPEN, created 2026-09-21T06:55:23Z, "MCP environment templates expand credential-shaped variables
  into remote `url` and `headers`". Both predate this run and are cited by number in § Decision.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — unchanged and still
  explicit: alternative 2 is chosen over 1 by accepting "more files for the same behaviour" so TC-05's
  side-effect ban is asserted over a directory holding only the pure stages, where a later transport
  import is visibly out of place; alternative 3 is rejected because no consumer exists to protect and a
  facade would re-create the "two contracts, one of them dead" state.
- GATE-WRITE — New-surface placement (conditional): PASS — no new package, app, presentation or interface
  surface: `packages/agent-tool-mcp` is renamed in place to `packages/agent-mcp` and stays `private`. The
  reclassification is owned upstream rather than self-claimed — ADR-005 alternative 3 ("Rename/reclassify
  private `agent-tool-mcp` to private `agent-mcp`") decides the placement, and the done spec ARCH-1985
  records the independent review (`New-surface placement: agent-session is the closest lower
  neutral-contract/host-adapter analog`, an independent `proposal-reviewer` `REVIEW VERDICT: ENDORSE`, and
  a guardian PASS on this same conditional). Requirement (b) is restated in this document's § Decision:
  the dependency stays `agent-mcp → agent-core`, `agent-framework` does not import or re-export the
  private package, and no sibling PRODUCT is depended on. Note carried forward for GATE-APPROVAL: the
  checklist's bare "N/A" understates this — the accurate reading is "owned by ADR-005/ARCH-1985", so the
  independent-validation criterion at GATE-APPROVAL must be satisfied by that recorded review rather than
  treated as inapplicable.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS — the three gaps that failed
  the previous run are closed, and the TC count rose 8 → 11 with the Test Plan matching at 11 rows.
  `definition/overlay.ts` (Solution step 6) → TC-09: a disabled entry stays listed with its provenance and
  disabled reason, re-enabling restores the identical resolved entry, and an overlay naming an unknown
  server is refused. `definition/identity.ts` (step 8) → TC-10: the fingerprint is stable across
  re-resolution of an unchanged entry, changes when any materialized field changes, and differs between
  two entries sharing a server name across scopes. `management/results.ts` plus the
  `IMCPActivationDefinitionRegistry` wiring (step 9) → TC-11: `list`/`get`/`status` return resolved
  entries with provenance and shadow records, `get` on an unknown name returns a typed not-found instead
  of throwing, and `MCPActivationController` enumerates exactly the resolved set it is given — which is
  the direct observable for the fourth Problem symptom. Every other Solution step now maps to a criterion:
  step 1 → TC-06/TC-07, steps 2–3 → TC-03, step 4 → TC-02, step 5 → TC-01, step 7 → TC-03/TC-08,
  step 10 → TC-04, step 11 → TC-08, step 12 → TC-06's scan suite. Non-blocking observation: the
  `streamable-http`-as-`http` alias named in step 2 is a field-level detail inside the decode feature that
  TC-03 covers, not an uncovered feature.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form: PASS — all 11 criteria are
  Command form with an exit expectation plus a named observable, including the three new ones
  (`pnpm exec vitest run …/definition-overlay.test.ts`, `…/definition-identity.test.ts`,
  `…/management-results.test.ts`, each "→ exits 0" followed by the behaviours listed above). TC-01 also
  requires exit 1 under a permuted source order, TC-04 proves removal by absence of grep hits plus an
  `agent-core` build, TC-06 pins `HARNESS_BASE_REF=origin/integration/agreement-014`, and TC-08 names the
  exact printed line `processesSpawned=0; socketsOpened=0`. No vague phrasing appears.

**Prior additional findings, both closed:** the "filed as its own item" claims are now real, cited open
issues (#2790, #2791, verified above); and the § Decision scenario sentence no longer claims the
post-rename command was run — it states the surface was proven under the current name, which this
guardian executed with an isolated `HOME`:
`pnpm --filter @robota-sdk/agent-tool-mcp scenario:verify` → exit 0, printing exactly the two result
lines `result=status=untrusted; activationAttempts=0` and
`result=approved=true; changedDefinitionDenied=true; revokedDenied=true; activationAttempts=1`.

**Mechanical evidence:** `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc .agents/spec-docs/draft/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md --dry-run`, re-run independently by this guardian on the corrected content, reported `27 criteria judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN` (exit 2, no entry written), including `11 criteria, all TC-NN prefixed`, `11 Test Plan rows = 11 TC criteria`, and `## Evidence Log present with 1 prior entry (none from a later gate)`. The guardian judged all seven semantic criteria PASS above.

**Judged by:** independent `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `139097e83c1df1129d5210e5abd764bbbfc4a1f6` · base `origin/integration/agreement-014@139097e83c1df1129d5210e5abd764bbbfc4a1f6` · document `.agents/spec-docs/draft/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md` blob `554d4fe75ec2e086042a63874740e86d32f6d8dc` (untracked before this evidence entry)

GATE VERDICT: PASS

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함"
**Given:** 2026-09-21, this conversation
**Review fingerprint:** 4e8ef5aace9b (review faf15963, type/tags 86a3438e)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-21, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (4e8ef5aace9b) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `139097e83c1d` · base `origin/develop@24a646101a00` · document `.agents/spec-docs/backlog/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md` blob `fe05d75122da` (untracked)

**Semantic criteria (guardian):**

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the
  recorded instruction is `"승인함"`, which is the catalogue's own first example of explicit approval
  ("승인") and not a clarifying-question answer, silence, or a non-objection. It is directed at THIS
  document: it was given in direct reply to a message that summarised this document's § Decision in five
  numbered points (the atomic `packages/agent-tool-mcp` → `packages/agent-mcp` rename, the new
  `src/definition/` pure pipeline and `src/management/` results, the removal of `agent-core`'s
  `IMCPToolConfig` and `IToolFactory.createMCPTool()` with no facade plus the playground stub, the eleven
  completion criteria, and the deferral of the `/mcp` CLI wiring to MCP-002) and that stated why Route
  DIRECT was required. Corroborated on the tree rather than taken on assertion: the `**Review
  fingerprint:** 4e8ef5aace9b` recorded at approval equals the document's current fingerprint, so the
  approval attaches to this content; the working tree contains exactly one spec document
  (`git status --porcelain` → only this untracked file), and the only other `review-ready` documents in
  `.agents/spec-docs/backlog/` (HARNESS-125, RULE-015) were last touched on 2026-08-29, so no second spec
  was in play in this session. This is Route DIRECT, not a relay: the instruction is recorded verbatim
  with its date and session, not reported from another document or session.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — the recorded route is
  `DIRECT`, so no delegated class is claimed and this Route CLASS criterion does not apply. Verified
  rather than assumed that no class could have covered it: `backlog-execution.md` § Delegated Approval
  Classes holds exactly two rows — `LANE-L0-L1` (this document declares `lane: L2` in frontmatter, so it
  is outside) and `BACKLOG-ZERO-MIGRATION` (documentation-only; it excludes package/app source and
  APIs/contracts, while this item renames a package and removes an exported `agent-core` contract, which
  is also exclusion 2, "a published or externally visible contract", never inside any class).
- GATE-APPROVAL — Independent architecture validation (conditional): PASS — judged APPLICABLE, not N/A.
  The Architecture Review checklist labels the placement "N/A"; the accurate reading (and the note the
  GATE-WRITE guardian carried forward) is that this spec executes a product-family reclassification whose
  placement decision is owned upstream — ADR-005 alternative 3 is literally titled "Rename/reclassify
  private `agent-tool-mcp` to private `agent-mcp` in MCP-001"
  (`.design/decisions/ADR-005-shared-mcp-owner-and-migration-boundary.md:39`, decision at `:54-64`,
  the `agent-core` removal with "no compatibility facade is retained" at `:61-62`; committed as
  `9a5ebf8ed`/`432275d73`). The required independent verdict exists and was read by this guardian in the
  merged, `done` parent spec
  `.agents/spec-docs/done/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md`:
  "Final product review: `REVIEW VERDICT: ENDORSE` … it validated the lower product family,
  `agent-session` analog, acyclic sibling-consumer graph, independent server direction, and no-spawn
  degradation barrier" (`:144-146`), a second independent planning-shape `REVIEW VERDICT: ENDORSE`
  (`:147-149`), the checklist line "New-surface placement: `agent-session` is the closest lower
  neutral-contract/host-adapter analog; `agent-mcp` depends on shared core, while CLI and DAG are sibling
  consumers" (`:165-167`), and that document's own GATE-APPROVAL guardian line recording the same
  `proposal-reviewer` ENDORSE (`:343-348`). That review covers both checks
  `spec-workflow.md` § New-Surface Architecture Placement (3) requires: (1) the mirrored analog
  (`agent-session`, lower neutral-contract/host-adapter family) and (2) reuse at the shared contract/core
  level (`agent-mcp → agent-core`, with `agent-cli` and `dag-node-mcp-tool` as sibling consumers and no
  dependency on a sibling PRODUCT) — restated in this document's § Decision. This child adds no placement
  the parent did not review: every module it introduces (`definition/` types, decode, env-template,
  precedence, overlay, projection, identity; `management/` results) is enumerated verbatim in ADR-005's
  decision as the owner's responsibilities, and `definition/`+`management/` are internal directories of
  that same private package, not a new package, app, or presentation/interface surface. The clause
  "retain an `architecture-audit-fanout` structure-channel result … when the surface is new" is therefore
  N/A: no surface is new — `packages/agent-tool-mcp` is renamed in place by `git mv` and stays `private`.
  This is a recorded, independently-authored ENDORSE covering the placement, verified in the tree, not a
  bare "reviewed" claim (contrast STRUCT-012, failed on this criterion because its verdict existed only
  in an orchestrator scratchpad).

**Ordering (guardian):** prior gate GATE-WRITE shows `✅ PASS | 2026-09-21` with
`**Status upgrade:** draft → review-ready`, whose `Y` equals this document's current `status: review-ready`
— the `recorded-pass` re-run rule this row declares in the prior-gate map. Input state matches: frontmatter
`status: review-ready` and the file sits in `.agents/spec-docs/backlog/`, the folder `spec-workflow.md`
§ Spec-Document Status and Lifecycle Folders maps that status to. No implementation path is modified —
`git status --porcelain` shows only this untracked spec document, so nothing this gate authorizes has
already happened.

**Mechanical evidence (re-run by this guardian):**
`node scripts/harness/gate.mjs judge --gate GATE-APPROVAL --doc .agents/spec-docs/backlog/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md --lane L2 --dry-run`
→ `9 criteria judged — 6 PASS, 0 FAIL, 3 PENDING-GUARDIAN`, including the ordering line
"prior gate GATE-WRITE PASS and status `review-ready`" and the fingerprint line. Entry form re-verified:
`node scripts/harness/scan-standing-delegation-evidence.mjs` → exit 0
(`406 approved spec document(s); 137 DIRECT, 51 CLASS …`), so this DIRECT entry parses.

**Semantic judged by:** independent `backlog-gate-guard` evaluator
**Semantic judged at:** HEAD `139097e83c1df1129d5210e5abd764bbbfc4a1f6` · base `origin/develop@24a646101a00ab24610b94faadf00ed1822faeca` · document `.agents/spec-docs/backlog/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md` pre-evidence blob `5873f97127ac16a73c5da5cf7947b85bb1f0e051` (untracked)

GATE VERDICT: PASS

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-21

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-21; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (11)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 239 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md",
  "specPath": ".agents/spec-docs/todo/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    },
    {
      "kind": "tc-id",
      "value": "TC-09"
    },
    {
      "kind": "tc-id",
      "value": "TC-10"
    },
    {
      "kind": "tc-id",
      "value": "TC-11"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 1
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md",
    ".agents/tasks/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `139097e83c1d` · base `origin/develop@24a646101a00` · document `.agents/spec-docs/todo/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md` blob `342b1615c040` (untracked)
