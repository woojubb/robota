---
title: 'ARCH-011: make transport lifecycle semantics executable across every public adapter'
status: in-progress
created: 2026-08-02
priority: critical
urgency: now
area: packages/agent-interface-transport, packages/agent-transport, packages/agent-transport-http, packages/agent-transport-mcp, packages/agent-transport-ws, packages/agent-transport-tui, packages/agent-transport-webrtc, packages/agent-framework, packages/agent-cli, scripts/harness
depends_on: [ARCH-012]
---

# ARCH-011: make transport lifecycle semantics executable

## Objective

Replace the remaining prose-only transport lifecycle dialects with one typed service/runner lifecycle
contract, a shared conformance kit, and a mechanically complete public-adapter roster. Preserve
protocol-specific admission, cancellation, disconnect, and wire-error policies in their owning
packages rather than forcing unlike transports to behave identically.

## Current Problem

P1 fixed the registry deadlock, but its optional `runsToCompletion` flag still makes lifecycle mode
an unchecked convention. The owner SPEC says `start()` and `stop()` are idempotent, while public
implementations recreate resources or work on repeated start. The production headless runner reports
failure by exit code rather than through the completion route that the registry observes. No shared
suite proves attach-before-start, readiness, repeated-call behavior, bounded stop, or completion
outcome for every adapter.

The mismatch is reproducible today:

- `TuiTransport.attach()` ignores the supplied session and creates a separate session internally, so
  it is not an honest implementation of the borrowed-session adapter port.
- `TransportRegistry.register()` accepts only configurable transports even though the lifecycle
  orchestration itself needs only the base adapter contract.
- Six packages expose seven adapter-shaped subjects because the WS package has both a lightweight
  factory and a configurable server. There is no canonical roster or shared suite invocation.
- `createHeadlessTransport()` absorbs execution failure into `getExitCode()`, so
  `waitForCompletion()` cannot observe the real production runner failure.

## Finding-Depth Correction

The original current-state premise is partly INVALID after completed work and must not drive P2:

- P1 already fixed sequential-start deadlock and rejection ownership.
- ARCH-012 already replaced the unaskable session surface with 16 named roles and a zero-cast floor.
- SEC-008 already owns admission parity and documented not-applicable/delegated boundaries.
- Public transport factories now return named package-owned interfaces rather than anonymous
  intersections.
- HTTP, MCP, WS/WebRTC, local TUI, and headless are not required to share one wire cancellation,
  disconnect, admission, or error representation.

The remaining FOUNDATIONAL defect is narrower: attach/start/readiness/stop and runner-completion
semantics are not one executable port contract across all implementations.

## Decisions

- Model two lifecycle profiles: a service becomes ready and continues serving; a runner launches and
  reports terminal outcome through a separate typed completion channel. Concrete packages own their
  readiness boundary; the universal contract does not encode topology names.
- `start()` is not universally idempotent. Starting before attach or starting an already started
  adapter rejects a typed lifecycle error. Repeated `stop()` is safe, bounded, and releases no
  resource twice. A stopped adapter may be attached again and restarted.
- Remove `TuiTransport`; the existing `renderApp` and `TuiInteractionChannel` surfaces already own
  the session-owning TUI presentation flow.
- Separate lifecycle and settings registry views. Lifecycle registration accepts honest base
  adapters; the settings projection lists only configurable adapters. Unknown and non-configurable
  setting mutations reject stable typed configuration errors.
- The shared conformance kit lives on the contract package's public testing subpath. Concrete
  packages supply fixtures; they do not choose the expected lifecycle policy.
- Maintain a fail-closed roster with stable package/export subject IDs for the six remaining public
  adapter subjects: headless, HTTP, MCP, lightweight WS, configurable WS, and WebRTC.
- Preserve current headless meanings: exit 0 (including interrupted prompt) is successful completion;
  nonzero (including unsatisfied/cancelled goal exit 2) is failed completion. Lifecycle does not
  invent a universal cancellation meaning.
- Classify each changed public package independently; the fixed group coordinates the highest bump.
  The existing P1 minor classification is semver-inaccurate where required public types changed.

## Plan

- [ ] TC-01 — Specify service/runner lifecycle profiles, readiness, legal state transitions, and typed lifecycle failures in the contract owner.
- [ ] TC-02 — Add an exact `succeeded | failed` runner outcome with exit code and no raw cause, preserve current headless exit meanings, and propagate production nonzero outcomes through registry, runtime host, and CLI process-lifetime ownership.
- [ ] TC-03 — Split lifecycle/settings registry views, accept base adapters, reject duplicate names, preserve configurable settings/options projection, and type unknown/non-configurable setting failures.
- [ ] TC-04 — Reclassify the TUI session-owning presentation host and establish the exact six-subject adapter roster with fail-closed discovery/registration checks.
- [ ] TC-05 — Add the shared fixture-driven lifecycle conformance kit and invoke it for all six public adapter subjects with protocol-specific readiness drivers.
- [ ] TC-06 — Author and execute the durable cast-free external-consumer scenario using a custom runner plus a shipped configurable WS service.
- [ ] TC-07 — Synchronize owner SPECs/READMEs, correct semver changesets, run affected-package and full harness verification, complete gates, archive, review, and merge.

## Test Plan

- RED first: contract type tests fail until lifecycle profile and runner completion types exist.
- RED first: shared conformance cases reject the current attach/start/stop behavior and missing roster.
- Registry tests cover base-adapter registration, duplicate rejection, service readiness, typed runner
  success/failure, immediate failure observation, runner rejection ownership, stop abandonment, and
  stale generations.
- Every concrete subject runs the same conformance assertions; fixtures only drive its real readiness
  boundary and cleanup.
- The public scenario builds isolated consumers against bare package exports, uses no casts/private
  imports/credentials, and proves sibling service readiness plus custom runner completion.
- Verify affected builds, tests, and typechecks; contract roster and cast scans; conformance; scoped
  harness; full CI-equivalent verification.

## User Execution Test Scenarios

**Applies — public SDK lifecycle composition.**

- Durable artifact: `.agents/evals/scenarios/arch-011-custom-transport-agent-run.md`.
- The isolated consumer's `custom-transport.ts` imports only
  `@robota-sdk/agent-interface-transport`; composition imports the public registry, public testing
  session, and shipped configurable WS transport.
- Exact command: the durable file builds public packages, creates a disposable external-style
  TypeScript consumer, registers a custom runner and shipped WS service, proves service startup is not
  blocked, observes ordered typed completion and no failure, performs bounded repeated stop, and
  proves its temporary consumer tree was removed.
- Expected consumer output: `STARTED=arch011-runner,ws`,
  `RUNNER=arch011-runner:succeeded:0`, `FAILURE=NONE`, `WS_READY=true`, `STOP=TWICE`; Bash then prints
  `CLEANUP_OK` after cleanup.
- The custom runner remains pending until after `startAll()` has returned and `ws.boundPort` is
  asserted, so a registry that waits for runner completion cannot reach the sibling readiness marker.
- Admission, active-turn cancellation, peer disconnect, and protocol wire-error parity are explicitly
  not claimed by this lifecycle scenario.
- Evidence: EMPTY until DONE-GATE-STAGE-2.

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-08-14

**Status remains:** scenario drafted
**Failed criteria:**

- Sibling-readiness proof: the custom runner originally resolved its completion promise immediately,
  so a registry that incorrectly waited for runner completion could still reach and print the WS
  readiness marker.
  **Required action:** keep runner completion pending, prove `startAll()` returns with WS bound, then
  settle the runner explicitly before awaiting aggregate completion.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-14

**Status upgrade:** scenario drafted → scenario written
Scenario: `.agents/evals/scenarios/arch-011-custom-transport-agent-run.md`. Executability is
`agent-executable`; prerequisites are complete and explicitly require no credential or external
service. The exact bounded command drives an isolated public SDK consumer. Its custom runner remains
pending until `startAll()` returns and the shipped WS service exposes its bound port, after which the
scenario explicitly completes the runner and verifies ordered typed completion, no failure, repeated
stop, exact output, and cleanup. Evidence fields remain EMPTY until post-implementation execution.
The prior Stage 1 failure is preserved and its pending-runner correction is resolved. No current P2
implementation work had begun at this gate.

## Progress

### 2026-08-02 — P1 complete

- Added `runsToCompletion`, nonblocking registry startup, owned completion failure replay,
  `ITransportRegistryView.waitForCompletion()`, runtime-host reachability, and serve-mode failure
  observation.
- Added regressions for unhandled rejection, stop abandonment, stale generations, current-entry
  ownership, and rejection with `undefined`.
- P1 deliberately left the production headless exit-code result channel and shared conformance suite
  for the remaining work.

### 2026-08-14 — premise and scope corrected

- Re-audited current code after P1, SEC-008, and ARCH-012.
- Counted seven current adapter-shaped public subjects and identified TUI's false attach contract.
- Removed resolved admission/session/intersection/deadlock claims and invalid universal protocol parity
  from the remaining direction.
- Chose a lifecycle-only contract and six-subject conformance boundary.

## Blockers

None.

## Result

Pending.
