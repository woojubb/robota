---
status: done
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
waits. A runner itself returns only `succeeded | failed`; a registry completion record may additionally
carry `abandoned` with the stable reason `stopped` or `startup-rollback`. `waitForCompletion()` returns
one terminal record for every runner in registration order: it waits for normal runner settlement, or
fills every still-pending slot with `abandoned` when stop or startup rollback ends the generation. A
late settlement cannot rewrite that terminal snapshot. `waitForFailure()` reports only the first
runner-produced `failed` outcome immediately, without waiting for unrelated runners; it resolves
`undefined` when there are no runners, all runners succeed, or normal stop abandons pending runners.
Runner promise rejection rejects both waits with a stable typed lifecycle error. Result-level nonzero
exit is a normal `failed` outcome, while registry-created abandonment is aggregate lifecycle metadata
and never turns an otherwise normal signal/command shutdown into a CLI failure.

Every adapter must make stop-during-start bounded and generation-safe: once `stop()` is requested
while `start()` is pending, that start may reject or resolve only after preventing later readiness or
resource publication. This is a shared adapter conformance requirement, not something the registry
can simulate for an arbitrary adapter.

The registry owns an explicit idle/starting/active/stopping transition and serializes lifecycle
operations. An active second `startAll()` rejects before attachment or generation replacement.
Startup failure rolls back from the currently failing adapter through every previously started adapter
in reverse order, because the rejecting adapter may already own partial resources. It terminalizes
pending runner records as `startup-rollback` and rejects `startAll()` with a typed
`TransportStartupError`: `transportName` identifies the start that failed, non-enumerable `cause`
preserves the original failure, and `rollbackErrors` is an ordered readonly list of safe
`{ transportName, message }` details. Rollback errors never replace the primary failure.
`waitForFailure()` resolves `undefined` after rollback unless a runner had already produced a real
failed result. `stopAll()` invoked during startup joins/serializes with that transition so no adapter
can publish readiness after stop has completed. A later generation is never mutated by an earlier
runner. Runtime host exposes both waits. Serve-mode uses `waitForFailure()` only for a runner-produced
failed record; normal abandonment does nothing.

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
   exact discriminated adapter contract. A runner must expose `waitForCompletion()` and return only
   succeeded/exit 0 or failed/validated integer exit 1..255, with no raw cause. Registration validates
   the runtime shape and rejects malformed runner/service combinations.
2. Define and enforce detached → attached → starting → ready/running → stopping → stopped behavior,
   typed invalid-transition failures, safe repeated stop, restart only after a new attach, and bounded
   stop-during-start that prevents later readiness/resource publication.
3. Split lifecycle/settings registry views, generalize lifecycle storage/startup to the base adapter,
   couple optional configuration in the same entry, reject duplicate names and invalid settings
   mutations, and preserve P1 rejection ownership/stale-generation protections. Serialize registry
   lifecycle transitions, reject active restart before mutation, and rollback partial startup from
   the currently failing adapter backward. Reject with typed `TransportStartupError` whose primary
   cause remains authoritative and whose ordered safe rollback details remain inspectable.
4. Refactor headless to launch separately from completion and translate its real exit status into the
   typed runner outcome. Carry validated runner failure immediately through registry/runtime-host/CLI
   failure ownership while preserving a separate ordered registry completion outcome whose pending
   entries become `abandoned` on stop/rollback without changing normal process exit.
5. Remove `TuiTransport`; retain existing `renderApp` and `TuiInteractionChannel` as the explicit
   session-owning presentation surfaces.
6. Publish a fixture-driven lifecycle conformance helper from
   `@robota-sdk/agent-interface-transport/testing`; invoke it for all six subjects at their real
   readiness boundary.
7. Add a fail-closed stable-ID roster scan, adversarial missing/duplicate registrations, and an exact
   external-consumer scenario using one custom runner plus shipped configurable WS service.
8. Synchronize all owner SPECs/READMEs and replace the semver-inaccurate P1 changeset with per-package
   classifications and fixed-group coordination. Record the runner-versus-registry outcome ownership
   and lifecycle serialization decision in ADR-003.

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

- [x] TC-01: Public type/runtime tests prove every adapter declares a frozen service/runner lifecycle profile; start-before-attach and repeated active start reject the documented typed error; stop during a pending start is bounded and prevents later readiness/resource publication; repeated stop is safe; and stopped adapters can reattach/restart.
- [x] TC-02: Runner type/runtime tests prove the adapter outcome is exactly succeeded/exit 0 or failed/validated integer exit 1..255 with no raw cause; runner declarations require callable completion; aggregate completion adds only registry-owned `abandoned: stopped | startup-rollback`, contains every runner in registration order, and ignores late settlement; `waitForFailure()` reports only a real failed runner without waiting for a second never-settling runner; normal shutdown abandonment remains `FAILURE=NONE` and cannot change CLI exit; real headless non-success still reaches runtime host/CLI.
- [x] TC-03: Registry type/runtime tests prove a base custom adapter registers without casts, duplicate names reject, a runner does not block service readiness, active start rejects before attachment/generation mutation, stop during startup cannot leak a later start, and partial startup rolls back from the currently failing adapter in reverse order. `startAll()` rejects typed `TransportStartupError` with original non-enumerable cause plus ordered safe rollback details, `waitForFailure()` is undefined absent a real runner failure, lifecycle/settings consumers depend on separate views, configurable entries remain the sole settings projection, and invalid setting mutations reject `TransportConfigurationError`.
- [x] TC-04: Export/type tests prove the TUI presentation host no longer claims borrowed-session adapter conformance, while the roster scan discovers exactly headless, HTTP, MCP, lightweight WS, configurable WS, and WebRTC and fails for missing or duplicate suite registration.
- [x] TC-05: One shared lifecycle conformance kit runs against all six public subjects and verifies attachment, concurrent-start rejection, declared readiness, bounded stop-during-start with no later readiness publication, runner launch/completion separation, safe bounded repeat stop with guaranteed `finally` cleanup, and restart-after-reattach at each real adapter boundary.
- [x] TC-06: `.agents/evals/scenarios/arch-011-custom-transport-agent-run.md` runs an isolated cast-free built-package consumer and exits 0 after proving custom-runner success, shipped-WS readiness, a second pending generation stopped into `abandoned:stopped` with `FAILURE=NONE`, bounded repeated-stop, and cleanup markers.
- [x] TC-07: Affected package build/test/typecheck commands, lifecycle roster scan, conformance scan, scoped harness verification, `pnpm harness:scan`, and `pnpm harness:verify-like-ci` all exit 0; SPECs/READMEs and per-package semver changesets with fixed-group coordination match the final public contract.

## Test Plan

| TC-ID | Test Type                      | Tool / Approach                                                                                                                                                       | Notes                                                                                                                                                                                                                                                  |
| ----- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TC-01 | Type + async state integration | `packages/agent-interface-transport/src/__tests__/transport-lifecycle-conformance.test.ts`                                                                            | `runTransportLifecycleConformance > accepts the documented attach/start/stop/restart state machine`                                                                                                                                                    |
| TC-02 | Async completion integration   | `packages/agent-transport/src/__tests__/transport-registry.contract.test.ts`; `packages/agent-cli/src/modes/__tests__/serve-transport-failure.test.ts`                | `TransportRegistry runner outcomes (ARCH-011) > launches a runner without blocking a service and returns ordered completion records`; `serve runner failure propagation (ARCH-011) > sets the real nonzero runner exit code and enters owned shutdown` |
| TC-03 | Registry state integration     | `packages/agent-transport/src/__tests__/transport-registry.start-all.test.ts`                                                                                         | `TransportRegistry generation ownership (ARCH-011) > rolls back from the failing adapter in reverse order and preserves safe rollback errors`                                                                                                          |
| TC-04 | Export + mechanical contract   | `scripts/harness/__tests__/scan-transport-conformance.test.mjs`                                                                                                       | `transport conformance roster > fails missing and duplicate shared-suite ownership`; direct roster command covers exact six subjects                                                                                                                   |
| TC-05 | Consumer-driven contract       | `packages/agent-interface-transport/src/__tests__/transport-lifecycle-conformance.test.ts`                                                                            | `runTransportLifecycleConformance > rejects a service that exposes runner completion`; six owner fixtures invoke the same helper                                                                                                                       |
| TC-06 | Public SDK process scenario    | `Test skipped:` no Vitest wrapper duplicates the independently executed durable public-SDK scenario                                                                   | Exact scenario: `.agents/evals/scenarios/arch-011-custom-transport-agent-run.md`                                                                                                                                                                       |
| TC-07 | Engineering regression         | `Test skipped:` this criterion aggregates exact build/test/typecheck, scanner, scoped harness, full CI-equivalent, documentation, and changeset verification commands | Each command and result is recorded in per-TC completion evidence                                                                                                                                                                                      |

## Tasks

- [x] `.agents/tasks/completed/ARCH-011-transport-adapter-is-a-lifecycle-stub.md`

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

### [RECOMMENDATION REOPENED] — ⚠️ REVISE | 2026-08-14

**Status reset:** in-progress → draft
Round A returned a FOUNDATIONAL architecture finding. The current revision adds ADR-003, separates
runner outcomes from registry-owned abandonment, defines typed startup rollback and stop-during-start
serialization, and revises TC-01 through TC-07 and the durable scenario. Previous WRITE, APPROVAL,
IMPLEMENT, and scenario-gate evidence remains historical for the superseded revision. No
implementation of this revised recommendation has begun.

### [PROPOSAL-REVIEW] — ✅ ENDORSE | 2026-08-14

**Status remains:** draft
Independent reviewer `arch011_proposal_review` reviewed the current ADR-003/spec/Task/TC/Test Plan
and revised scenario, including aggregate-only abandonment, typed startup rollback,
stop-during-start, and the exact scenario markers. No blocker remains.
`REVIEW VERDICT: ENDORSE`.

### [GATE-WRITE] — ✅ PASS | 2026-08-14

**Status upgrade:** draft → review-ready
The reopened draft and its RECOMMENDATION REOPENED record isolate the superseded gates. The fresh
proposal ENDORSE covers ADR-003, the current TC/Test Plan, and revised scenario. Frontmatter, concrete
problem/reproduction, official prior art, 4/4 architecture checklist, three alternatives with
trade-offs, public-surface placement, and dependency boundaries all pass. TC-01 through TC-07 are
observable and map exactly 7:7 to substantive Test Plan rows; the exact Task pointer and rerun
Evidence Log structure are present. No implementation of the revised recommendation predates this
gate.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-14

**Status upgrade:** review-ready → approved
Explicit approval: `타당한 이유와 함께 추천안을 제시하면 타당할 경우 자동으로 승인하겠습니다.`
The fresh current-revision `[PROPOSAL-REVIEW] — ✅ ENDORSE` satisfies that standing condition for
ADR-003, the revised lifecycle/aggregate/startup contract, TC/Test Plan, and scenario. The reopen
isolates the historical approval; current Architecture Review, `type: DATA`, and
`tags: [typescript, async]` are unchanged since endorsement. Independent placement validation for
the interface-testing and TUI presentation-core boundaries remains applicable. No implementation of
the revised recommendation predates this approval.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-14

**Status upgrade:** approved → in-progress
Fresh reopened approval and approved/todo ordering are valid. Exact Task
`.agents/tasks/ARCH-011-transport-adapter-is-a-lifecycle-stub.md` exists and is named by this spec.
Its seven current unchecked Plan items map one-to-one to revised TC-01 through TC-07, its Test Plan
is substantive, ARCH-012 is done and archived, and Blockers is `None`. No revised package,
application, harness, or changeset implementation predates this gate. Historical P1 work remains
valid Task progress; the refreshed scenario Stage 1 is the next pre-code gate.

### [GATE-VERIFY] — ✅ PASS | 2026-08-14

**Status upgrade:** in-progress → verifying
Task `.agents/tasks/ARCH-011-transport-adapter-is-a-lifecycle-stub.md` has TC-01 through TC-07
checked 7/7 and Blockers `None`. Fresh independent verification of the eight affected packages
passed build and typecheck, plus 246 test files / 1,904 tests. Code→SPEC and SPEC→code comparison
found zero discrepancies across lifecycle/outcome types, registry segregation and rollback,
runtime/CLI propagation, TUI exclusion, the six-subject conformance roster, and public scenario
projections. The scanner suite passed 9/9 and the direct roster scan examined six subjects; fresh
`pnpm harness:scan` passed 111 scans with one intentional skip. The exact scoped harness command
exited `0`, `pnpm harness:verify-like-ci` passed all 12 stages in 7m22.6s, the final post-review
DONE-GATE-STAGE-2 passed, and independent review converged at `ACTIONABLE FINDINGS: 0`.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-14

**Status remains:** verifying
`pnpm --filter @robota-sdk/agent-interface-transport --filter @robota-sdk/agent-transport --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-transport-http --filter @robota-sdk/agent-transport-mcp --filter @robota-sdk/agent-transport-ws --filter @robota-sdk/agent-transport-webrtc build`, `pnpm --filter @robota-sdk/agent-interface-transport --filter @robota-sdk/agent-transport --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-transport-http --filter @robota-sdk/agent-transport-mcp --filter @robota-sdk/agent-transport-ws --filter @robota-sdk/agent-transport-webrtc typecheck`, and `pnpm --filter @robota-sdk/agent-interface-transport --filter @robota-sdk/agent-transport --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-transport-http --filter @robota-sdk/agent-transport-mcp --filter @robota-sdk/agent-transport-ws --filter @robota-sdk/agent-transport-webrtc test` each exited `0`; the combined test run passed 246 files / 1,904 tests. `packages/agent-interface-transport/src/__tests__/transport-lifecycle-conformance.test.ts > runTransportLifecycleConformance > accepts the documented attach/start/stop/restart state machine` passed and observed the frozen service/runner profiles, typed invalid transitions, bounded stop during start, repeat stop, and restart after reattach.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-14

**Status remains:** verifying
`pnpm --filter @robota-sdk/agent-transport --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-cli test` exited `0`. `packages/agent-transport/src/__tests__/transport-registry.contract.test.ts > TransportRegistry runner outcomes (ARCH-011) > launches a runner without blocking a service and returns ordered completion records` passed with exact succeeded/failed outcomes, validated exit codes, registration ordering, registry-owned abandonment, and immediate failure observation. `packages/agent-cli/src/modes/__tests__/serve-transport-failure.test.ts > serve runner failure propagation (ARCH-011) > sets the real nonzero runner exit code and enters owned shutdown` passed, proving runtime-host/CLI propagation without raw-cause exposure or false failure on normal abandonment.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-14

**Status remains:** verifying
`pnpm --filter @robota-sdk/agent-transport --filter @robota-sdk/agent-framework test` and `pnpm --filter @robota-sdk/agent-transport --filter @robota-sdk/agent-framework typecheck` each exited `0`. `packages/agent-transport/src/__tests__/transport-registry.start-all.test.ts > TransportRegistry generation ownership (ARCH-011) > rolls back from the failing adapter in reverse order and preserves safe rollback errors` passed. The same focused suites observed base-adapter registration, duplicate-name rejection, settings-view segregation and recovery, serialized start/stop, coalesced stop, startup preemption, failing-adapter-first reverse rollback, authoritative non-enumerable primary cause, and ordered safe rollback details.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-14

**Status remains:** verifying
`pnpm exec vitest run scripts/harness/__tests__/scan-transport-conformance.test.mjs` exited `0` with 9/9 tests, including `transport conformance roster > fails missing and duplicate shared-suite ownership`. `node scripts/harness/scan-transport-conformance.mjs` exited `0` and reported the exact six public subjects: headless, HTTP, MCP, lightweight WS, configurable WS, and WebRTC. Export/type inspection confirmed the TUI presentation host no longer claims borrowed-session adapter conformance.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-08-14

**Status remains:** verifying
`pnpm --filter @robota-sdk/agent-interface-transport --filter @robota-sdk/agent-transport --filter @robota-sdk/agent-transport-http --filter @robota-sdk/agent-transport-mcp --filter @robota-sdk/agent-transport-ws --filter @robota-sdk/agent-transport-webrtc test` exited `0`. `packages/agent-interface-transport/src/__tests__/transport-lifecycle-conformance.test.ts > runTransportLifecycleConformance > rejects a service that exposes runner completion` passed, and each of the six owner-package fixtures invoked the same public testing helper at its real readiness boundary. The shared suite covered attachment, concurrent-start rejection, bounded stop during start, runner launch/completion separation, repeat stop with cleanup, and restart after reattach.

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-08-14

**Status remains:** verifying
Test skipped: no Vitest wrapper duplicates the independently executed durable public-SDK scenario. The guardian extracted the exact Bash fence from `.agents/evals/scenarios/arch-011-custom-transport-agent-run.md` and ran it with `/bin/bash` from the repository root. The command exited `0` and emitted `STARTED=arch011-runner,ws`, `RUNNER=arch011-runner:succeeded:0`, `ABANDONED=arch011-runner:stopped`, `FAILURE=NONE`, `WS_READY=true`, `STOP=TWICE`, and then `CLEANUP_OK`; the final temp-directory probe found no `robota-arch011.*` path.

### [GATE-COMPLETE: TC-07] — ✅ PASS | 2026-08-14

**Status remains:** verifying
Test skipped: this criterion aggregates engineering verification and owner-document/semver inspection rather than adding a test wrapper around those commands. `pnpm --filter @robota-sdk/agent-interface-transport --filter @robota-sdk/agent-transport --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-transport-http --filter @robota-sdk/agent-transport-mcp --filter @robota-sdk/agent-transport-ws --filter @robota-sdk/agent-transport-webrtc build`, `pnpm --filter @robota-sdk/agent-interface-transport --filter @robota-sdk/agent-transport --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-transport-http --filter @robota-sdk/agent-transport-mcp --filter @robota-sdk/agent-transport-ws --filter @robota-sdk/agent-transport-webrtc typecheck`, and `pnpm --filter @robota-sdk/agent-interface-transport --filter @robota-sdk/agent-transport --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-transport-http --filter @robota-sdk/agent-transport-mcp --filter @robota-sdk/agent-transport-ws --filter @robota-sdk/agent-transport-webrtc test` each exited `0`; tests passed 246 files / 1,904 tests. `node scripts/harness/scan-transport-conformance.mjs` exited `0` with six subjects, `pnpm harness:verify -- --scope packages/agent-interface-transport` exited `0`, `pnpm harness:scan` exited `0` with 111 passes / 1 intentional skip, and `pnpm harness:verify-like-ci` exited `0` with 12/12 stages in 7m22.6s. Direct inspection confirmed the interface/transport/framework SPECs, READMEs, ADR-003, and per-package fixed-group changeset match the final public contract; Prettier and `git diff --check` exited `0`.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-14

**Status upgrade:** verifying → done
Ordering is valid: the current ARCH-011 spec is `verifying` under
`.agents/spec-docs/active/`, and its latest `[GATE-VERIFY] — ✅ PASS | 2026-08-14` precedes this gate.

Completion Criteria TC-01 through TC-07 are checked 7/7. Each has a matching
`[GATE-COMPLETE: TC-N] — ✅ PASS | 2026-08-14` entry recording the exact verification command or
action, the actual observed result, and the applicable exit code.

Test Plan TC-01 through TC-05 name existing test files and exact test or describe names verified
against the current source. TC-06 records an explicit skip because the independently executed durable
public-SDK scenario is the canonical verification and a Vitest wrapper would duplicate it. TC-07
records an explicit skip because it aggregates the exact engineering, documentation, and semver
verification commands rather than introducing a wrapper test. No TC is silently unaddressed.

The exact active Task `.agents/tasks/ARCH-011-transport-adapter-is-a-lifecycle-stub.md` exists, is
checked in the spec, has TC-01 through TC-07 complete 7/7, and records `## Blockers` as `None.`
TC-07 correctly prepares the completion/archive handoff without claiming that post-gate transition
already occurred.

The current changeset, owner SPECs/READMEs, ADR-003, durable scenario, and six conformance-fixture
registrations agree with the TC evidence; `git diff --check` exits `0`. The Task terminal
status/date and archival, archived Task pointer, and spec `verifying/active → done/done` move are now
authorized as the atomic post-PASS handoff, followed by placement and task-archival scans.
