---
status: in-progress
type: DATA
tags: [typescript, async]
capability: true
user_execution: agent-run
user_execution_scenario: .agents/evals/scenarios/arch-012-session-capabilities-agent-run.md
---

# ARCH-012: replace the wide session aggregate with capability contracts

## Problem

`IInteractiveSession` currently requires 39 unrelated members as one structural contract. A transport
that needs only submission and events must still fabricate the other members or cross the boundary with
an unchecked cast. The repository ratchet measures 37 direct `IInteractiveSession` contract casts.
The defect reproduces when a transport test double or an external SDK consumer implements only the
operations it uses: TypeScript rejects the honest subset, so callers claim the full aggregate with
`as unknown as`. The shipped `InteractiveSession` and the published full test double are conformant, and
the former optional session members are already required; those are completed P1 foundations, not the
remaining defect.

## Prior Art Research

The TypeScript handbook documents structural subtyping: a value is compatible when it contains the
members required by the receiving contract. It also documents intersections as composition of several
smaller contracts into one aggregate. These two language properties allow Robota to type a consumer by
the roles it actually needs while retaining a compatibility aggregate for full-session callers:
[Interfaces](https://www.typescriptlang.org/docs/handbook/interfaces.html),
[Unions and Intersection Types](https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html).

Martin Fowler's Role Interface description identifies the matching design pressure: a broad header
interface forces implementers to provide methods they do not need, while a role interface contains only
the operations required by the role. His Separated Interface pattern also supports keeping the shared
contract in a lower-level package while implementations remain in higher-level packages:
[Role Interface](https://martinfowler.com/bliki/RoleInterface.html),
[Separated Interface](https://martinfowler.com/eaaCatalog/separatedInterface.html).

Robota already uses this structure. `IInteractionChannel` and `ITerminalHandoff` are separately owned
capabilities in `agent-interface-transport`, with the framework consuming the injected contracts and the
TUI implementing them. `IPayloadChannelHost` is a named optional transport capability implemented by the
WebSocket adapter rather than an anonymous intersection. The applicable constraint is therefore to
extend the existing universal interface-library family and compose implementations in the framework;
no transport or product shell may become the shared contract owner.

## Architecture Review

### Affected Scope

- `packages/agent-interface-transport`: session capability SSOT, compatibility aggregate, public testing
  factory, package SPEC and exports.
- `packages/agent-framework`: real complete session-capability producer and package SPEC.
- `packages/agent-transport`, `packages/agent-transport-protocol`, `packages/agent-transport-http`,
  `packages/agent-transport-mcp`, `packages/agent-transport-ws`, `packages/agent-transport-webrtc`, and
  `packages/agent-transport-tui`: transport consumers narrowed to named capability intersections.
- `packages/agent-cli` and affected app/test fixtures: assembly and test-double migration.
- `.agents/harness.config.json` and the contract-cast ratchet: the governed `IInteractiveSession`
  count reaches zero. ARCH-029 separately owns the `ICommandHostContext` floor.

### Alternatives Considered

1. Keep both wide interfaces and expand the published full test double.
   - Pro: smallest source diff and no new public contract names.
   - Con: subset consumers still lie about capabilities; absent and provided-empty stay conflated; casts
     remain structurally necessary.
2. Make every wide member optional and use optional chaining.
   - Pro: partial objects type-check with little migration work.
   - Con: moves failures to runtime, repeats the already-fixed attribution ambiguity, and provides no
     typed declaration of what a consumer requires.
3. Define capability-scoped role interfaces in their existing shared owners, compose a compatibility
   aggregate, and migrate consumers to the narrow roles.
   - Pro: structural typing verifies honest subsets, full callers retain one aggregate, capability absence
     becomes explicit, and test doubles are reusable without dependency inversion.
   - Con: wide cross-package migration and coordinated public type changes.

### Decision

Choose alternative 3. `agent-interface-transport` remains the universal contract-library owner for
session capabilities, mirroring `IInteractionChannel`, `ITerminalHandoff`, and `IPayloadChannelHost`.
`agent-framework` remains the implementation/composition owner. Transport libraries depend only on the
shared interface contracts; no sibling product (`agent-cli`, an app, or another transport) is imported.

Reachability was validated against all current consumers: full session production, protocol, HTTP, MCP,
WebSocket, WebRTC, TUI, headless/core transport, and CLI remote control. The replacement
preserves every current member by assigning it to exactly one named capability and reconstructing the
legacy aggregate as an intersection. Adversarial cases include a missing capability, a provided capability
whose method returns `null` or an empty array, a subset host with no casts, a full producer/double, and a
consumer that attempts to reach an undeclared role. The migration is complete only when the session cast
floor is zero; an allowlisted nonzero baseline is not completion. Command-package host casts are neither
counted nor migrated here because ARCH-029 owns that distinct framework boundary.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — existing interaction, terminal-handoff, payload-channel capability contracts examined
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Add named session role interfaces and an `ISessionCapabilityMap` in
`agent-interface-transport`. `ISessionCapabilityHost<TCapabilities>` exposes a typed `capabilities`
object while also structurally composing the selected role methods at the top level.
`readSessionCapability(host, key)` returns a discriminated provided/not-provided result; a
provided capability may still return `null`, `undefined`, or an empty list according to its own method
contract. `IInteractiveSession` remains an `export interface` extending all 16 role interfaces, rather
than becoming a type-alias intersection or a second hand-written member list. This preserves declaration
merging/module augmentation as well as the exact structural shape. It does **not** gain a required
`capabilities` property, so existing external implementations of today's 39-member aggregate remain
source compatible.

The roles cover lifecycle, turn submission/control, goal, execution state, driver attribution,
conversation reads, identity, workspace location, commands, events, prompt resolution, background tasks,
background groups, execution workspace, and agent jobs. `InteractiveSession` and the full testing double
conform structurally to the complete 16-port intersection; callers that need a queryable complete host use
the public capability-host factory without modifying those legacy implementations. The testing subpath
keeps `createTestInteractiveSession` and adds a subset-host factory that requires no assertion. The
separately filed ARCH-029 owns `ICommandHostContext`; it is not part of this PR.

Public transport factories preserve their existing `ITransportAdapter<IInteractiveSession>` attach
signature and add a typed overload for their named required-role host. Their implementation accepts the
union and stores only the required-role intersection. Thus an old full custom session still compiles, while
a new subset capability host can attach without a cast. The shared `ITransportAdapter` contract itself is
not replaced here; ARCH-011 owns that lifecycle/conformance boundary. A public
`createSessionCapabilityHost(capabilities)` factory performs the only flattening from the canonical map to
the selected top-level role intersection. There is no legacy cast or private normalization path.

Migrate each production consumer and test double to its named role intersection. Lower only the
`IInteractiveSession` AST baseline from 37 to zero. Do not introduce a parallel anonymous intersection,
pass-through re-export, or compatibility cast.

### Exact 39-member preservation inventory

| Capability key       | Owned port                   | Existing members (assigned exactly once)                                                                                                 |
| -------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `lifecycle`          | `ISessionLifecycle`          | `isInitialized`, `shutdown`                                                                                                              |
| `turnSubmission`     | `ISessionTurnSubmission`     | `submit`                                                                                                                                 |
| `turnControl`        | `ISessionTurnControl`        | `abort`, `cancelQueue`                                                                                                                   |
| `goal`               | `ISessionGoal`               | `setGoal`, `getGoalState`, `cancelGoal`                                                                                                  |
| `executionState`     | `ISessionExecutionState`     | `isExecuting`, `getPendingPrompt`, `getPendingCount`                                                                                     |
| `driverAttribution`  | `ISessionDriverAttribution`  | `getActiveDriverId`                                                                                                                      |
| `conversationRead`   | `ISessionConversationRead`   | `getMessages`, `getContextState`                                                                                                         |
| `identity`           | `ISessionIdentity`           | `getSession`                                                                                                                             |
| `workspaceLocation`  | `ISessionWorkspaceLocation`  | `getCwd`                                                                                                                                 |
| `commands`           | `ISessionCommands`           | `executeCommand`, `listCommands`                                                                                                         |
| `events`             | `ISessionEvents`             | `on`, `off`                                                                                                                              |
| `promptResolution`   | `ISessionPromptResolution`   | `resolvePermission`, `resolveAsk`                                                                                                        |
| `backgroundTasks`    | `ISessionBackgroundTasks`    | `listBackgroundTasks`, `getBackgroundTask`, `cancelBackgroundTask`, `closeBackgroundTask`, `sendBackgroundTask`, `readBackgroundTaskLog` |
| `backgroundGroups`   | `ISessionBackgroundGroups`   | `listBackgroundJobGroups`, `getBackgroundJobGroup`, `createBackgroundJobGroup`, `waitBackgroundJobGroup`                                 |
| `executionWorkspace` | `ISessionExecutionWorkspace` | `getExecutionWorkspaceSnapshot`                                                                                                          |
| `agentJobs`          | `ISessionAgentJobs`          | `listAgentDefinitions`, `listAgentJobs`, `spawnAgentJob`, `sendAgentJob`, `cancelAgentJob`, `closeAgentJob`                              |

The table assigns 39/39 current members once. `IInteractiveSession` remains an interface extending these
16 ports and therefore retains both its declaration kind and exact current structural surface.
`ISessionCapabilityMap` maps the 16
stable keys to the same ports; it is not serialized over HTTP, WebSocket, MCP, or WebRTC.

### Compatibility and semver

- `@robota-sdk/agent-interface-transport`: **minor** changeset for additive public role/map/query/factory
  exports. The legacy aggregate keeps its exact 39-member shape.
- Each published transport package whose factory gains a subset-host attach overload: **minor** changeset
  because it accepts a new supported input without removing the old full-session signature.
- `@robota-sdk/agent-framework`: **patch** changeset for internal producer/consumer narrowing with no
  removed public signature; if implementation reveals a public declaration change, upgrade that entry to
  minor before GATE-COMPLETE.
- No command package changeset belongs here. ARCH-029 owns the command-host public migration.

### Adjacent ownership boundaries

- ARCH-019 is the completed prerequisite that made the full testing factory honest about per-submission
  identity and the nested session shape.
- ARCH-018 remains the doc-first `IInteractionChannel` charter correction; this work does not migrate
  transports onto that channel.
- ARCH-011 remains downstream and owns transport lifecycle, admission, cancellation, error/result, and
  disconnect conformance. This work supplies named session roles only.
- ARCH-029 separately owns `ICommandHostContext` decomposition and its cast floor.

## Affected Files

- `packages/agent-interface-transport/src/session-capability-contracts.ts`
- `packages/agent-interface-transport/src/session-contracts.ts`
- `packages/agent-interface-transport/src/index.ts`
- `packages/agent-interface-transport/src/testing/index.ts`
- `packages/agent-interface-transport/docs/SPEC.md`
- `packages/agent-framework/src/interactive/**`
- `packages/agent-framework/docs/SPEC.md`
- affected `packages/agent-transport*/**` and `packages/agent-cli/**`
- `.agents/harness.config.json`
- `.agents/evals/scenarios/arch-012-session-capabilities-agent-run.md`
- coordinated `.changeset/*.md` entries for every changed public package

## Completion Criteria

- [ ] TC-01: A TypeScript consumer declares only turn-submission and event capabilities with no cast;
      `readSessionCapability` reports `provided: false` for an absent role and `provided: true` when the role
      exists but returns `null`.
- [ ] TC-02: The shipped `InteractiveSession` and published full test double conform to the complete
      capability aggregate, while the published subset factory conforms to its exact declared capability map.
- [ ] TC-03: Protocol, HTTP, MCP, WebSocket, WebRTC, TUI, headless/core transport, CLI, and app/test
      consumers accept named capability intersections and contain no direct `IInteractiveSession` cast.
- [ ] TC-04: `node scripts/harness/scan-contract-cast-ratchet.mjs` exits 0 with zero
      `IInteractiveSession` casts and fails when the canonical fixture is reintroduced.
- [ ] TC-05: The durable public-SDK scenario uses public `createSessionCapabilityHost` and
      `createHttpTransport({ admission: { open: true, openReason: 'ARCH-012 local capability scenario' } })`, attaches exactly the HTTP roles
      (`turnSubmission`, `events`, `turnControl`, `identity`, `commands`, `conversationRead`, and
      `executionState`), POSTs `/submit`, and prints
      exactly `ARCH012_OK`, `NOT_PROVIDED`, and `PROVIDED_EMPTY`, with exit code 0 and cleanup complete.
- [ ] TC-06: affected package build, typecheck, tests, SSOT scan, harness scan, conformance, and
      `pnpm harness:verify-like-ci` all exit 0.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                      | Notes                                                                                                                                                                                              |
| ----- | ------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Type + unit              | `agent-interface-transport` capability type/runtime test             | First RED is missing exports/helper; then assert discriminated absence.                                                                                                                            |
| TC-02 | Contract                 | full producer/double and subset factory conformance tests            | Use structural assignments and runtime factory checks without assertions.                                                                                                                          |
| TC-03 | Integration + type       | affected transport/CLI suites and declaration builds                 | Each consumer receives only its documented role intersection.                                                                                                                                      |
| TC-04 | Mechanical regression    | contract-cast AST scanner fixtures and live scan                     | Zero is mandatory; allowlisted debt is rejected.                                                                                                                                                   |
| TC-05 | Public SDK scenario      | `.agents/evals/scenarios/arch-012-session-capabilities-agent-run.md` | Built public interface/HTTP packages; isolated consumer imports only bare public exports, reads the SSE result, queries absent `driverAttribution`, then queries a provided port returning `null`. |
| TC-06 | Engineering verification | package build/test/typecheck, SSOT, harness/conformance/CI mirror    | Full gate after targeted green loops.                                                                                                                                                              |

## Tasks

- [ ] `.agents/tasks/ARCH-012-interactive-session-god-contract.md` — existing task; synchronize at GATE-IMPLEMENT

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-14

**Status upgrade:** draft → review-ready
The document has valid draft DATA frontmatter, a measured 39-member/37-cast problem, directly relevant
TypeScript and role-interface prior art, three explicit alternatives, a checked architecture review,
and an independently endorsed placement in the universal transport contract package. TC-01 through
TC-06 cover capability discrimination, conformance, consumer migration, the zero-cast ratchet, the
public HTTP SDK scenario, and engineering verification; the six substantive Test Plan rows map 1:1.
The exact Task placeholder and first-run Evidence Log structure are present with no forbidden body
status/classification section.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-14

**Status upgrade:** review-ready → approved
User standing approval, verbatim: “타당한 이유와 함께 추천안을 제시하면 타당할 경우 자동으로
승인하겠습니다.” The exact revised ARCH-012 recommendation received independent `REVIEW VERDICT:
ENDORSE`, satisfying the stated condition and the active initiative instruction. Independent placement
review endorsed the 16 roles/map/query/factory in the universal interface-transport contract family,
with framework as implementation/composition owner and no sibling-product dependency. The endorsed
Architecture Review, Decision, `type: DATA`, and tags are unchanged, and no package implementation,
test, changeset, harness code, or scenario artifact predates this gate.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-14

**Status upgrade:** approved → in-progress
The exact active Task exists and its six unchecked Plan rows map 1:1 to role/query discrimination,
legacy and subset conformance, consumer migration with attach compatibility, the zero-cast ratchet,
the public HTTP SDK scenario and both done-gate stages, and final owner/verification work. Its Test
Plan is substantive, ARCH-019 is completed, Blockers is None, and ARCH-011/ARCH-029 remain downstream.
The Task's historical in-progress status records its completed P1 foundation and is not a gate input;
no new source, test, scenario, changeset, harness implementation, or package artifact for the revised
TC-01..06 scope predates this gate.
