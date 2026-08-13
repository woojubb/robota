---
status: draft
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
- `.agents/harness.config.json` and the contract-cast ratchet: both governed contract counts reach zero.

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
WebSocket, WebRTC, TUI, headless/core transport, CLI remote control, and command packages. The replacement
preserves every current member by assigning it to exactly one named capability and reconstructing the
legacy aggregate as an intersection. Adversarial cases include a missing capability, a provided capability
whose method returns `null` or an empty array, a subset host with no casts, a full producer/double, and a
consumer that attempts to reach an undeclared role. The migration is complete only when both cast floors
are zero; an allowlisted nonzero baseline is not completion.

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
object. `readSessionCapability(host, key)` returns a discriminated provided/not-provided result; a
provided capability may still return `null`, `undefined`, or an empty list according to its own method
contract. `IInteractiveSession` remains as the compatibility aggregate composed from all role interfaces
and the complete capability host, rather than a second hand-written member list.

The initial roles cover lifecycle, turn submission/control, goal, execution state, driver attribution,
conversation reads, identity, workspace location, commands, events, prompt resolution, background tasks,
background groups, execution workspace, and agent jobs. `InteractiveSession` exposes one complete map.
The testing subpath keeps `createTestInteractiveSession` and adds a subset-host factory that requires no
assertion. The separately filed ARCH-029 owns `ICommandHostContext`; it is not part of this PR.

Migrate each production consumer and test double to its narrow role intersection. Extend the AST cast
ratchet to cover both aggregate names and lower both baselines to zero. Do not introduce a parallel
anonymous intersection, pass-through re-export, or compatibility cast.

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
- [ ] TC-05: The durable public-SDK scenario submits `ARCH012_OK` through a shipped transport and prints
      exactly `ARCH012_OK`, `NOT_PROVIDED`, and `PROVIDED_EMPTY`, with exit code 0 and cleanup complete.
- [ ] TC-06: affected package build, typecheck, tests, SSOT scan, harness scan, conformance, and
      `pnpm harness:verify-like-ci` all exit 0.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                      | Notes                                                                     |
| ----- | ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| TC-01 | Type + unit              | `agent-interface-transport` capability type/runtime test             | First RED is missing exports/helper; then assert discriminated absence.   |
| TC-02 | Contract                 | full producer/double and subset factory conformance tests            | Use structural assignments and runtime factory checks without assertions. |
| TC-03 | Integration + type       | affected transport/CLI suites and declaration builds                 | Each consumer receives only its documented role intersection.             |
| TC-04 | Mechanical regression    | contract-cast AST scanner fixtures and live scan                     | Zero is mandatory; allowlisted debt is rejected.                          |
| TC-05 | Public SDK scenario      | `.agents/evals/scenarios/arch-012-session-capabilities-agent-run.md` | Agent-executable, credential-free, isolated scratch directory.            |
| TC-06 | Engineering verification | package build/test/typecheck, SSOT, harness/conformance/CI mirror    | Full gate after targeted green loops.                                     |

## Tasks

- [ ] `.agents/tasks/ARCH-012-interactive-session-god-contract.md` — existing task; synchronize at GATE-IMPLEMENT

## Evidence Log
