---
status: in-progress
type: BEHAVIOR
tags: [typescript, async, cli]
---

# BEHAVIOR-008: Give Interactive Execution State a Single Claim Owner

## Problem

RUNTIME-005 stage 1 made permission approval waits observe the turn `AbortSignal` and fail closed,
but its remaining stage-2 finding is still structurally present in
`SessionExecutionController`: prompt turns, fork skills, and blocking foreground commands each write
the same public `executing` boolean and each unconditionally clears it from its own `finally` block.
The boolean records occupancy but cannot identify which asynchronous operation owns the release.

The task's original `/compact` reproduction premise is stale. Current
`InteractiveSessionBase.executeCommand()` checks `execCtrl.executing` and returns an explicit busy
result before `SessionSkillRouter` can start a blocking command, including calls from the TUI, HTTP,
MCP, and WebSocket transports. Existing tests confirm a second public command is refused. The
remaining defect is therefore an unenforced internal ownership invariant: a future or internal call
that reaches a second execution path can run a foreign `finally`, set the shared boolean false, emit
idle state, and drain `PendingInputQueue` while the first operation is still live. The controller's
API makes that invalid state representable, and no identity check prevents stale release.

RUNTIME-005 also lacks its requested full-session proof that aborting a turn parked on a permission
handler settles the turn and returns `Session.isRunning()` to false within a bounded interval. The
existing eight tests stop at `PermissionEnforcer` and its wrapper wiring.

## Prior Art Research

- Java structured concurrency treats related asynchronous work as one owned scope: cancellation
  prevents new work, but the owner does not report completion until unfinished children terminate.
  This supports retaining a Robota execution claim until its prompt, fork skill, or foreground
  command actually unwinds. [Oracle `StructuredTaskScope`](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html)
- Node's `AbortSignal` is a one-shot cancellation notification. Consumers must account for an
  already-aborted signal and use one-shot listeners; cancellation notification is separate from
  ownership release. [Node.js `AbortSignal`](https://nodejs.org/api/globals.html#class-abortsignal)
- Tokio synchronization guards model exclusive ownership through a guard whose lifetime represents
  the right to release access. The transferable principle is an opaque claim token: only its holder
  may release the session. [Tokio synchronization guards](https://docs.rs/tokio/latest/tokio/sync/)
- Kubernetes Leases express the same identity requirement with `holderIdentity`: a lease is not
  merely held, but held by a specific claimant. Robota needs the identity property, not TTL or
  renewal. [Kubernetes Lease API](https://kubernetes.io/docs/reference/kubernetes-api/coordination/lease-v1/)
- POSIX terminals designate one foreground process group and transfer that role explicitly. This is
  an architectural analogy: prompts, fork skills, and blocking slash commands should acquire the
  same foreground authority rather than independently writing a shared flag.
  [POSIX `tcsetpgrp`](https://pubs.opengroup.org/onlinepubs/9699919799/functions/tcsetpgrp.html)

The common constraint is identity-bound release: cancellation asks the active owner to stop, while
only that owner's unwind completes the lifecycle. A boolean or reference count cannot prove release
identity. Robota should therefore retain its current reject/queue policy while representing the
foreground owner with an opaque controller-owned claim.

## Architecture Review

### Affected Scope

- `packages/agent-framework`
  - `src/interactive/interactive-session-execution-controller.ts`
  - `src/interactive/interactive-session-base.ts`
  - focused controller and real `InteractiveSession` functional tests
  - `docs/SPEC.md`
- `packages/agent-session`
  - a full `Session.run()` approval-abort integration regression
  - `docs/SPEC.md` correction for the now-cancellable permission wait
- `.agents/tasks/RUNTIME-005-a-turn-parked-on-approval-is-not-cancellable.md`
- `.agents/evals/scenarios/runtime-005-approval-abort-agent-run.md`

### Alternatives Considered

1. **Controller-owned opaque execution claim.** Replace writable `executing` state with a private
   active claim; all three execution kinds synchronously acquire it, and only matching-token release
   may transition idle and drain the queue.
   - Pro: makes stale/foreign release structurally ineffective and keeps one admission/lifecycle
     owner.
   - Con: tests and internal callers must stop mutating or assuming a public boolean.
2. **Promise mutex that serializes every operation.** Commands wait behind prompts.
   - Pro: exclusion is simple.
   - Con: silently changes current user-visible busy rejection into waiting and creates a second
     queue beside `PendingInputQueue`.
3. **Reference count or generation number.** Track more information around the boolean.
   - Pro: smaller textual change.
   - Con: a count still has no holder identity; a generation number is an untyped token that is
     easier to bypass.
4. **Keep the boolean and add another caller guard.** Rely on public `executeCommand()` and fork
   checks.
   - Pro: current public behavior already passes.
   - Con: leaves three release writers and makes correctness depend on every future caller
     remembering a distributed precondition.

### Decision

Choose alternative 1. `SessionExecutionController` owns a private `activeClaim` and exposes only
derived busy state plus synchronous acquisition through its three execution entry points. A claim
contains opaque identity and execution kind (`prompt`, `fork-skill`, or `foreground-command`).
Release accepts the exact claim and performs the idle transition, thinking/workspace events,
persistence, and synchronous queued-turn handoff only for the current holder. A foreign or stale
claim cannot clear a successor or drain pending input.

Public policy remains unchanged: prompt submissions encountering a live claim use the existing
attributed pending queue; public blocking commands and fork-skill starts encountering a live claim
return or throw the existing explicit busy outcome. Acquisition happens before the first `await` or
state mutation. Abort signals the active operation but never releases its claim; the holder retains
it until its `finally` finishes.

Reachability was checked across every current entry: `InteractiveSession.submit()` reaches prompt
execution; user/model skill routing reaches fork execution; all TUI/HTTP/MCP/WebSocket commands
reach the public command busy guard before foreground execution. Capability is preserved: queue
coalescing, required turn identity, driver attribution, thinking/workspace events, persistence, and
synchronous queue handoff remain. Adversarial cases are foreign/stale release, two simultaneous
public commands, command during prompt, prompt during foreground/fork execution, abort-before-unwind,
and release-time queue drain.

This is an internal state-owner refactor within the existing `agent-framework` interactive runtime;
it introduces no package, product, transport, or public SDK surface. The closest analog is
`agent-session`'s `TurnClaim`, which already binds run ownership to an identity and releases only
from the owning turn's completion. The framework claim mirrors that proven layer locally rather
than importing a sibling product or creating a shared package.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — prompt, fork-skill, foreground-command, TUI/HTTP/MCP/WebSocket callers checked
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Update `agent-framework` SPEC to define a controller-owned, identity-bound foreground claim and
   the unchanged queue/busy/cancellation policy.
2. RED: directly overlap two controller execution scopes and prove the second scope's completion can
   currently make `isExecuting()` false and drain queued input while the first remains live.
3. Replace direct boolean writes with one private claim owner and identity-checked release-and-drain.
4. Route prompt, fork skill, and foreground command through the same acquisition/release mechanism;
   retain synchronous queue handoff and existing public error/result semantics.
5. Add real `InteractiveSession` regressions for command-during-prompt, prompt-during-command, exact
   queue settlement, and abort state held until unwind.
6. Add a full `agent-session` integration that parks in `permissionHandler`, calls `abort()`, and
   observes bounded turn rejection plus `isRunning() === false`; correct the package SPEC's stale
   uncancellable statement.
7. Run the durable public framework scenario and the affected/full verification gates.

## Affected Files

- `packages/agent-framework/docs/SPEC.md`
- `packages/agent-framework/src/interactive/interactive-session-execution-controller.ts`
- `packages/agent-framework/src/interactive/__tests__/*execution-claim*.test.ts`
- `packages/agent-framework/src/interactive/__tests__/interactive-session.test.ts`
- `packages/agent-session/docs/SPEC.md`
- `packages/agent-session/src/__tests__/*approval-abort*.test.ts`
- `.agents/evals/scenarios/runtime-005-approval-abort-agent-run.md`
- `.agents/tasks/RUNTIME-005-a-turn-parked-on-approval-is-not-cancellable.md`

## Completion Criteria

- [ ] TC-01: While a prompt claim is live, a public blocking command returns the existing busy
      result, does not change thinking/streaming state, does not drain queued input, and the queued
      prompt later executes and settles exactly once without a `SessionBusyError` history entry.
- [ ] TC-02: A stale or foreign claim cannot release the active execution, emit idle, persist, or
      drain the queue; only the matching holder can do so.
- [ ] TC-03: Prompt, fork-skill, and foreground-command execution all use the same claim owner;
      no production path writes a shared execution boolean directly, and prompts queued behind a
      foreground or fork claim are handed off only by its matching release.
- [ ] TC-04: In a real `agent-session` run parked on a never-resolving permission handler, `abort()`
      causes the turn to reject and `isRunning()` to become false within a bounded assertion; the
      aborted approval is never interpreted as permission.
- [ ] TC-05: The agent-executable framework scenario exits 0 after proving abort→settlement→next
      prompt usability, and affected build/test/typecheck plus `pnpm harness:verify-like-ci` pass.

## Test Plan

| TC-ID | Test Type                                    | Tool / Approach                                                                                             | Notes                                        |
| ----- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| TC-01 | BEHAVIOR async integration                   | Vitest with real `InteractiveSession`, held scripted turn, blocking command module, and queued turn handles | Public framework boundary; no live provider  |
| TC-02 | BEHAVIOR async unit                          | Vitest controller claim identity/deferred-release test                                                      | Named RED against current multi-writer state |
| TC-03 | BEHAVIOR async integration + structural scan | Vitest for all three owners plus `rg`/AST assertion over production writes                                  | Preserves synchronous queue handoff          |
| TC-04 | BEHAVIOR async integration                   | Vitest over real `Session.run`, never-resolving permission handler, `abort()`, and bounded races            | Fail-closed approval assertion               |
| TC-05 | FLOW CLI/agent scenario + CI smoke           | Exact durable Bash scenario; package build/test/typecheck; `pnpm harness:verify-like-ci`                    | No credentials/network                       |

## User Execution Test Scenarios

**Applies.** The observable product behavior is cancellation recovery: a user aborts a turn waiting
for permission and can submit the next prompt after the aborted turn unwinds. PLAN mode must record
an agent-executable, credential-free framework scenario using the public testing/runtime surface,
bounded waits, exact output/exit assertions, and cleanup before implementation begins.

## Tasks

- [ ] `.agents/tasks/RUNTIME-005-a-turn-parked-on-approval-is-not-cancellable.md` — existing task;
      reconcile to TC-01 through TC-05 after GATE-APPROVAL

## Evidence Log

### [RECOMMENDATION REVIEW] — ✅ ENDORSE | 2026-08-13

- Independent review verified that every supported transport reaches the current public command
  busy guard and that JavaScript run-to-completion closes a TOCTOU gap before foreground acquisition.
- The original `/compact` reproduction is therefore historical, while the controller's raw writers
  (including queue-resume error handlers) still leave foreign/stale release representable.
- A controller-local opaque claim preserves busy/queue policy without coupling the framework lifecycle
  to `agent-session`'s turn-specific AbortController and `SessionBusyError` semantics.
- The reviewer required removal of every production boolean write and regression coverage for failed
  acquisition settlement, turn identity, wake coalescing, driver attribution, persistence, and
  synchronous handoff ordering.

**REVIEW VERDICT: ENDORSE**

### [GATE-WRITE] — ✅ PASS | 2026-08-13

**Status upgrade:** draft → review-ready

- Frontmatter: YAML begins at the first line and contains `status: draft`, the allowed single type `BEHAVIOR`, and a non-empty `tags` field.
- Problem: names the concrete three-writer `SessionExecutionController.executing` symptom, the prompt/fork-skill/foreground-command overlap condition, the stale-release consequences, and the missing full-session approval-abort proof without TBD/TODO or vague placeholders.
- Stale-premise correction: the document explicitly retracts the original `/compact` reachability premise and matches the current `InteractiveSessionBase.executeCommand()` busy guard, while retaining the independently observable internal ownership defect present in the controller's three unconditional release paths.
- Prior Art Research: cites primary documentation for Java structured concurrency, Node `AbortSignal`, Tokio guards, Kubernetes Leases, and POSIX foreground process groups; it extracts identity-bound release and cancellation-versus-release constraints into the alternatives and chosen opaque-claim decision.
- Architecture Review checklist: all four items are checked; the sibling/reachability scan covers prompt, fork-skill, foreground-command, and TUI/HTTP/MCP/WebSocket callers.
- Alternatives and decision: four alternatives each state a pro and con, and the decision explicitly selects identity-bound release over changed queue semantics, identity-free counting, and distributed caller guards.
- New-surface placement: N/A because this is an internal refactor of the existing `agent-framework` interactive runtime with no new package, app, presentation/interface surface, or boundary reclassification; the document nevertheless identifies `agent-session`'s existing `TurnClaim` as the analogous layer and specifies local mirroring rather than a sibling-product dependency.
- Completion Criteria: TC-01 through TC-05 cover public busy/queue behavior, stale/foreign release, all three claim users, full-session approval abort settlement, and durable scenario/verification; every criterion is observable or command-oriented and uses no forbidden vague phrase.
- Test Plan: 5 rows match the 5 completion criteria exactly; every row has a non-empty test type and automated tool/approach, and no manual-only row requires a skip explanation.
- Structure: `## Tasks` contains the existing RUNTIME-005 task placeholder with an explicit post-approval reconciliation note; `## Evidence Log` was present and empty before this first gate run; no body `## Status` or `## Classification` section exists.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-13

**Status upgrade:** review-ready → approved

- Prior-gate ordering: `[GATE-WRITE] — ✅ PASS | 2026-08-13` is recorded, frontmatter is `status: review-ready`, and the document is in `.agents/spec-docs/backlog/`, matching the required GATE-APPROVAL input state.
- Explicit owner approval (verbatim): “타당한 이유와 함께 추천안을 제시하면 타당할 경우 자동으로 승인하겠습니다.” The independently recorded recommendation review returned `ENDORSE` for this BEHAVIOR-008 proposal after correcting the stale `/compact` premise, so the owner's stated approval condition is satisfied and authorizes this exact design.
- Direct and unambiguous scope: the fulfilled conditional approval applies to the named recommendation under review in the current conversation, not to a clarifying answer or a different backlog item.
- Post-approval integrity: approval attached to the corrected, independently endorsed form; the current frontmatter remains `type: BEHAVIOR` with `tags: [typescript, async, cli]`, and the Architecture Review retains the endorsed latent claim-owner scope without a subsequent design change.
- Independent architecture validation: N/A as a mandatory conditional criterion because the spec introduces no package, app, presentation/interface surface, or layer/product-family reclassification. The recorded `RECOMMENDATION REVIEW` nevertheless independently endorsed the controller-local placement and the analogous `agent-session` `TurnClaim` comparison.
- Pre-authorization implementation check: the working tree contains only this new spec document and no implementation source edit; implementation has not started before GATE-APPROVAL.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-13

**Status upgrade:** approved → in-progress

- Ordering: `[GATE-APPROVAL] — ✅ PASS | 2026-08-13` is recorded, frontmatter is `status: approved`, and the document is in `.agents/spec-docs/todo/`, matching the required GATE-IMPLEMENT input state.
- Task artifact: `.agents/tasks/RUNTIME-005-a-turn-parked-on-approval-is-not-cancellable.md` exists and is named verbatim in this spec's `## Tasks` section.
- Completion-criterion mapping: the task's `## Plan` contains one explicit task for each of TC-01, TC-02, TC-03, TC-04, and TC-05, covering public busy/queue settlement, identity-bound release, all execution claim users, bounded approval-abort settlement, and durable/full verification respectively.
- Test-plan substance: the task's `## Test Plan` is substantially longer than 50 characters and specifies three red-first bounded behavioral regressions plus the full `pnpm harness:verify-like-ci` gate; it is neither empty nor a placeholder.
- Missing-task non-compliance check: the task artifact predates the stage-1 implementation commit and remains recorded for this reconciled stage-2 work, so implementation was not committed without a task file.
