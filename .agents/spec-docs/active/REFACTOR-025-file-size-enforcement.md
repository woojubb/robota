---
status: in-progress
type: BEHAVIOR
tags: [tui, architecture, typescript]
lane: L2
---

# REFACTOR-025: Narrow TUI runtime ports and split presentation coordinators

Paired with `.agents/tasks/REFACTOR-025-file-size-enforcement.md`. This plan completes the remaining
Issue #2054 outcome now owned by Issue #2670 without reviving the deleted file-size harness.

## Problem

The terminal UI's React layer receives concrete `InteractiveSession` and `CommandRegistry` objects from
`useTuiChannel`. Components and hooks therefore see the complete framework surface even when they need
only event subscription, two command queries, one status projection or one action. `App.tsx` reaches
through the framework session to derive display state, while `TuiInteractionChannel` simultaneously owns
session construction, registry construction, lifecycle, event projection, two request queues, history,
background-work routing and teardown.

This is a change-amplification defect: small TUI features repeatedly modify broad coordinators and their
framework imports. The previous Task proposed reducing file lengths and turning a global file-size scan
into a blocking gate, but that scanner was intentionally removed in `ff428501c`. Reintroducing it would
not constrain the dependency direction or establish responsibility ownership.

## Prior Art Research

Waived: on 2026-09-14, this internal responsibility and type-boundary refactor is governed by the
repository's existing session capability contracts, terminal package SPEC and measured current imports.
No external product behavior or protocol choice determines the boundary.

## Architecture Review

### Current Evidence

- `hooks/useTuiChannel.ts`, `hooks/useSideEffects.ts`, `hooks/side-effects-types.ts`, `InputArea.tsx` and
  `hooks/useAutocomplete.ts` import concrete framework classes into React code.
- `App.tsx` invokes session job, name and nested runtime-status methods even though the channel already
  owns that session and already proxies several adjacent actions.
- `TuiInteractionChannel.ts` owns construction plus lifecycle, event binding, permission and action
  queues, command execution, history restoration, status projection and shutdown in one class.
- The repository already owns granular `ISession*` capability contracts in
  `agent-interface-session`; a new omnibus TUI session interface would duplicate those contracts.
- Existing external CLI integration calls `TuiInteractionChannel.getSession()`. Removing that public
  escape hatch is not required to stop concrete objects from entering React and would unnecessarily
  expand the change across packages.

### Affected Scope

- `packages/agent-ui-terminal/src/TuiInteractionChannel.ts` and package-local extracted owners
- `packages/agent-ui-terminal/src/App.tsx`, its controller/view split, and affected hooks/components
- terminal package tests, type probes and `packages/agent-ui-terminal/docs/SPEC.md`
- compatibility-only adjustments to existing examples or CLI consumers if extraction exposes a latent
  assumption; no new CLI feature is introduced

### Alternatives Considered

1. Restore a repository-wide file-size scanner and split whichever files exceed a numeric ceiling.
   - Pro: mechanically measurable and broad.
   - Con: the scanner was removed as a bottleneck; a line threshold neither narrows capabilities nor
     assigns responsibility and would expand this product Task into harness work.
2. Move blocks from the three largest files into helpers without changing their type boundaries.
   - Pro: smallest textual diff and lower line counts.
   - Con: React would still receive full framework objects and the broad coordinators would remain the
     semantic owners, so future changes would continue to spread through the same boundary.
3. Define narrow TUI-owned views from existing capability contracts, keep concrete creation at the
   channel/composition edge, and extract lifecycle, event, queue and App-controller responsibilities.
   - Pro: removes the cause while preserving public composition compatibility and provides type-level
     evidence stronger than file length.
   - Con: requires staged characterization tests and explicit facade delegation during extraction.

### Decision

Choose alternative 3. `TuiInteractionChannel` remains the supported public session-owning presentation
facade and may retain compatibility methods used by non-React composition code. React code instead
receives package-owned ports:

**Delivery mode:** `single`

- an `ITuiAppChannelPort` that excludes `getSession()`, `getRegistry()` and unrestricted
  `stateManager`, with narrower child ports for controller and component needs;
- a command-query port with only command listing and subcommand listing;
- a UI-event port with only the typed `ui_intent` and `session_renamed` subscriptions;
- channel actions for submit, abort, queue cancellation, shutdown and background-job routing;
- immutable status/name/pending-count projections rather than nested framework-session access.

The ports reuse or project existing `ISession*` contracts; they do not recreate `IInteractiveSession`.
Concrete session and registry construction stays in one session-owning composition boundary. Existing
public `getSession()`, `getRegistry()` and `stateManager` surfaces remain source-compatible in this Task;
repository-internal consumer replacement is not evidence that external consumers can tolerate removal.
Any removal requires a separate, directly approved public-contract change.

`TuiInteractionChannel` delegates to package-local owners with one responsibility each:

- lifecycle coordinator — start/stop/shutdown idempotency and bounded runtime teardown;
- session-event projector — exhaustive listener binding/unbinding and render-state projection;
- interaction queues — FIFO permission and user-action resolution plus symmetric drains on `abort()`,
  `cancelQueue()`, `shutdown()` and `stop()`.

The top-level composition shell may construct and receive the concrete channel, but it immediately narrows
that object to `ITuiAppChannelPort`. App coordination moves into a controller hook that accepts only that
port and assembles state, effects and callbacks. A presentation component renders a bounded view model and
never discovers framework state by reaching through the channel. Extractions are performed in stages
behind the existing facade so each stage can be compared to the characterized behavior.

### Capability Preservation Inventory

| Capability | Current owner/call | Post-refactor owner | Preservation evidence |
| --- | --- | --- | --- |
| prompt submit, abort, queued-turn cancel | channel/session | channel action facade | focused channel tests |
| permission and unified action answers | channel queues | interaction-queue owners | FIFO and drain tests |
| session events and listener cleanup | channel + side-effect hook | projector + narrow UI-event port | exact event/handler tests |
| channel state subscription | concrete channel + public state manager | narrow snapshot/subscription port | negative capability probes |
| command autocomplete | concrete registry in React | command-query port | type probe + autocomplete tests |
| history and streaming projection | state manager/channel | unchanged state manager behind controller | history/component tests |
| background job send/detail | App/session and channel | channel action facade | routing tests |
| permission mode, preset, effort, id, name | App nested session access | immutable channel status projection | status tests |
| start, switch, stop, bounded shutdown | channel/App | lifecycle coordinator behind channel | teardown and PTY tests |

### Architecture Review Checklist

- [x] Affected packages and layers enumerated.
- [x] Sibling scan completed: existing session capability contracts are reused; no new framework-wide
      aggregate is introduced.
- [x] Three alternatives compared, including the obsolete scanner premise.
- [x] Decision and accepted compatibility cost documented.
- [x] New-surface placement: all new ports and extracted owners are package-local to terminal UI; no
      lower-level framework dependency is introduced.

## Fallback & Degradation Declaration

None. This is a behavior-preserving internal refactor. A failed runtime projection, stuck queue or changed
shutdown outcome is a regression, not a supported degraded mode.

## Solution

1. Add characterization and compile-time tests for the current lifecycle, event, queue, status and
   autocomplete capabilities before changing ownership. The negative probes must reject `getSession()`,
   `getRegistry()`, unrestricted `stateManager` and unrelated framework methods, not merely reject imports.
2. Introduce package-local narrow ports and channel projections. Migrate React components/hooks away from
   `InteractiveSession` and `CommandRegistry` while preserving non-React facade compatibility.
3. Extract permission and user-action queue state machines, then lifecycle and event-projection owners,
   retaining the channel as the delegating public facade.
4. Extract an App controller hook and bounded presentation props without changing the visual tree or Ink
   lifecycle placement.
5. Update the package SPEC class-contract registry and run focused unit, integration, type, functional and
   PTY verification. Add a deterministic public SDK example at
   `examples/verify-refactor-025-boundary.ts` for the provider-injected user scenario.

## Affected Files

- `.agents/tasks/REFACTOR-025-file-size-enforcement.md`
- `.agents/spec-docs/{draft,review-ready,approved,active,done}/REFACTOR-025-file-size-enforcement.md`
- `packages/agent-ui-terminal/docs/SPEC.md`
- `packages/agent-ui-terminal/src/TuiInteractionChannel.ts`
- `packages/agent-ui-terminal/src/App.tsx`
- `packages/agent-ui-terminal/src/InputArea.tsx`
- `packages/agent-ui-terminal/src/hooks/useTuiChannel.ts`
- `packages/agent-ui-terminal/src/hooks/useSideEffects.ts`
- `packages/agent-ui-terminal/src/hooks/side-effects-types.ts`
- `packages/agent-ui-terminal/src/hooks/useAutocomplete.ts`
- `packages/agent-ui-terminal/examples/verify-refactor-025-boundary.ts`
- new package-local port, lifecycle, event-projector, interaction-queue, controller/view modules and focused tests

## Completion Criteria

- [ ] TC-01: Except for the top-level composition shell, no production React controller, component or hook
      imports concrete `TuiInteractionChannel`, `InteractiveSession` or `CommandRegistry`; compile-time
      negative probes show `getSession()`, `getRegistry()`, unrestricted `stateManager` and unrelated
      session/registry methods are absent from `ITuiAppChannelPort` and its child ports.
- [ ] TC-02: Concrete framework object creation remains in one terminal composition boundary; existing
      public `getSession()`, `getRegistry()` and `stateManager` surfaces remain source-compatible and no
      public API is removed.
- [ ] TC-03: Lifecycle, event projection, permission queue and user-action queue have named package-local
      owners and tests prove exact listener cleanup, idempotent teardown, FIFO resolution and symmetric
      denial/cancellation on `abort()`, `cancelQueue()`, `shutdown()` and `stop()`.
- [ ] TC-04: App obtains name, pending count, runtime status and background-job actions through bounded
      channel projections/actions; its controller is separate from the presentation tree.
- [ ] TC-05: History restoration, prompt submission, command autocomplete, permission/action prompts,
      status rendering, background-work routing and bounded shutdown remain behaviorally equivalent in
      focused tests and the package's existing regression suites.
- [ ] TC-06: Two automatable product-path cells pass: (a) the provider-injected public TUI composition
      submits a scripted prompt and projects its transcript/history; (b) the built CLI PTY starts with an
      isolated dummy provider configuration, handles a non-provider command and exits cleanly within the
      existing bound. The plan does not claim scripted-provider injection into the built binary.
- [ ] TC-07: The terminal package SPEC records each extracted owner's responsibility and dependency; no
      file-size scanner, baseline, ceiling increase or unrelated Playground/framework decomposition is
      introduced.
- [ ] TC-08: REFACTOR-025 archives with exact delivery evidence ancestral to `origin/develop`, and the
      AGREEMENT-2670 projection marks only TC-07 complete while retaining the remaining child Tasks.

## Test Plan

| TC-ID | Test type | Tool / approach | Notes |
| --- | --- | --- | --- |
| TC-01 | Type/static | terminal typecheck plus negative capability probes/import inventory | proves boundary, not line count |
| TC-02 | Build/consumer | terminal and agent-cli typechecks | preserves public composition consumers |
| TC-03 | Unit | lifecycle, event-binding and queue-focused Vitest suites | exact identities and drain outcomes |
| TC-04 | Unit/component | controller and status/background routing tests | no nested session reach-through |
| TC-05 | Regression | terminal focused + package suite | characterization before extraction |
| TC-06 | Functional + PTY | provider-injected TUI transcript; built CLI command/exit | two reachable public paths |
| TC-07 | Spec/conformance | package SPEC contract registry plus repository change verification | no deleted scanner restored |
| TC-08 | Delivery audit | Git ancestry, PR checks and parent/Task readback | partial parent completion only |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 2`

### Scenario 1 — prompt and transcript survive through provider-injected TUI composition

1. Start the public provider-injected TUI composition with `createScriptedProvider` and one deterministic
   response.
2. Submit one prompt through the channel-facing product surface.
3. Verify the user prompt and assistant response reach the terminal history projection and the scripted
   provider consumes exactly one turn.

Expected result: the visible history matches pre-refactor behavior and no extracted package-private unit
is invoked directly.

### Scenario 2 — built CLI still starts, handles a command and exits cleanly

1. Build the CLI and launch `packages/agent-cli/bin/robota.cjs` in the existing isolated PTY harness with
   dummy provider configuration that cannot reach a real network provider.
2. Wait for the prompt, execute a command that does not call the provider, and verify its visible result.
3. Execute normal exit and await the actual child-process exit within the existing shutdown bound.

Expected result: the built product path renders the command response and exits with no unresolved prompt,
listener or child handle. This cell does not claim that the built binary supports scripted-provider injection.

## Tasks

Paired Task: `.agents/tasks/REFACTOR-025-file-size-enforcement.md`.

- [ ] TC-01 / S1 — narrow React-facing channel, event and command-query ports with negative probes
- [ ] TC-02 / S1 — retain public channel compatibility and one concrete composition owner
- [ ] TC-03 / S2 — extract lifecycle, event projection and both queue owners with four-path drains
- [ ] TC-04 / S3 — separate App controller state/callback projection from the presentation tree
- [ ] TC-05 / S1-S3 — preserve history, prompts, status, background routing and shutdown regressions
- [ ] TC-06 / S4 — add and execute the public SDK example and shipped TUI scenario
- [ ] TC-07 / S4 — update terminal package contracts and verify no deleted file-size gate returns
- [ ] TC-08 / S4 — complete delivery ancestry, archive the pair and update only the parent TC-07 row

## Evidence Log

- 2026-09-14 — current-tree audit measured the stale premise: the named file-size scanner/baseline no
  longer exists, while concrete framework imports and coordinator concentration remain live.
- 2026-09-14 — independent finding-depth triage returned `DEPTH: FOUNDATIONAL`: the cause is the broad
  TUI/framework boundary and concentrated independent responsibilities; restoring the deleted scan would
  address only the symptom.
- 2026-09-14 — proposal review round 1 returned `REVIEW VERDICT: REVISE`: direct-import checks could
  still expose the full channel/state manager, and the built binary cannot currently inject the scripted
  provider. The recommendation now requires a narrow App channel port and separates injected functional
  transcript evidence from built-binary PTY launch/exit evidence.
- 2026-09-14 — proposal review round 2 returned `REVIEW VERDICT: REVISE`: the queue criterion omitted
  `cancelQueue()`, and a compatibility sentence left public channel surfaces conditionally removable.
  All four drain paths are now explicit and those public surfaces are preserved by this Task.
- 2026-09-14 — final bounded proposal review found zero actionable findings and returned
  `REVIEW VERDICT: ENDORSE`. The recommendation is foundational-cause aligned, package-local, publicly
  compatible and backed by two reachable product verification cells.

### [GATE-WRITE] — ✅ PASS | 2026-09-14

**Status upgrade:** draft → review-ready

- GATE-WRITE — Mechanical criteria: PASS — the supplied mechanical judge result is 20 PASS, 0 FAIL and
  7 PENDING-GUARDIAN; this entry judges only those seven semantic criteria.
- GATE-WRITE — Concrete symptom: PASS — `## Problem` identifies the wrong current behavior precisely:
  `useTuiChannel` passes concrete `InteractiveSession` and `CommandRegistry` instances into React,
  `App.tsx` reaches through the channel into the runtime session, and `TuiInteractionChannel` owns
  construction, lifecycle, event projection, two queues, history, background routing and teardown. The
  named imports, calls and fields are present in the current source.
- GATE-WRITE — Reproduction condition: PASS — the condition is bounded to the terminal UI's current React
  composition path: rendering through `useTuiChannel`, `InputArea`/autocomplete or `useSideEffects`
  exposes the full framework objects, while status and background-job rendering in `App.tsx` traverses
  the same concrete channel/session boundary.
- GATE-WRITE — Research or waiver feeds alternatives and decision: PASS — the explicit waiver identifies
  the repository's existing session capability contracts and measured imports as the applicable evidence;
  the alternatives then compare restoring the deleted scanner, performing textual-only splits and reusing
  those `ISession*` contracts for narrow ports, and the Decision selects the evidence-backed third option.
- GATE-WRITE — Decision trade-off: PASS — the Decision accepts staged characterization and facade
  delegation in exchange for narrow type boundaries, while retaining `getSession()`, `getRegistry()` and
  `stateManager` compatibility to avoid an unnecessary public-contract expansion; it also rejects the
  cheaper line-count and helper-only alternatives because they leave the causal boundary intact.
- GATE-WRITE — Conditional new-surface placement: PASS — the new interfaces are classified as
  package-local terminal-presentation ports and owners behind the existing session-owning
  `TuiInteractionChannel` facade. Their closest structural analog is the granular `ISession*` capability
  contract family in `agent-interface-session`, which the Decision reuses/projects at the shared-contract
  level; the design adds no package, sibling-PRODUCT dependency or lower-level framework aggregate.
- GATE-WRITE — Feature coverage: PASS — eight Completion Criteria cover all distinct planned outcomes:
  React capability narrowing (TC-01), concrete-owner/public compatibility (TC-02), lifecycle/event/queue
  extraction (TC-03), App controller/presentation separation (TC-04), behavior preservation (TC-05), two
  product scenarios (TC-06), package contract plus deleted-scan exclusion (TC-07), and delivery/parent
  projection (TC-08). The Test Plan contains the same eight TC rows.
- GATE-WRITE — Command or observable completion-criterion form: PASS — TC-01, TC-02, TC-07 and TC-08 name
  inspectable type, ownership, contract and ancestry states; TC-03 through TC-05 name concrete lifecycle,
  queue, projection and UI outcomes; TC-06 names the provider-injected SDK transcript and built-CLI PTY
  outcomes. None relies on an unmeasurable assertion.

**Judged at:** HEAD `e35f26facdf3eec4a80a97658615200c02318a80` · base `origin/develop@e35f26facdf3eec4a80a97658615200c02318a80` · document `.agents/spec-docs/draft/REFACTOR-025-file-size-enforcement.md` blob `a260eedf9da0b83f57c3967bf1d1c5e9d18ea8ea` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-14

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "작업 재개해"
**Given:** 2026-09-14, this conversation
**Review fingerprint:** 95454300e1d4 (review 0827b9fa, type/tags 0b810172)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-14, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (95454300e1d4) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e35f26facdf3` · base `origin/develop@e35f26facdf3` · document `.agents/spec-docs/backlog/REFACTOR-025-file-size-enforcement.md` blob `292c5345d795` (untracked)

**Independent semantic review:** GATE-APPROVAL, 2026-09-14. The mechanical result is 6 PASS, 0 FAIL and
3 PENDING-GUARDIAN. The existing DIRECT route, verbatim instruction, date and review fingerprint above
are preserved; this review supplies only the three pending semantic dispositions.

**Ordering check:** PASS — the last recorded GATE-WRITE entry is `✅ PASS` with `draft → review-ready`,
the current frontmatter is `status: review-ready`, and the document is under `.agents/spec-docs/backlog/`.
HEAD equals `origin/develop`, and the working-tree changes are limited to REFACTOR-025 planning records and
their loop ledgers; no package implementation preceded this gate.

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS —
  `작업 재개해` was given in this current conversation immediately after REFACTOR-025 had been explicitly
  paused with its re-planned scope and independent recommendation review already identified. It is an
  imperative resuming that same described work, matches the catalogue's accepted `진행해` form, and is
  neither silence, a clarifying answer nor approval of another item.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — the recorded route is
  `DIRECT`; no delegated class is claimed, required or evaluated.
- GATE-APPROVAL — Independent architecture validation (conditional): N/A — this refactor adds only
  package-local ports and responsibility owners inside the existing `agent-ui-terminal` presentation
  package, behind its existing `renderApp` and `TuiInteractionChannel` surfaces. It creates no package,
  app, public/product presentation surface, dependency direction or layer/product-family reclassification.
  The already-recorded independent `proposal-reviewer` `REVIEW VERDICT: ENDORSE` additionally confirms the
  package-local, publicly compatible placement, but no new-surface `architecture-audit-fanout` result is
  required.

**Guardian verdict:** PASS — the DIRECT approval is specific to the resumed REFACTOR-025 work, CLASS is
inapplicable, and the new-surface validation condition is not triggered.

**Judged by:** `backlog-gate-guard` (semantic set)
**Judged at:** HEAD `e35f26facdf3eec4a80a97658615200c02318a80` · base `origin/develop@e35f26facdf3eec4a80a97658615200c02318a80` · document `.agents/spec-docs/backlog/REFACTOR-025-file-size-enforcement.md` blob `300b0942d7e113df6cdee8c243bf0c3f600046b2` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-14

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "작업 재개해"
**Given:** 2026-09-14, this conversation
**Review fingerprint:** 621ac22179eb (review 99fd745e, type/tags 0b810172)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-14, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (621ac22179eb) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e35f26facdf3` · base `origin/develop@e35f26facdf3` · document `.agents/spec-docs/todo/REFACTOR-025-file-size-enforcement.md` blob `59ab09ad24cb` (untracked)

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-14

**Status remains:** approved
**Failed criteria:**

- GATE-APPROVAL — ordering: prior gate GATE-WRITE PASS and status `review-ready`: status is `approved`, `review-ready` expected
  **Required action:** run the prior gate to PASS first

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e35f26facdf3` · base `origin/develop@e35f26facdf3` · document `.agents/spec-docs/todo/REFACTOR-025-file-size-enforcement.md` blob `842c7494924b` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-14

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: last [GATE-APPROVAL] entry is ❌ FAIL, PASS required
  **Required action:** run the prior gate to PASS first

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e35f26facdf3` · base `origin/develop@e35f26facdf3` · document `.agents/spec-docs/todo/REFACTOR-025-file-size-enforcement.md` blob `758925d236c8` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-14

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "작업 재개해"
**Given:** 2026-09-14, this conversation
**Review fingerprint:** 621ac22179eb (review 99fd745e, type/tags 0b810172)

**Independent semantic re-review:** the mechanical result after the planning-state correction is
6 PASS, 0 FAIL and 3 PENDING-GUARDIAN. The historical out-of-order GATE-APPROVAL and GATE-IMPLEMENT
FAIL entries above remain intact as evidence; this terminal entry judges the corrected current state.

**Ordering check:** PASS — the recorded GATE-WRITE entry is `✅ PASS`, current frontmatter is
`status: review-ready`, and the document is again under `.agents/spec-docs/backlog/`. The current review
fingerprint matches the latest recorded DIRECT approval, and no package implementation preceded the gate.

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS —
  `작업 재개해` was given in this current conversation immediately after the already-described
  REFACTOR-025 work was paused. It directly resumes that same bounded design and is the catalogue's
  accepted `진행해` form, not silence, a clarifying answer or approval of another item.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — route `DIRECT` is
  complete on its own terms; no delegated class is claimed or required.
- GATE-APPROVAL — Independent architecture validation (conditional): N/A — the change introduces only
  package-local ports and responsibility owners inside the existing `agent-ui-terminal` presentation
  package, behind its existing public surfaces. It adds no package, app, public/product surface,
  dependency direction or layer/product-family reclassification. The recorded independent
  `proposal-reviewer` `REVIEW VERDICT: ENDORSE` additionally supports the package-local placement, while
  no new-surface `architecture-audit-fanout` result is required.

**Guardian verdict:** PASS — the corrected planning state restores gate order, the DIRECT approval is
specific and current, CLASS is inapplicable, and the new-surface condition is not triggered.

**Judged by:** `backlog-gate-guard` (semantic set)
**Judged at:** HEAD `e35f26facdf3eec4a80a97658615200c02318a80` · base `origin/develop@e35f26facdf3eec4a80a97658615200c02318a80` · document `.agents/spec-docs/backlog/REFACTOR-025-file-size-enforcement.md` blob `b057208a1d990a4b7f642e96638b46399e1deb46` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-14

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-14; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/REFACTOR-025-file-size-enforcement.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/REFACTOR-025-file-size-enforcement.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 10 checkbox tasks for 8 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 636 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 2`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 4 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/REFACTOR-025-file-size-enforcement.md",
  "specPath": ".agents/spec-docs/todo/REFACTOR-025-file-size-enforcement.md",
  "taskItems": [
    {
      "kind": "checkbox",
      "value": "S1 — Introduce a narrow `ITuiAppChannelPort` plus TUI-owned session-event, command-query, status and action ports built from the existing session capability contracts. Only the top-level composition shell may receive the concrete channel; React controllers, components and hooks must not receive `getSession()`, `getRegistry()` or unrestricted `stateManager` access. Retain compatible composition APIs for non-React consumers."
    },
    {
      "kind": "checkbox",
      "value": "S2 — Keep `TuiInteractionChannel` as the public session-owning facade, but extract lifecycle, event-projection and request-queue responsibilities into named package-local units with one owner each."
    },
    {
      "kind": "checkbox",
      "value": "S3 — Split App coordination from presentation so data projection and callbacks are prepared by a controller hook and the render tree consumes a bounded view model."
    },
    {
      "kind": "checkbox",
      "value": "Update the terminal package SPEC class-contract and capability rows before implementation, then preserve every lifecycle, permission, action, history, status, background-job and shutdown outcome."
    },
    {
      "kind": "checkbox",
      "value": "TC-01: Except for the top-level composition shell, production React controllers, components and hooks import no concrete `TuiInteractionChannel`, `InteractiveSession` or `CommandRegistry` type; compile-time probes prove `getSession()`, `getRegistry()`, unrestricted `stateManager` and unrelated session/registry operations are unreachable through `ITuiAppChannelPort` and its child ports."
    },
    {
      "kind": "checkbox",
      "value": "TC-02: The concrete framework objects have one terminal composition owner. Existing public `getSession()`, `getRegistry()` and `stateManager` surfaces remain source-compatible; removing any of them requires a separate, directly approved public-contract change."
    },
    {
      "kind": "checkbox",
      "value": "TC-03: Channel lifecycle, event projection and the permission/user-action queues are owned by separate named units, with focused tests for listener identity, idempotent teardown and symmetric queue draining on `abort()`, `cancelQueue()`, `shutdown()` and `stop()`."
    },
    {
      "kind": "checkbox",
      "value": "TC-04: App coordination is separated from its presentation tree without changing visible history, prompt, status, background-work, picker or shutdown behavior."
    },
    {
      "kind": "checkbox",
      "value": "TC-05: Existing terminal unit/integration/PTY suites, the provider-injected transcript scenario and built CLI PTY launch/exit scenario pass; no file-size scan result is used as delivery evidence."
    },
    {
      "kind": "checkbox",
      "value": "TC-06: The package SPEC records the new class contracts and ownership boundaries, and the final delivery updates the #2670 parent projection while leaving unrelated product Tasks open."
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 2
  },
  "worktreePaths": [
    ".agents/loop-runs/backlog-execution-orchestrator.jsonl",
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/spec-docs/todo/REFACTOR-025-file-size-enforcement.md",
    ".agents/tasks/REFACTOR-025-file-size-enforcement.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e35f26facdf3` · base `origin/develop@e35f26facdf3` · document `.agents/spec-docs/todo/REFACTOR-025-file-size-enforcement.md` blob `f0fe6a1df734` (untracked)
