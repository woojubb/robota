---
status: in-progress
type: AGREEMENT
tags: [typescript, async, cli, websocket]
---

# AGREEMENT-002: Complete the 2026-08-13 agent architecture findings

## Problem

Fourteen architecture Task records created on 2026-08-13 remain open: ARCH-014 through ARCH-018 and
ARCH-020 through ARCH-028. They identify reachable data-loss, replay-corruption, dead-injection,
composition-bypass, event-delivery, package-boundary, and contract-projection defects across the
`packages/agent-*` stack. The defects are individually evidenced, but they are not children of the
older AGREEMENT-001 initiative and therefore have no approved integration order or assembled
completion gate.

The reproduction condition is the current `origin/develop` tree on 2026-08-15. Listing active
`.agents/tasks/ARCH-*.md` records with `created: 2026-08-13` yields exactly the fourteen named records;
their frontmatter is non-terminal, and the code paths cited by each record remain the acceptance
baseline until that item's recommendation gate revalidates them against the current source.

## Prior Art Research

Research was scoped to ARCH-021's cross-process capability question; the other thirteen children are
internal conformance repairs whose direction is determined by Robota's existing contracts.

### References consulted

- [Node.js v22.14.0 child-process IPC](https://nodejs.org/download/release/v22.14.0/docs/api/child_process.html#subprocesssendmessage-sendhandle-options-callback)
  documents serialized messages rather than live JavaScript identity. Default serialization is JSON;
  advanced serialization remains structured-clone based. `send()` may fail or backpressure, and its
  callback confirms sending rather than peer execution.
- [Node.js child-process lifecycle](https://nodejs.org/download/release/v22.14.0/docs/api/child_process.html#event-disconnect)
  makes disconnect terminal for IPC and warns that overlapping `error`/`exit` signals require
  settle-once handling.
- [JSON-RPC 2.0](https://www.jsonrpc.org/specification) correlates concurrent request/response pairs by
  ID and keeps success, protocol error, and notification semantics distinct.
- [Language Server Protocol 3.17 cancellation](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#cancelRequest)
  and progress conventions correlate cancellation and partial results with active request IDs and
  require terminal settlement so work does not hang.
- [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
  [cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation),
  [progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress), and
  [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) establish capability
  negotiation, configurable and hard timeouts, cooperative cancellation, correlated streaming/progress,
  and descriptor-based tool invocation with protocol failures separate from tool-domain results.

No public product documentation was found for transferring arbitrary live TypeScript provider/tool
instances into a Node child. The normative IPC/RPC documents above establish the relevant constraint:
a process boundary is a message boundary, so closures, methods, identity, injected ports, and live
credentials must be reconstructed from data or represented by remote proxies. Common designs advertise
serializable capability descriptors, correlate concurrent operations by IDs, tie stream/progress and
cancellation to the active request, settle once on overlapping disconnect/error/exit signals, and keep
domain failures distinct from protocol failures.

Robota's composed `IProviderDefinition.createProvider`, provider methods, `IToolWithEventService`
instances, callbacks, `AbortSignal`, and parent-owned service ports are executable/stateful values and
cannot enter the JSON start payload. The parent already owns the exact composed provider/tools used by
the in-process runner, so a worker that rebuilds defaults violates composition. Child allowlists and
permission checks must run before broker invocation, while the parent independently rejects a capability
not advertised for that job. Provider/tool lifecycle remains parent-owned; a child must not dispose a
shared instance. Custom worker paths require an explicit versioned handshake and may never trigger an
implicit default-composition fallback.

Three placement alternatives follow from that evidence:

1. Send live provider/tool values in the start payload. Pro: superficially preserves the in-process API.
   Con: impossible under Node IPC serialization because methods, closures, injected ports, and identity do
   not cross. Rejected.
2. Send a module specifier and rebuild product composition in the worker. Pro: avoids per-call IPC.
   Con: requires every product/test capability to be packaged for child loading, duplicates composition
   and credentials, and cannot preserve arbitrary live closures or adapters. Retained only as an explicit
   specialized custom-worker mode, not the built-in solution.
3. Keep live capabilities in the parent and expose a correlated broker. Pro: preserves the exact composed
   provider, pack tools, state, and test doubles while keeping the worker product-neutral. Con: adds IPC
   latency, protocol/versioning, backpressure, streaming/cancellation state, and parent-liveness coupling.
   Selected because it is the only option that preserves the declared live composition contract.

The broker uses a versioned handshake and JSON-RPC-shaped envelopes for request, terminal result/error,
stream/progress event, and cancellation. Active IDs are unique; non-cancelled work settles exactly once;
late events/results are ignored after cleanup. Local abort rejects the child proxy immediately, sends
best-effort cancellation, and aborts a parent `AbortController`. Disconnect/error/exit rejects every
pending child operation and aborts every parent controller through a settle-once guard. Configurable
inactivity and hard maximum timeouts clean both maps; progress may refresh inactivity but not the hard
maximum. The built-in worker must acknowledge broker support before execution and must not import default
provider/tool composition.

## Architecture Review

### Affected Scope

- Session persistence and replay: `packages/agent-session`, `packages/agent-provider-replay`,
  `packages/agent-interface-transport`.
- Framework construction and command composition: `packages/agent-framework`, `packages/agent-core`,
  `packages/agent-command`, `packages/agent-command-workflows`, `packages/agent-cli`,
  `packages/agent-preset`.
- Product, capability-pack, and subagent composition: `packages/agent-product`,
  `packages/agent-capability-pack`, `packages/agent-subagent-runner`, `packages/pack-coding`.
- Execution and scheduling: `packages/agent-executor`, `packages/agent-core`.
- Interaction and transport contracts: `packages/agent-interface-transport`,
  `packages/agent-transport`, `packages/agent-transport-tui`,
  `packages/agent-transport-protocol`.
- Public-surface enforcement: `scripts/harness/check-sdk-public-surface.mjs` and its recursive-barrel
  fixtures.
- Governing package SPEC files, public entry points, changesets, and architecture-map documents for
  every contract changed by a child item.

### Alternatives Considered

1. Implement all fourteen findings as one cross-package patch. Pro: one final integration point and
   fewer branch transitions. Con: destroys red/green attribution, mixes independent public-contract
   decisions, and makes a regression impossible to assign to one Task.
2. Execute one child at a time on an integration base, ordered by shared owner and data risk, while
   retaining an initiative-level conformance gate. Pro: preserves each Task's recommendation, tests,
   scenario evidence, and atomic lifecycle while coordinating overlapping contracts. Con: requires
   repeated gate, review, and merge cycles.
3. Fold the findings into AGREEMENT-001. Pro: no second initiative record. Con: changes an already
   approved scope after execution began, obscures which findings were discovered later, and couples
   the new work to unrelated DAG/runtime children.

### Decision

Use alternative 2. Establish one integration base and execute a dependency DAG rather than broad
ownership waves:

1. Independent foundations: ARCH-014, ARCH-015, ARCH-016, ARCH-018, ARCH-024, ARCH-027, ARCH-022,
   and ARCH-026.
2. ARCH-023 follows ARCH-015 so runtime forwarding targets the reconciled canonical store port.
3. ARCH-017 follows ARCH-018 so the surviving prompt/interaction surface is unambiguous.
4. ARCH-020 and ARCH-028 execute as one named work unit after ARCH-016 because they share one event
   delivery taxonomy, subscriber mapping, protocol fan-out, and TUI binding. Each Task retains its own
   criteria and evidence.
5. ARCH-025 follows ARCH-024 and ARCH-027, establishes one total public-contract projection owner and
   an exhaustive mapping floor, and then ARCH-021 builds its worker boundary on that non-dropping
   request contract.

The child decisions are:

- ARCH-014 adds recursive external-value resolution before replay with cycle, depth, and aggregate-byte
  bounds; JSON shape, declared byte length, and sha256 verification; lexical and real-path containment;
  and typed failures. File loading resolves values. Direct `ReplayProvider` construction must receive a
  resolver/base directory or reject unresolved references explicitly—never silently normalize them.
- ARCH-015 preserves unknown record fields and makes optional `getFilePath` part of the canonical
  `IInteractiveSessionStore`; `agent-session` consumes that port directly and removes its duplicate port.
- ARCH-016 gives production log events one declared vocabulary and passes an explicit compact trigger
  through every layer instead of re-deriving it.
- ARCH-018 narrows `IInteractionChannel` to the programmatic/createInteractiveRuntime channel family and
  removes nominal TUI conformance with a central no-op `write()`; remote transports remain on the
  capability/session protocol contracts selected by ARCH-012.
- ARCH-017 removes superseded permission/ask handler fields and stale
  `InteractionEvent.permission-resolved`. The REMOTE-007 prompt registry remains the sole multi-driver
  settlement owner. Leaf convenience factories may adapt callbacks by subscribing to request events and
  calling `resolvePermission`/`resolveAsk`; `prompt_resolved` remains the only settlement event.
- ARCH-020+028 defines one shared event-key/payload contract in `agent-interface-transport` and separate
  mechanically-total `Record<event, classification>` mappings in the TUI and protocol implementation
  packages; no executable subscriber or fan-out policy moves into the interface package. Branch creation,
  fork, switch, restore, rollback, and resume-pointer operations are assigned an exact declared event
  kind/payload or explicitly classified as non-events. Emission occurs only after checkpoint mutation,
  history replacement, and persistence succeed. TUI/protocol delivery handlers catch their own failures
  so committed operations remain successful and report through explicit owner callbacks; arbitrary SDK
  listener exception semantics remain unchanged. The protocol carrier accepts
  `onDeliveryError(error, event)` and connects it to its client error/disconnect lifecycle; WebRTC may not
  swallow delivery failure. Tests observe both committed state and the owned delivery failure.
- ARCH-024 adds optional typed semantic roles to executable system commands—skill activation, context
  reduction, and subagent spawn. Command owners declare them beside their IDs; framework role lookup is
  derived from the currently composed set, rejects duplicate owners, and gives each absent role explicit
  independent semantics.
- ARCH-027 establishes exhaustive `IProductProfile`/`ICapabilityPack` field policies so every public key
  is consumed, surfaced, or explicitly rejected. It removes `IProductProfile.providerOverride` because
  provider-profile selection belongs to the shell and `providerSettings` is already resolved; preserves
  shell override behavior; rejects a later duplicate capability pack as a unit on a separate pack-level
  rejection channel; attaches `packId` provenance to capability-collision diagnostics; and surfaces
  accepted pack metadata plus pack-level rejections through `IAssembledProduct` so `title` and
  `description` are not silent inputs and the second fold cannot re-drop the repaired values.
- ARCH-025 replaces recurring manual partial projections with one canonical total mapper and a mechanical
  key-classification floor. Usage, provider profile, permission policy, schedule patch, and future public
  fields must be mapped, deliberately derived, or explicitly rejected; none may disappear silently.
- ARCH-021 **rejected** the correlated parent-side capability broker this section originally
  specified, on evidence: proxied tools execute in the parent, bound to the parent's checkout,
  while a worktree-isolated child's execution root is a different directory — so it would
  re-break ARCH-010's containment — and no specification defines a per-call working root for a
  proxied tool invocation. It ships a composition RECIPE instead: the composition root supplies
  `ISubagentWorkerComposition` and the child builds an equivalent surface at its own root.
  tool instances, and provider credentials stay in the parent. A parent-side provider resolver/factory
  registry is injected from the product composition root. A request `providerProfile` selects through
  that registry; when absent, the invoking runtime provider is used; an unknown or unconstructable profile
  fails with a typed error. The protocol preserves streaming, cancellation, typed errors, and permission
  decisions, and fails child startup if the declared broker is unavailable. It never reconstructs Robota
  defaults as degradation.

  Tool invocation classifies every `IToolExecutionContext` member: `toolName` and `parameters` are the
  invocation payload; `signal` is derived from a correlated cancellation channel; `executionId`, `userId`,
  `sessionId`, `metadata`, `parentExecutionId`, `rootExecutionId`, `executionLevel`, `executionPath`,
  `ownerType`, `ownerId`, `ownerPath`, and `sourceId` are serialized explicitly;
  `realTimeData.startTime` uses an ISO wire value and is rehydrated as `Date`, while `actualParameters`
  and `estimatedDuration` are mapped explicitly. `eventService`, `baseEventService`, and `ask` are never
  serialized: the parent reconstructs the correct owner-bound live services for the advertised job, and
  a tool requiring an unavailable interaction port receives a typed capability error.

  `extensions` uses a recursive tagged codec rather than default JSON: distinct variants preserve
  `undefined`, finite and special numeric values, `Date`, `Error` (`name`, `message`, optional `stack`, and
  recursively encoded `cause`), arrays, and plain-record entries. Invalid dates, unsupported prototypes,
  cycles, configured nesting/byte overflow, and malformed tags fail with a typed pre-dispatch or decode
  error instead of being dropped or coerced. Both the supported tagged-variant set and every top-level
  `IToolExecutionContext` key are mechanically exhaustive, so adding a context member or wire-value
  variant fails a fixture until it is classified. The neutral serializable payload contracts live with
  the existing worker IPC owner and add no dependency from the worker to `agent-product`, `pack-coding`,
  or another product sibling.

  Placement alternatives were tested against the current contracts: sending composed values directly is
  rejected because provider definitions and tools contain functions; a worker-loaded product module is
  rejected because it duplicates product assembly and cannot preserve arbitrary live closures/adapters;
  the parent broker is selected because it preserves the exact composed live surface while the worker
  remains product-neutral.

- ARCH-022 removes every owner-package laundering re-export reachable from all package-declared framework
  public source roots—including env helpers and session-id guards—and extends the guard to walk local
  re-export edges recursively, cycle-safely, and fail closed on unresolved edges.
- ARCH-023 forwards the runtime default store unless the caller explicitly provides a per-session value,
  including explicit `undefined` to disable persistence.
- ARCH-026 closes the shared executor shell-resolution defect: the core resolver accepts an explicit
  executable and returns its matching argument family, and both managed and scheduled runners consume one
  pure request adapter. Explicit `sh`, `bash`, PowerShell/`pwsh`, and `cmd.exe` overrides retain the
  correct family instead of pairing a caller-selected executable with host-default arguments.

The parent-side broker is a new cross-process capability surface but not a new package or product. It
mirrors the existing `agent-subagent-runner` worker IPC product-family and places neutral wire contracts
at that lowest shared owner; product and pack packages provide live endpoints only at the parent
composition root. All other changes retain their existing owner package families. Reachability is
checked from each product construction root through every named consumer, capability removal is explicit
where a newer SSOT already owns the behavior, and every execution unit receives an independent
adversarial review before code changes.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the new broker mirrors agent-subagent-runner worker IPC; all other changes retain existing session, framework, product, executor, and transport owner families
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

- External session payload corruption, recursion-limit violations, containment failures, and integrity
  mismatches fail closed with typed errors; replay never substitutes a placeholder value.
- Prompt requests use the registry's existing fail-closed detach/backstop settlement; no legacy callback
  path is revived as a fallback.
- A missing child-process capability broker fails startup explicitly; the worker never falls back to
  Robota default providers or tools.
- A later duplicate capability pack is rejected as a whole with provenance; it is never partially merged.
- An explicitly supplied `sessionStore: undefined` intentionally disables runtime-default persistence.
- An absent semantic command role disables only that module-owned behavior and is distinguishable from
  a present role that returns an empty result.

## Solution

1. Amend ARCH-020, ARCH-021, ARCH-025, ARCH-026, ARCH-027, and ARCH-028 to the foundational scopes
   recorded in the Decision, and correct ARCH-017 to the currently selected SSOT boundary before
   implementation.
2. Revalidate every child premise against current source and package SPECs; halt rather than silently
   re-scope a stale item.
3. For each child, update governing SPEC sections first, write the smallest failing contract or
   behavior test, implement to green, and run the affected package build immediately.
4. Execute the child's user-facing scenario when the changed capability is reachable from a product
   surface; otherwise record a specific not-applicable reason and durable engineering evidence.
5. Merge only a green, independently reviewed child into the integration base, then verify the base has
   not drifted before starting the next child.
6. After all children are terminal, run architecture conformance, scoped harness verification for every
   affected package, and the repository CI-equivalent gate over the assembled base.

## Affected Files

- `.agents/tasks/ARCH-014-*.md` through `.agents/tasks/ARCH-018-*.md`
- `.agents/tasks/ARCH-020-*.md` through `.agents/tasks/ARCH-028-*.md`
- Package SPEC, source, test, public-entry, and changeset files discovered from each child's `area`
  and verified current dependency graph
- `.agents/specs/architecture-map/*.md` only where a stable ownership or dependency statement changes

## Completion Criteria

- [x] TC-01: ARCH-014 recursively replays session values externalized beyond 32 KiB and rejects unresolved direct-provider values, cycles, configured depth or aggregate-byte overflow, malformed JSON, declared-length mismatch, sha256 mismatch, lexical escape, and real-path/symlink escape before provider normalization.
- [x] TC-02: ARCH-015 persists an existing interactive-session record through the agent-session writer without deleting any field the writer does not own, and one canonical store-port relationship is documented and type-checked.
- [x] TC-03: ARCH-016 admits every production session-log event—including direct logger calls, `onExecutionEvent` literals, and replay-reader-only keys—through one declared vocabulary and reports the same explicit `TCompactTrigger` to the session hook and compaction orchestrator for one manual compact operation.
- [x] TC-04: ARCH-017 removes obsolete session-level permission/ask handler options and stale `InteractionEvent.permission-resolved`, preserves leaf callback convenience through a prompt-registry adapter, and records all settlement/dismissal through canonical `prompt_resolved` without a second settlement path.
- [x] TC-05: ARCH-018 makes the documented `IInteractionChannel` charter, its implementer set, and runtime wiring agree; no production implementer retains a central no-op member solely for nominal conformance.
- [x] TC-06: ARCH-020 defines and tests the complete checkpoint/branch transition matrix, emits successful transitions only after mutation/history/persistence complete, keeps committed operations successful when a TUI/protocol delivery handler throws, and surfaces that delivery failure through the adapter's explicit owner callback without changing arbitrary SDK listener semantics.
- [x] TC-07: ARCH-028 owns shared event keys/payloads in the interface package and mechanically-total but separate TUI/protocol implementation mappings, making branch, plan, and context-refresh events observable through protocol fan-out/client acceptance and deterministic TUI rendering without executable transport policy in the interface package.
- [ ] TC-08: ARCH-021 selects a per-request `providerProfile` through an injected parent resolver (or the invoking provider when absent), keeps credentials parent-side, and brokers provider streaming/cancellation/errors plus tool calls whose context round-trips ownership fields and tagged nested `Date`/`Error`/`undefined` values; every top-level context key and wire variant is mechanically classified, while unsupported/cyclic/over-limit values and unavailable capabilities fail explicitly without reconstructing Robota defaults.
- [x] TC-09: ARCH-023 forwards the runtime-owned default session store into created sessions unless an explicit per-session override is supplied, and resume restores through that default.
- [x] TC-10: ARCH-024 removes framework knowledge of module-owned command IDs through owner-declared semantic command roles, rejects duplicate role owners, preserves alternate-ID behavior, and gives each absent role explicit independent semantics.
- [x] TC-11: ARCH-027 exhaustively classifies every product/pack composition field; removes `IProductProfile.providerOverride` while preserving shell-owned override behavior; rejects a later duplicate `ICapabilityPack.id` atomically on a separate pack channel; includes `packId` provenance in capability-collision diagnostics; and surfaces accepted pack title/description metadata.
- [x] TC-12: ARCH-022 removes owner-package laundering from every package-declared framework public source root and a red-first cycle-safe recursive graph guard rejects value/type pass-through at any reachable depth plus unresolved local re-export edges.
- [x] TC-13: **re-scoped 2026-08-16, closed by ARCH-031 (`done` 2026-08-16).** ARCH-025 (`done`) delivered the two LOCAL parts inside its declared area — `SubagentManager.wait()` preserves `usage`, and one `IScheduleEditPatch` owner is exported with both structural re-declarations in `agent-framework` deleted. The canonical total projection, the mapped/derived/rejected classification, `providerProfile`, and the mechanical exhaustiveness fixture moved to **ARCH-031** (issue #1747): a FOUNDATIONAL finding-depth verdict established that the cause spans four packages including `agent-interface-transport`, which owns the contracts and which ARCH-025's area does not name, so a totality mechanism scoped to ARCH-025 could not be total. The owner approved ARCH-031's span on 2026-08-16. This criterion closes with ARCH-031.
- [x] TC-14: ARCH-026 makes managed and scheduled command runners consume one executable-aware shell resolver with request-override precedence and matching argument families for `sh`, `bash`, PowerShell/`pwsh`, and `cmd.exe` on simulated platforms plus real Windows default-PowerShell evidence.
- [ ] TC-15: all fourteen child Task records contain current engineering and scenario evidence, reach `done`, and move atomically to `.agents/tasks/completed/` with the agreement projections updated.
- [ ] TC-16: the assembled integration base passes `pnpm harness:conformance`, affected scoped harness verification, and `pnpm harness:verify-like-ci`, with exact commands and exit evidence recorded.

## Test Plan

| TC-ID | Test Type                       | Tool / Approach                                                                                                                                                                                                                                | Notes                |
| ----- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| TC-01 | Agreement / persistence         | agent-session and replay-provider Vitest fixtures with nested real sidecars, configurable bounds, integrity, direct-constructor, and real-path containment cases                                                                               | ARCH-014             |
| TC-02 | Agreement / data contract       | agent-session round-trip integration plus type-level store-port conformance                                                                                                                                                                    | ARCH-015             |
| TC-03 | Agreement / observability       | direct logger + `onExecutionEvent` + replay-reader event-name enumeration guard and manual-compaction hook integration test                                                                                                                    | ARCH-016             |
| TC-04 | Agreement / auth interaction    | prompt-registry adapter integration, settlement-event assertion, removed-option type tests, and zero stale-event scan                                                                                                                          | ARCH-017             |
| TC-05 | Agreement / contract            | exact implementer/wiring tests plus architecture documentation conformance                                                                                                                                                                     | ARCH-018             |
| TC-06 | Agreement / observability       | post-persistence transition matrix plus throwing-subscriber tests asserting committed success and owned delivery-error observation                                                                                                             | ARCH-020             |
| TC-07 | Agreement / transport           | shared-key and per-implementation exhaustive-map guards plus deterministic TUI, protocol fan-out, and client-observation tests                                                                                                                 | ARCH-028             |
| TC-08 | Agreement / process integration | the injected composition reaches the real worker entry over IPC (tool surface + a provider type no default registry contains); the built artifact declares the pack tool names it composed; fail-closed refusal on non-reproducible capability | ARCH-021             |
| TC-09 | Agreement / persistence         | createAgentRuntime default/override/resume integration matrix                                                                                                                                                                                  | ARCH-023             |
| TC-10 | Agreement / composition         | alternate-ID/absence/duplicate-role integration tests, SDK scenario, and zero hard-coded-ID scan                                                                                                                                               | ARCH-024             |
| TC-11 | Agreement / composition         | exhaustive product/pack key fixtures, removed product-field type test, shell override regression, accepted metadata, separate whole-pack duplicate rejection, and provenance assertions                                                        | ARCH-027             |
| TC-12 | Agreement / public surface      | package-export-root recursive barrel-graph fixtures (depth, cycle, unreachable, unresolved, facade) plus affected package/app builds                                                                                                           | ARCH-022             |
| TC-13 | Agreement / type contract       | canonical projection tests, public-key exhaustiveness fixture, and shared-type compile assertion                                                                                                                                               | ARCH-025             |
| TC-14 | Agreement / platform behavior   | shared executable/argument-family matrix for both runner spawn paths plus real Windows default-PowerShell execution                                                                                                                            | ARCH-026             |
| TC-15 | Agreement / governance          | done-gate evidence audit, task-archival scan, and agreement child projection check                                                                                                                                                             | All children         |
| TC-16 | Agreement / CI                  | `pnpm harness:conformance`, scoped `pnpm harness:verify`, and `pnpm harness:verify-like-ci`                                                                                                                                                    | Final assembled base |

## Tasks

Active initiative Task: `.agents/tasks/AGREEMENT-002-complete-august-13-agent-architecture-findings.md`.

- [x] ARCH-014 — done — `.agents/tasks/completed/ARCH-014-session-log-external-payloads-have-no-dereferencer.md`
- [x] ARCH-015 — done — `.agents/tasks/completed/ARCH-015-two-writers-one-record-contract-session-save-destroys-fields.md`
- [x] ARCH-016 — done — `.agents/tasks/completed/ARCH-016-session-log-event-vocabulary-and-compaction-trigger-split-brain.md`
- [x] ARCH-017 — done — `.agents/tasks/completed/ARCH-017-injected-permission-ask-handlers-are-dead-surface.md`
- [x] ARCH-018 — done — `.agents/tasks/completed/ARCH-018-interaction-channel-charter-is-unsatisfiable-as-written.md`
- [x] ARCH-020 — done — `.agents/tasks/completed/ARCH-020-branch-event-is-declared-and-emitted-by-nothing.md`
- [x] ARCH-021 — done — `.agents/tasks/completed/ARCH-021-child-process-subagent-worker-bypasses-product-composition.md`
- [x] ARCH-022 — done — `.agents/tasks/completed/ARCH-022-framework-pass-through-re-export-evades-public-surface-guard.md`
- [x] ARCH-023 — done — `.agents/tasks/completed/ARCH-023-createAgentRuntime-default-sessionstore-never-forwarded.md`
- [x] ARCH-024 — done — `.agents/tasks/completed/ARCH-024-framework-hardcodes-module-owned-command-ids.md`
- [x] ARCH-025 — done — `.agents/tasks/completed/ARCH-025-executor-projections-silently-drop-contract-fields.md`
- [x] ARCH-026 — done — `.agents/tasks/completed/ARCH-026-scheduled-task-runner-bypasses-shell-resolution-ssot.md`
- [x] ARCH-027 — done — `.agents/tasks/completed/ARCH-027-dead-composition-contract-fields.md`
- [x] ARCH-028 — done — `.agents/tasks/completed/ARCH-028-plan-and-context-refresh-events-emitted-into-a-contract-no-transport-consumes.md`

## Evidence Log

### [BATCH-3-COMPLETE] — ✅ PASS | 2026-08-16

- ARCH-022 retained a valid runtime `NOT-APPLICABLE` classification and passed its recursive public-surface
  guard/fixture verification.
- ARCH-024 and ARCH-027 exact public-SDK scenarios each ran twice, produced deterministic output, and
  matched their owner canonical records with independent guardian verdicts.
- ARCH-026's exact-head Windows run `31902814337` passed job `95056073552`; artifact id `9251559101`
  independently validated all twelve real runner cases, requested/observed shell identities, zero unknown
  spawns, and cleanup.
- Batch guardian reported `Actionable findings: 0` and `BATCH GATE VERDICT: PASS`.

### [CHILD-COMPLETE: ARCH-014] — ✅ PASS | 2026-08-15

- The endorsed external-payload resolver, loader, validator, and replay-provider changes are committed
  with package SPECs and a two-package minor changeset.
- Engineering verification passed: agent-session 207/207, provider-replay 8/8, package typechecks,
  lint with zero errors, spec public-surface/coverage scans, dependency conformance, and the complete
  scoped harness path with 3364/3364 repository tests.
- `DONE-GATE-STAGE-2` independently reran the public-SDK standalone scenario and matched the canonical
  sidecar path, 40975-byte payload hash, call-2 sentinel alignment, and cleanup output exactly.

### [GATE-WRITE] — ✅ PASS | 2026-08-15

**Status upgrade:** draft → review-ready

- Frontmatter delimiter: the file begins with a complete `---` YAML frontmatter block.
- Frontmatter status: `status: draft` is present.
- Frontmatter type: `type: AGREEMENT` is one of the eleven allowed values.
- Frontmatter tags: `tags: [typescript, async, cli, websocket]` is present.
- Problem symptom: the document names fourteen open 2026-08-13 ARCH records and the concrete replay,
  persistence, injection, composition, event-delivery, package-boundary, and projection defects they expose.
- Problem reproduction: the document specifies the 2026-08-15 `origin/develop` tree and the exact
  created-date/non-terminal task query condition.
- Problem quality: the section is multi-paragraph and contains no `TBD`, `TODO`, or vague placeholder.
- Prior Art Research section: present and substantiated.
- Research sources: cites Node.js child-process IPC/lifecycle, JSON-RPC 2.0, LSP 3.17, and MCP product or
  protocol documentation; no third-party source code is used as evidence.
- Research recommendation: the serialization, correlation, cancellation, lifecycle, and capability
  findings directly produce the three broker alternatives and the parent-side correlated-broker decision.
- Architecture checklist: all four required items are checked `[x]`.
- Sibling scan: checked with evidence that the broker mirrors the existing `agent-subagent-runner` worker
  IPC family and that the other changes remain in their existing owner families.
- Alternatives: three alternatives each state a description, pro, and con.
- Decision trade-off: alternative 2 is selected for per-Task red/green attribution and atomic lifecycle,
  accepting repeated gate/review/merge cycles instead of one broad patch.
- New-surface placement: the new broker is explicitly classified as an `agent-subagent-runner` worker IPC
  surface, with neutral contracts at the shared IPC owner and live product endpoints only at the parent
  composition root; no worker dependency on a sibling PRODUCT is introduced.
- Completion-criteria identifiers: all sixteen checklist items use unique `TC-01` through `TC-16` prefixes.
- Completion-criteria coverage: the fourteen child findings, child lifecycle completion, and assembled-base
  verification each have an explicit criterion.
- Completion-criteria observability: every criterion names inspectable contract behavior, failure behavior,
  task state, or command result; none uses the prohibited vague phrases.
- Test Plan section: present.
- Test Plan correspondence: sixteen non-empty rows map one-to-one to the sixteen Completion Criteria
  (`TC-01` through `TC-16`), with no missing, extra, or duplicate ID.
- Test Plan tooling: every row has a non-empty test type and automated tool/approach; none contains `TBD`.
- Manual-test rule: no row uses `manual`, so a manual-infeasibility note is not required.
- Tasks structure: present with all fourteen child task projections; the paired todo AGREEMENT-002 Task
  explicitly preserves GATE-APPROVAL as pending.
- Evidence structure: `## Evidence Log` was present and empty before this first GATE-WRITE entry.
- Forbidden body sections: neither `## Status` nor `## Classification` appears in the body.

### [proposal-review] — ✅ ENDORSE | 2026-08-15

**Reviewed recommendation:** dependency-ordered execution of the fourteen children, including the
ARCH-020+028 event-delivery work unit and ARCH-021 parent-side capability broker.

- Premises: all fourteen defects remain reachable in current source; depth review classified 14/14
  children as LOCAL after the four foundational scope corrections were incorporated.
- Reachability: provider-profile resolution, broker endpoints, tool-context mapping, event delivery,
  and every existing consumer were traced from the product composition roots.
- Capability preservation: every current `IToolExecutionContext` key and tagged wire variant is
  classified; superseded permission and provider-override contracts are removed in favor of their
  current SSOTs rather than silently dropped.
- Placement verdict: ENDORSED. Neutral broker envelopes/codecs stay with the existing
  `agent-subagent-runner` worker IPC family; live provider/tool endpoints remain parent-owned; the
  worker gains no dependency on a product sibling.
- Adversarial verdict: no blocking architecture finding remains after the user-authorized final
  correction for ownership fields and extension-value serialization.

REVIEW VERDICT: ENDORSE

### [GATE-APPROVAL] — ✅ PASS | 2026-08-15

**Status upgrade:** review-ready → approved

- Explicit user approval: the current user-provided active goal states verbatim,
  “ARCH-014~028 을 모두 진행해줘.”
- Approval scope: the instruction directly authorizes implementation of the full ARCH child set governed
  by this AGREEMENT-002 document; “모두 진행해줘” is an unambiguous instruction to proceed with that design.
- Post-approval integrity: the document is clean at committed HEAD `657aca3cc`; no Architecture Review,
  `type`, or `tags` change exists after the current approval statement.
- Independent architecture validation: the preceding `[proposal-review]` entry records
  `REVIEW VERDICT: ENDORSE` and specifically endorses the new parent-side broker placement in the existing
  `agent-subagent-runner` IPC family, with live endpoints retained in the parent and no sibling-PRODUCT
  dependency introduced.
- Pre-implementation ordering: the worktree was clean at the approval check and remains at the
  documentation-only AGREEMENT-002 commit; no ARCH-014–028 implementation edit or commit preceded this gate.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-15

**Status upgrade:** approved → in-progress

- Tasks file: `.agents/tasks/AGREEMENT-002-complete-august-13-agent-architecture-findings.md` exists and is
  recorded in the spec document's `## Tasks` section as the active initiative execution record.
- Completion-criteria correspondence: the Tasks file `## Plan` contains one explicit task for each
  agreement criterion, `TC-01` through `TC-16`, covering all fourteen child findings, child lifecycle
  completion, and assembled-base verification.
- Tasks created: `TC-01` ARCH-014 external payload replay; `TC-02` ARCH-015 record preservation/store port;
  `TC-03` ARCH-016 event vocabulary/compact trigger; `TC-04` ARCH-017 prompt-registry permission cleanup;
  `TC-05` ARCH-018 interaction-channel contract; `TC-06` ARCH-020 transition matrix; `TC-07` ARCH-028
  TUI/protocol delivery; `TC-08` ARCH-021 parent-side worker broker; `TC-09` ARCH-023 default session store;
  `TC-10` ARCH-024 semantic command roles; `TC-11` ARCH-027 provider override/pack collisions; `TC-12`
  ARCH-022 public-surface guard; `TC-13` ARCH-025 total executor projections; `TC-14` ARCH-026 shared shell
  resolver; `TC-15` child done gates/archive; and `TC-16` assembled verification.
- Task test plan: the Tasks file contains a substantive `## Test Plan` section specifying per-child
  red-green tests and builds, applicable user-execution scenarios, assembled conformance/scoped/CI-equivalent
  verification, and task/spec lifecycle projection checks; it exceeds the required 50 characters.
