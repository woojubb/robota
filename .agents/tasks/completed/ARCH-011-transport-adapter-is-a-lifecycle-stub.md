---
title: 'ARCH-011: make transport lifecycle semantics executable across every public adapter'
status: done
created: 2026-08-02
completed: 2026-08-14
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

- [x] TC-01 — Specify service/runner lifecycle profiles, readiness, legal state transitions, typed lifecycle failures, and bounded stop-during-start that prevents later readiness/resource publication.
- [x] TC-02 — Enforce a discriminated service/runner adapter with callable completion and validated nonzero failure exit; keep runner `succeeded | failed` separate from registry-only `abandoned: stopped | startup-rollback`, preserve ordered complete aggregates, and propagate only real runner failure through runtime host/CLI.
- [x] TC-03 — Split lifecycle/settings registry views, accept base adapters, reject duplicate names and active restart before mutation, serialize start/stop, rollback from the currently failing adapter in reverse order, and reject typed `TransportStartupError` with authoritative original cause plus ordered safe rollback details while preserving configurable settings/options projection and typed invalid setting failures.
- [x] TC-04 — Reclassify the TUI session-owning presentation host and establish the exact six-subject adapter roster with fail-closed discovery/registration checks.
- [x] TC-05 — Add the shared fixture-driven lifecycle conformance kit with concurrent-start, bounded stop-during-start/no late readiness, runner capability/launch separation, and `finally` cleanup; invoke it for all six public adapter subjects with protocol-specific readiness drivers.
- [x] TC-06 — Author and execute the durable cast-free external-consumer scenario using a custom runner plus shipped configurable WS, including normal-stop `abandoned:stopped` aggregate with `FAILURE=NONE`.
- [x] TC-07 — Synchronize owner SPECs/READMEs and semver changesets, run affected-package and full harness verification, and prepare the completion/archive handoff.

## Test Plan

- RED first: contract type tests fail until lifecycle profile and runner completion types exist.
- RED first: shared conformance cases reject the current attach/start/stop behavior and missing roster.
- Registry tests cover base-adapter registration, duplicate rejection, service readiness, active-start
  rejection, start/stop serialization, reverse partial-start rollback, typed runner success/failure,
  immediate failure observation, aggregate-only stop/rollback abandonment, and stale generations.
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
  blocked, observes ordered typed success, starts a second pending generation, proves normal stop
  yields ordered `abandoned:stopped` with no failure, performs bounded repeated stop, and proves its
  temporary consumer tree was removed.
- Expected consumer output: `STARTED=arch011-runner,ws`,
  `RUNNER=arch011-runner:succeeded:0`, `ABANDONED=arch011-runner:stopped`, `FAILURE=NONE`,
  `WS_READY=true`, `STOP=TWICE`; Bash then prints `CLEANUP_OK` after cleanup.
- The custom runner remains pending until after `startAll()` has returned and `ws.boundPort` is
  asserted, so a registry that waits for runner completion cannot reach the sibling readiness marker.
- Admission, active-turn cancellation, peer disconnect, and protocol wire-error parity are explicitly
  not claimed by this lifecycle scenario.
- Evidence: the durable scenario's `## Observed evidence` records the independently verified six
  lifecycle lines, exit `0`, `CLEANUP_OK`, and the empty residual-temp-path scan.

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

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-14

**Status upgrade:** scenario written → scenario verified
The guardian independently extracted and executed the durable scenario's current Bash fence from the
repository root. The command exited `0`; the isolated public consumer printed exactly
`STARTED=arch011-runner,ws`, `RUNNER=arch011-runner:succeeded:0`, `FAILURE=NONE`,
`WS_READY=true`, and `STOP=TWICE`, after which Bash printed `CLEANUP_OK`. No
`robota-arch011.*` temporary directory remained. Package build output was setup only; the qualifying
evidence is the public lifecycle composition, typed outcome, sibling readiness, repeated stop, and
cleanup recorded in `.agents/evals/scenarios/arch-011-custom-transport-agent-run.md`.

### [SCENARIO VERIFICATION REOPENED] | 2026-08-14

**Status reset:** scenario verified → scenario drafted
Round A exposed that normal stop needs an explicit registry-owned `abandoned:stopped` aggregate
without becoming a process failure. The previous Stage-2 PASS remains historical evidence for the
superseded success-only scenario at
`.agents/evals/scenarios/arch-011-custom-transport-agent-run.md`. The durable command, Stage-1 gate,
direct execution, and Stage-2 evidence must all be refreshed for the revised observable before
completion.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-14

**Status upgrade:** scenario drafted → scenario written
The revised durable scenario is agent-executable, bounded, public-SDK-only, and requires no
credential or external service. It proves first-generation runner success and shipped WS readiness,
then starts a second pending generation and requires `stopAll()` to produce the ordered
`abandoned:stopped` aggregate while `waitForFailure()` remains `undefined`. Repeated stop, exact six
consumer markers, basename-validated cleanup, and `CLEANUP_OK` are all specified. Observed evidence
remains `EMPTY` until implementation and direct Stage-2 execution.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-14

**Status upgrade:** scenario written → scenario verified
Scenario: `.agents/evals/scenarios/arch-011-custom-transport-agent-run.md`.

The guardian independently extracted and executed the durable scenario's exact current Bash fence
from the repository root against the revised ARCH-011 implementation. The command exited `0`. The
isolated public SDK consumer printed exactly `STARTED=arch011-runner,ws`,
`RUNNER=arch011-runner:succeeded:0`, `ABANDONED=arch011-runner:stopped`, `FAILURE=NONE`,
`WS_READY=true`, and `STOP=TWICE`. Bash then removed the basename-validated temporary consumer,
proved its path absent, and printed `CLEANUP_OK`; a final `${TMPDIR:-/tmp}/robota-arch011.*` scan
returned no residual paths. Package-build output was setup only and was not used as user-execution
evidence.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-14

**Status upgrade:** scenario written → scenario verified
Post-final-review refresh: after Round A converged at `ACTIONABLE FINDINGS: 0`, the guardian freshly
executed the durable scenario's exact Bash fence against the final registry/settings/WebRTC/scanner
tree. It exited `0` and printed exactly `STARTED=arch011-runner,ws`,
`RUNNER=arch011-runner:succeeded:0`, `ABANDONED=arch011-runner:stopped`, `FAILURE=NONE`,
`WS_READY=true`, `STOP=TWICE`, and `CLEANUP_OK`. A final `/tmp/robota-arch011.*` scan returned no
paths. This refresh supersedes the pre-final-review Stage-2 execution; build output remained setup
only, and the durable scenario owns the concrete product evidence.

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

### 2026-08-14 — P2 implementation and review complete

- Implemented typed service/runner lifecycle outcomes, generation-owned registry completion,
  serialized start/stop rollback, orthogonal settings capability, and real failure propagation.
- Added the six-subject shared conformance kit and fail-closed AST roster, including dist-only
  presentation-package source inspection.
- Independent Round A review converged at `ACTIONABLE FINDINGS: 0`; the post-review public SDK
  scenario passed with exact output and cleanup.
- Affected package build/test/typecheck passed; `pnpm harness:verify -- --scope
packages/agent-interface-transport` exited `0`; `pnpm harness:scan` passed 111 scans with one
  intentional skip; and `pnpm harness:verify-like-ci` passed all 12 stages in 7m22.6s.

## Blockers

None.

## Result

Completed the executable transport lifecycle contract across the six public adapter subjects. The
change replaces optional runner guessing with typed service/runner outcomes, separates immediate
failure from ordered aggregate completion, makes registry startup/rollback and stop serialization
explicit, preserves settings as an orthogonal capability, removes the false TUI adapter claim, and
adds a shared conformance kit plus a fail-closed six-subject roster. Runtime-host/CLI propagation,
owner SPECs/READMEs, ADR-003, and coordinated semver metadata are synchronized. Independent review
converged with zero actionable findings; affected build/typecheck/test, scoped verification, 111
harness scans, all 12 CI-equivalent stages, and the durable public-SDK scenario passed.
