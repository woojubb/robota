---
status: in-progress
type: DATA
tags: [typescript, async]
---

# ARCH-011: Executable transport lifecycle conformance

## Problem

P1 made `TransportRegistry.startAll()` nonblocking for adapters that declare the optional
`runsToCompletion` flag, but the remaining base lifecycle is still prose rather than one executable
contract. The owner SPEC says `start()` and `stop()` are idempotent while current adapters recreate
servers, subscriptions, peers, UI work, or prompt execution on repeated start. A production runner
can finish unsuccessfully by exit code while the registry's completion route observes only rejected
promises. There is no shared suite or complete roster that fails when one public adapter omits the
agreed attach/readiness/stop/completion semantics.

The defect reproduces on current public surfaces:

1. `TuiTransport.attach()` discards its supplied session and the TUI creates another session.
2. A custom base `ITransportAdapter` cannot be registered because the settings-backed registry only
   accepts `IConfigurableTransport<IInteractiveSession>`.
3. `createHeadlessTransport()` converts prompt failure to a nonzero exit code, so
   `TransportRegistry.waitForCompletion()` resolves rather than reporting that production failure.
4. The WS package contains two distinct adapter implementations, but no mechanical roster requires
   either one—nor the other five current subjects—to invoke common lifecycle assertions.

The original ARCH-011 problem statement is historical in four respects. P1 fixed the startup
deadlock, ARCH-012 established named session-capability roles and a zero-cast floor, SEC-008 owns
admission coverage, and public factories now return named interfaces rather than anonymous
intersections. Those completed or protocol-specific axes are not reopened here.

## Prior Art Research

- [Node.js `net.Server`](https://nodejs.org/api/net.html) separates lifecycle milestones:
  `listen()` becomes usable at the `listening` event, repeated `listen()` while active throws
  `ERR_SERVER_ALREADY_LISTEN`, and `close()` settles after acceptance ceases. This favors explicit
  legal states over an undocumented universal idempotence claim.
- [Node.js `ChildProcess`](https://nodejs.org/api/child_process.html) separates successful launch
  (`spawn`) from terminal outcome (`exit`/`close`, exit code, or signal). Service readiness and runner
  completion therefore need different channels.
- [Kubernetes probes](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes)
  distinguish startup from readiness to accept traffic, while
  [init containers](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/) are explicitly
  run-to-completion rather than continuously serving. A single ambiguous `start()` completion meaning
  is insufficient for both profiles.
- [gRPC health checking](https://grpc.io/docs/guides/health-checking/) makes readiness an explicit
  `SERVING`/`NOT_SERVING` state and prevents work before readiness. Robota's service `start()` must
  resolve at an externally usable readiness point, not merely after object construction.
- Oracle's [JavaTest/TCK architecture](https://docs.oracle.com/javacomponents/javatest-4-6/architect-guide/html/intro.htm)
  keeps specification assertions in a reusable suite and supplies implementation-specific plug-ins.
  Robota should likewise own assertions once and let package fixtures drive concrete resources.
- MCP deliberately defines transport-specific shutdown mechanisms rather than one universal wire
  action ([MCP lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)).
  That supports keeping admission, cancellation, disconnect, and wire-error projections in their
  protocol owners while sharing only lifecycle invariants.

## Architecture Review

### Affected Scope

- `packages/agent-interface-transport` — lifecycle types, errors, testing conformance kit, owner SPEC.
- `packages/agent-transport` — base-adapter registry, typed runner completion aggregation, headless
  runner, registry tests and SPEC/README.
- `packages/agent-transport-http` — embedded-handler readiness fixture and lifecycle conformance.
- `packages/agent-transport-mcp` — embedded-server readiness fixture and lifecycle conformance.
- `packages/agent-transport-ws` — lightweight-handler and bound-server fixtures/conformance.
- `packages/agent-transport-webrtc` — offer/signaling-readiness fixture/conformance.
- `packages/agent-transport-tui` — remove the false borrowed-session adapter classification and its
  export; retain existing `renderApp`/`TuiInteractionChannel` presentation surfaces.
- `packages/agent-framework`, `packages/agent-cli` — runner completion result reachability.
- `scripts/harness` — public-adapter roster completeness scan and regression fixtures.
- `.changeset`, package SPECs/READMEs, Task/spec/scenario evidence.

### Alternatives Considered

1. **Retain optional `runsToCompletion` and add only package-local tests.**
   - Pro: smallest source and semver change.
   - Con: silence still chooses lifecycle mode, headless result failure remains invisible, TUI still
     falsely implements attach, and the next adapter can omit parity unnoticed.
2. **Specify admission, cancellation, disconnect, error shape, session surface, and lifecycle as one
   identical universal behavior.**
   - Pro: one superficially uniform matrix.
   - Con: it erases intentional topology differences: local/headless have no peer admission, HTTP
     cancels on disconnect, WS detaches while work continues, and WebRTC resumes. SEC-008 and
     ARCH-012 already own two of these axes.
3. **Adopt a narrow service/runner lifecycle contract plus shared conformance and a complete roster.**
   - Pro: fixes the recurring port defect at its owner, makes production runner failure observable,
     and mechanically covers every public implementation without importing protocol dialects into
     the universal package.
   - Con: required lifecycle members and TUI reclassification are coordinated breaking changes, and
     every adapter needs a real readiness fixture.

### Decision

Choose alternative 3. The universal contract owns only session attachment, lifecycle profile,
readiness, legal start/stop transitions, and runner terminal outcome. Protocol packages continue to
own their admission, cancellation, peer-disconnect, and wire-error behavior.

Add a required frozen lifecycle descriptor whose only universal discriminant is
`kind: 'service' | 'runner'`. Each concrete package SPEC and fixture owns its readiness boundary:
HTTP/MCP/lightweight WS expose constructed handlers or servers, configurable WS exposes a bound
endpoint, and WebRTC exposes published-offer/signaling readiness. WebRTC does not wait for an external
answer, data channel, or pairing decision, so protocol-owned admission cannot block registry startup.

Runner `start()` resolves after launch. `ITransportRunnerAdapter` adds
`waitForCompletion(): Promise<ITransportRunOutcome>`, where the exact outcome is either
`{ status: 'succeeded'; exitCode: 0 }` or `{ status: 'failed'; exitCode: number }` with a nonzero exit
code and no raw cause. Current headless behavior remains authoritative: interrupted prompt exit 0 is
successful; unsatisfied or cancelled goal exit 2 is failed. The universal lifecycle does not invent
a cancellation meaning that the runner does not currently expose.

Starting before attach or starting an active adapter rejects a stable typed lifecycle error. A
repeated stop is safe and bounded; after stop, a new attach/start generation is allowed. This
replaces the stale blanket idempotence prose with explicit state semantics.

Registry responsibilities are interface-segregated. `ITransportLifecycleRegistryView` owns base
registration/start/completion/stop. `ITransportSettingsRegistryView` owns the existing configurable
entry projection and settings mutations. `ITransportRegistryView` composes both only for products
that need both. Runtime host depends only on the lifecycle view; `TransportTUI` depends only on the
settings view. A single registry entry couples one adapter with its optional configuration capability;
there are no parallel adapter/config collections. Base adapters are lifecycle-enabled by registration
and absent from the settings list. `setEnabled`/`setOptions` for an unknown or non-configurable name
reject a stable typed `TransportConfigurationError`; they never silently create settings.

Duplicate lifecycle names reject, but roster identity is independent of runtime `name`. The six
stable subject IDs are package/export pairs:

- `@robota-sdk/agent-transport#createHeadlessTransport`
- `@robota-sdk/agent-transport-http#createHttpTransport`
- `@robota-sdk/agent-transport-mcp#createMcpTransport`
- `@robota-sdk/agent-transport-ws#createWsTransport`
- `@robota-sdk/agent-transport-ws#WsTransport`
- `@robota-sdk/agent-transport-webrtc#WebRtcTransport`

`TuiTransport` is removed from the adapter family and public export. No replacement abstraction is
invented: existing `renderApp` and `TuiInteractionChannel` are the session-owning presentation
surfaces. The conformant roster therefore contains exactly the six package/export subjects above.
The contract testing subpath owns pure assertions without Vitest or another bare runtime dependency;
fixtures in concrete packages drive readiness and cleanup. A harness scan discovers adapter subjects
and requires exactly one shared-suite invocation for each stable subject ID.

The new testing export follows the existing `@robota-sdk/agent-interface-transport/testing` family
that owns `createTestInteractiveSession` and session-capability test producers: it is universal
contract-library support, not a product or a dependency on a concrete transport sibling. The TUI
reclassification follows the existing `agent-transport-gui` presentation-core family: presentation
hosts own rendering and interaction composition rather than pretending to be borrowed-session I/O
adapters. The TUI package does not depend on the GUI sibling; both reuse lower shared interaction and
session contracts.

The registry observes each runner immediately to prevent unhandled rejection and exposes two distinct
waits. `waitForCompletion()` returns a generation snapshot of named typed outcomes in registration
order after all runners in that generation settle. `waitForFailure()` reports the first observed
nonzero outcome immediately, without waiting for unrelated runners; it resolves `undefined` when
there are no runners, when all runners finish with exit 0, or when stop abandons the generation.
Runner promise rejection rejects both waits with a stable typed lifecycle error; result-level nonzero
exit is a normal `failed` outcome, not an exception. `stopAll()` forgets later stale settlements, and
a later generation is never mutated by an earlier runner. Runtime host exposes both waits. Serve-mode
uses `waitForFailure()`: a returned nonzero record sets its exit code and initiates the existing owned
shutdown path, while `undefined` does nothing. One failed runner therefore terminates promptly even
when another runner never settles; ordinary consumers can still request the deterministic aggregate.

This recommendation was checked against all current production consumers, the planned external
consumer, all seven current adapter-shaped exports, restart/session-switch behavior, multi-runner
ordering, unhandled rejection timing, stop abandonment, stale runner generations, repeated
transitions, missing attachment, duplicate names, TUI ownership, and protocol-specific policy
boundaries.

Semver is classified per package, then coordinated by the fixed group: `agent-interface-transport`,
`agent-transport`, `agent-framework`, `agent-transport-http`, `agent-transport-mcp`,
`agent-transport-ws`, and `agent-transport-webrtc` are major because exported implementer contracts
or required return types change; `agent-transport-tui` is major because `TuiTransport` is removed;
`agent-cli` is patch if only process behavior changes without a public type change. Every changed
public package receives a changeset even though the fixed group applies the highest bump globally.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — six conformant subjects plus the session-owning TUI export were inspected
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Replace optional `runsToCompletion` guessing with a frozen service/runner discriminant and an
   exact runner completion capability: succeeded/exit 0 or failed/nonzero exit, with no raw cause.
2. Define and enforce detached → attached → starting → ready/running → stopping → stopped behavior,
   typed invalid-transition failures, safe repeated stop, and restart only after a new attach.
3. Split lifecycle/settings registry views, generalize lifecycle storage/startup to the base adapter,
   couple optional configuration in the same entry, reject duplicate names and invalid settings
   mutations, and preserve P1 rejection ownership/stale-generation protections.
4. Refactor headless to launch separately from completion and translate its real exit status into the
   typed runner outcome. Carry non-success immediately through registry/runtime-host/CLI failure
   ownership while preserving ordered aggregate completion for ordinary consumers.
5. Remove `TuiTransport`; retain existing `renderApp` and `TuiInteractionChannel` as the explicit
   session-owning presentation surfaces.
6. Publish a fixture-driven lifecycle conformance helper from
   `@robota-sdk/agent-interface-transport/testing`; invoke it for all six subjects at their real
   readiness boundary.
7. Add a fail-closed stable-ID roster scan, adversarial missing/duplicate registrations, and an exact
   external-consumer scenario using one custom runner plus shipped configurable WS service.
8. Synchronize all owner SPECs/READMEs and replace the semver-inaccurate P1 changeset with per-package
   classifications and fixed-group coordination.

## Affected Files

- `packages/agent-interface-transport/src/{transport-adapter,transport-config}.ts`
- `packages/agent-interface-transport/src/testing/**`, exports, tests, `docs/SPEC.md`
- `packages/agent-transport/src/{transport-registry,headless/**}`, tests, `docs/SPEC.md`, `README.md`
- `packages/agent-transport-{http,mcp,ws,webrtc,tui}/src/**`, tests, SPECs/READMEs
- `packages/agent-framework/src/runtime/**`, tests and SPEC if its public result changes
- `packages/agent-cli/src/modes/**` and tests if process-lifetime outcome handling changes
- `scripts/harness/scan-transport-conformance*.mjs` and tests/registration
- `.changeset/arch-011-*.md`
- `.agents/evals/scenarios/arch-011-custom-transport-agent-run.md`
- ARCH-011 Task/spec and AGREEMENT-001 projections on completion

## Completion Criteria

- [ ] TC-01: Public type/runtime tests prove every adapter declares a frozen service/runner lifecycle profile; start-before-attach and repeated active start reject the documented typed error, repeated stop is safe, and stopped adapters can reattach/restart.
- [ ] TC-02: Runner tests prove the public outcome is exactly succeeded/exit 0 or failed/nonzero exit with no raw cause; interrupted prompt remains exit 0 and unsatisfied/cancelled goal remains exit 2; aggregate records return in registration order; `waitForFailure()` reports a failed runner without waiting for a second never-settling runner; real headless non-success reaches runtime host/CLI; and runner rejection, stop abandonment, or stale settlement cannot escape or corrupt a later generation.
- [ ] TC-03: Registry type/runtime tests prove a base custom adapter registers without casts, duplicate names reject, a runner does not block service readiness, lifecycle and settings consumers depend on separate views, configurable entries remain the sole settings projection, and unknown/non-configurable setting mutations reject `TransportConfigurationError`.
- [ ] TC-04: Export/type tests prove the TUI presentation host no longer claims borrowed-session adapter conformance, while the roster scan discovers exactly headless, HTTP, MCP, lightweight WS, configurable WS, and WebRTC and fails for missing or duplicate suite registration.
- [ ] TC-05: One shared lifecycle conformance kit runs against all six public subjects and verifies attachment, declared readiness, invalid repeat start, safe bounded repeat stop, and restart-after-reattach at each real adapter boundary.
- [ ] TC-06: `.agents/evals/scenarios/arch-011-custom-transport-agent-run.md` runs an isolated cast-free built-package consumer and exits 0 after printing exact custom-runner completion, shipped-WS readiness, bounded repeated-stop, and cleanup markers.
- [ ] TC-07: Affected package build/test/typecheck commands, lifecycle roster scan, conformance scan, scoped harness verification, `pnpm harness:scan`, and `pnpm harness:verify-like-ci` all exit 0; SPECs/READMEs and per-package semver changesets with fixed-group coordination match the final public contract.

## Test Plan

| TC-ID | Test Type                      | Tool / Approach                                                                                                                 | Notes                                                                      |
| ----- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| TC-01 | Type + async state integration | Vitest type assertions and table-driven lifecycle transition tests in interface-transport                                       | RED before required profile/error and state behavior exist                 |
| TC-02 | Async completion integration   | Vitest real-headless + registry/runtime-host/CLI tests with controlled ordered outcomes, rejection, abandonment and generations | Pins exact exit meanings, safe outcome shape and production propagation    |
| TC-03 | Registry interface segregation | Vitest public type/runtime tests for base registration, duplicate rejection, split views and typed invalid settings mutations   | Preserves configurable UI/options without requiring config for lifecycle   |
| TC-04 | Export + mechanical contract   | Vitest public export tests and `scan-transport-conformance` adversarial fixtures                                                | Explicitly proves TUI exclusion and exact six-subject roster               |
| TC-05 | Consumer-driven contract       | Shared fixture-driven suite invoked from all six concrete subject packages                                                      | Fixtures drive resources; expected semantics come from contract descriptor |
| TC-06 | Public SDK process scenario    | Bounded Bash + TypeScript isolated consumer using built bare package exports                                                    | No casts, private imports, credentials, or external network                |
| TC-07 | Engineering regression         | Filtered package commands, harness scans, scoped verify and CI-equivalent verify                                                | Includes exact changeset and SPEC inspection                               |

## Tasks

- [ ] `.agents/tasks/ARCH-011-transport-adapter-is-a-lifecycle-stub.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-14

**Status upgrade:** draft → review-ready
Frontmatter is valid with the allowed DATA type and TypeScript/async tags. The Problem records four
current public-surface reproductions and separates completed P1/SEC-008/ARCH-012 premises from the
remaining lifecycle defect. Official Node.js, Kubernetes, gRPC, JavaTest/TCK, and MCP documentation
feeds three alternatives and the selected narrow lifecycle decision. All four Architecture Review
items are checked; the universal interface-testing and TUI presentation-core analogues, product-family
classifications, and lower shared-contract boundaries are explicit. The independently validated
recommendation defines service/runner lifecycle, exact exit outcomes, immediate failure versus ordered
completion waits, segregated lifecycle/settings views, removal of the false TUI adapter, stable
six-subject IDs, and per-package semver with fixed-group coordination. Completion Criteria TC-01
through TC-07 are observable and match seven substantive Test Plan rows exactly. The Task pointer is
present, and there are no forbidden body status/classification sections.

### [PROPOSAL-REVIEW] — ✅ ENDORSE | 2026-08-14

**Status remains:** review-ready
Independent reviewer `arch011_proposal_review` checked the current recommendation against every
public adapter implementation and consumer. Two REVISE rounds corrected WebRTC readiness, registry
view segregation, runner exit semantics, TUI removal, stable roster identity, per-package semver, and
the failed-runner-plus-never-settling-runner liveness case. The final review confirmed that the
universal contract owns only service/runner lifecycle; concrete packages own readiness and protocol
policy; the pure testing helper is correctly placed in the contract package's testing family; the TUI
remains in the presentation-core family without a sibling-product dependency; immediate failure and
ordered aggregate waits are both executable; and all six honest adapter subjects are covered by
stable package/export IDs. `REVIEW VERDICT: ENDORSE`.

### [GATE-APPROVAL] — ❌ FAIL | 2026-08-14

**Status remains:** review-ready
**Failed criteria:**

- Independent architecture validation record: the current independent proposal reviewer returned
  `REVIEW VERDICT: ENDORSE`, but the spec Evidence Log did not contain a distinct recorded verdict
  for the new testing surface and TUI presentation-core placement.
  **Required action:** append the current independent ENDORSE verdict with its placement conclusions,
  then rerun GATE-APPROVAL against the unchanged Architecture Review and frontmatter.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-14

**Status upgrade:** review-ready → approved
Explicit approval: `타당한 이유와 함께 추천안을 제시하면 타당할 경우 자동으로 승인하겠습니다.`
The recommendation's validity condition was satisfied by the independent
`[PROPOSAL-REVIEW] — ✅ ENDORSE | 2026-08-14` verdict, which reviewed the current ARCH-011 revision and
endorsed its interface-testing and TUI presentation-core placement without sibling-product
dependencies. The Architecture Review and frontmatter `type: DATA` / `tags: [typescript, async]`
remain unchanged from the endorsed revision. The prior GATE-APPROVAL failure is preserved and its
missing-record requirement is resolved. No implementation work has begun.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-14

**Status upgrade:** approved → in-progress
Task file: `.agents/tasks/ARCH-011-transport-adapter-is-a-lifecycle-stub.md`. The Task contains seven
current unchecked Plan items corresponding one-to-one with TC-01 through TC-07: lifecycle contract;
runner outcomes and propagation; registry segregation; TUI/roster; six-subject shared conformance;
public consumer scenario; and documentation, semver, verification, completion, and merge. Its Test
Plan is substantive and covers the required development and verification paths. ARCH-012 is complete
and archived, and the Task records no blockers. No current P2 implementation diff exists. Historical
P1 was completed under this same pre-existing Task and is preserved as prior progress rather than
premature P2 implementation.
