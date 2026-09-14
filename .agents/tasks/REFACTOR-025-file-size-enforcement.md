---
title: 'REFACTOR-025: Narrow TUI runtime ports and split presentation coordinators'
issue: https://github.com/woojubb/robota/issues/2670
status: in-progress
created: 2026-07-04
priority: high
urgency: now
area: packages/agent-ui-terminal
depends_on: [STRUCT-012]
---

# REFACTOR-025: Narrow TUI runtime ports and split presentation coordinators

## Objective

Complete the product-facing remainder transferred from Issue #2054 into Issue #2670: keep concrete
`InteractiveSession` and `CommandRegistry` ownership inside the terminal composition/channel boundary,
expose only TUI-owned capability ports to React components and hooks, and separate the channel and App
responsibilities that currently make unrelated TUI changes propagate through the same coordinators.

The old task framed this as a repository-wide 300-line/file-size enforcement change. That premise is
obsolete: the scanner was removed in `ff428501c` because it was a structural bottleneck, and the parent
AGREEMENT-2670 explicitly excludes restoring it. File length is evidence of concentrated responsibility,
not this Task's completion criterion.

## Finding Depth

`DEPTH: FOUNDATIONAL` — triaged 2026-09-14. The cause is the TUI composition boundary exposing full
framework classes to React hooks while independently changing lifecycle, event projection, interaction
queues and screen coordination remain concentrated in the same owners. Repeated fixes in this area and
the deleted file-size scanner show that splitting by line count would treat a symptom and recreate a
known harness bottleneck.

## Plan

- [ ] S1 — Introduce a narrow `ITuiAppChannelPort` plus TUI-owned session-event, command-query, status
      and action ports built from the existing session capability contracts. Only the top-level composition
      shell may receive the concrete channel; React controllers, components and hooks must not receive
      `getSession()`, `getRegistry()` or unrestricted `stateManager` access. Retain compatible composition
      APIs for non-React consumers.
- [ ] S2 — Keep `TuiInteractionChannel` as the public session-owning facade, but extract lifecycle,
      event-projection and request-queue responsibilities into named package-local units with one owner
      each.
- [ ] S3 — Split App coordination from presentation so data projection and callbacks are prepared by a
      controller hook and the render tree consumes a bounded view model.
- [ ] Update the terminal package SPEC class-contract and capability rows before implementation, then
      preserve every lifecycle, permission, action, history, status, background-job and shutdown outcome.

## Explicit Exclusions

- Restoring or replacing the deleted repository-wide file-size scanner, baseline or 300-line ceiling.
- Splitting `PlaygroundApp.tsx` merely because of its size.
- Decomposing the framework's complete `InteractiveSession`; this Task narrows the terminal consumer.
- Changing command, permission, lifecycle or rendering behavior beyond compatibility required by the
  responsibility extraction.

## Test Plan

- Add type-level probes proving React components/hooks cannot invoke unrelated session or registry
  operations through their declared ports.
- Characterize and retain session-event subscription identity, queue cancellation/denial, lifecycle
  idempotency, history restoration, background-job routing, status projection and bounded shutdown.
- Run the terminal package's focused unit, integration and PTY suites. Use the provider-injected TUI
  functional path for prompt/transcript equivalence and the built CLI PTY for launch, command handling and
  bounded normal exit; do not claim the built binary can inject the scripted provider.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 2`

### Scenario 1: Public SDK TUI boundary and transcript

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: current directory is `packages/agent-ui-terminal`; REFACTOR-025 creates the literal `examples/verify-refactor-025-boundary.ts` as part of this Task; the example imports only public package surfaces, uses a deterministic scripted provider, submits one prompt, verifies projected user and assistant history, and requires no credentials, network, or external service
- command: `pnpm exec tsx examples/verify-refactor-025-boundary.ts`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=REFACTOR_025_BOUNDARY_PASS
- cleanup: the example stops the public TUI channel and removes its temporary workspace before exit
- evidence: pending Stage 2 execution; record the SDK result token and exit code

### Scenario 2: Shipped Robota TUI command and normal exit

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: current directory is `packages/agent-cli`; the completed CLI build is available; an agent-controlled PTY uses isolated project and user configuration containing a dummy provider key that is never called, waits for the input prompt, enters `/help`, waits for `Available commands`, enters `/exit`, waits for `Exit the session?`, accepts the default Yes action, and awaits process termination
- command: `pnpm exec robota --name REFACTOR-025-scenario`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=initial input prompt followed by Available commands, Exit the session? confirmation, and normal process exit code 0
- cleanup: ensure the Robota process has exited, then remove only the isolated project and user-configuration directories
- evidence: pending Stage 2 execution; record the ordered visible states and final exit code

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-09-14

**Status remains:** scenario drafted
**Failed criteria:**

- Every scenario is written with the complete canonical field set: both scenarios contain prose
  prerequisites, commands, expected results, cleanup and evidence placeholders, but neither records the
  required single-line `product surface:`, `surface rationale:`, `observable type:` or
  `observable rationale:` fields, and their expected values do not use the required type-specific shape.
  **Required action:** Rewrite each scenario with every canonical field exactly once, including a
  type-shaped expected observable and a nonempty Stage-2 evidence placeholder.
- Every scenario carries its executability decision: both scenarios say `Executability: automatable`,
  while the rule accepts exactly `agent-executable` or `manual-only: <specific technical reason>`.
  **Required action:** Record the exact `agent-executable` decision for each scenario that can be driven
  from Bash, or supply the complete manual-only barrier evidence if that is genuinely necessary.
- Canonical product-surface identity and matching invocation: neither scenario names a canonical surface;
  both invoke `pnpm --filter ... exec tsx --eval` and import helpers under `src/__tests__/pty/`, which those
  sources explicitly describe as test-only. Scenario 1 also supplies inline evaluated code instead of a
  literal script below `examples/` or `scratch/`; Scenario 2's build command is engineering setup and its
  PTY wrapper is not the required `robota` or `pnpm exec robota` TUI invocation.
  **Required action:** Bind each scenario to one allowed product surface and matching rationale, then use
  its permitted invocation form: a real `robota`/`pnpm exec robota` command for CLI/TUI or a literal
  `examples/`/`scratch/` script path for a public-SDK example.

**Judged at:** HEAD `e35f26facdf3eec4a80a97658615200c02318a80` · base `origin/develop@e35f26facdf3eec4a80a97658615200c02318a80` · document `.agents/tasks/REFACTOR-025-file-size-enforcement.md` blob `51e99d45c4f77fdfedd630e095b552feb69f0d38` (modified)

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-14

**Status upgrade:** scenario drafted → scenario written

- DONE-GATE-STAGE-1 — Every scenario is written with exact commands or UI steps, prerequisites, an
  expected observable result, cleanup and an evidence field: PASS — both scenarios contain every
  required canonical field exactly once; Scenario 1 binds a literal planned example command and
  `result=REFACTOR_025_BOUNDARY_PASS`, while Scenario 2 binds the shipped TUI command, ordered PTY
  interactions and its complete visible-state expectation.
- DONE-GATE-STAGE-1 — Every scenario carries its executability decision: PASS — both record exactly
  `executability: agent-executable`; Scenario 1 is a deterministic Bash-driven public SDK example and
  Scenario 2 is driven through an agent-controlled PTY.
- DONE-GATE-STAGE-1 — Canonical product-surface identity and matching invocation: PASS — Scenario 1 uses
  `public-sdk-example` with `pnpm exec tsx examples/verify-refactor-025-boundary.ts`, whose creation is
  explicitly included in the Task and paired spec; Scenario 2 uses `robota-tui` with
  `pnpm exec robota --name REFACTOR-025-scenario`, and `pnpm exec robota --help` resolved that shipped
  entrypoint locally with exit code 0. Both observables are product behavior rather than engineering or
  governance verification.
- DONE-GATE-STAGE-1 — Live credentials or external-service prerequisites are explicit: PASS — Scenario 1
  explicitly requires neither, and Scenario 2 explicitly uses an isolated dummy provider key that its
  `/help` and `/exit` flow never calls.
- DONE-GATE-STAGE-1 — Exception clause: N/A — both scenarios are fully written and require no unwritten-
  scenario exception.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: Public SDK TUI boundary and transcript",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/verify-refactor-025-boundary.ts",
      "observableType": "sdk-result",
      "observable": "result=REFACTOR_025_BOUNDARY_PASS",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "current directory is `packages/agent-ui-terminal`; REFACTOR-025 creates the literal `examples/verify-refactor-025-boundary.ts` as part of this Task; the example imports only public package surfaces, uses a deterministic scripted provider, submits one prompt, verifies projected user and assistant history, and requires no credentials, network, or external service",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/verify-refactor-025-boundary.ts"
      },
      "expectedObservable": "result=REFACTOR_025_BOUNDARY_PASS",
      "cleanup": "the example stops the public TUI channel and removes its temporary workspace before exit",
      "evidence": "pending Stage 2 execution; record the SDK result token and exit code"
    },
    {
      "name": "Scenario 2: Shipped Robota TUI command and normal exit",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota --name REFACTOR-025-scenario",
      "observableType": "ui-state",
      "observable": "visible=initial input prompt followed by Available commands, Exit the session? confirmation, and normal process exit code 0",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "current directory is `packages/agent-cli`; the completed CLI build is available; an agent-controlled PTY uses isolated project and user configuration containing a dummy provider key that is never called, waits for the input prompt, enters `/help`, waits for `Available commands`, enters `/exit`, waits for `Exit the session?`, accepts the default Yes action, and awaits process termination",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota --name REFACTOR-025-scenario"
      },
      "expectedObservable": "visible=initial input prompt followed by Available commands, Exit the session? confirmation, and normal process exit code 0",
      "cleanup": "ensure the Robota process has exited, then remove only the isolated project and user-configuration directories",
      "evidence": "pending Stage 2 execution; record the ordered visible states and final exit code"
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

## Completion Criteria

- [ ] TC-01: Except for the top-level composition shell, production React controllers, components and
      hooks import no concrete `TuiInteractionChannel`, `InteractiveSession` or `CommandRegistry` type;
      compile-time probes prove `getSession()`, `getRegistry()`, unrestricted `stateManager` and unrelated
      session/registry operations are unreachable through `ITuiAppChannelPort` and its child ports.
- [ ] TC-02: The concrete framework objects have one terminal composition owner. Existing public
      `getSession()`, `getRegistry()` and `stateManager` surfaces remain source-compatible; removing any
      of them requires a separate, directly approved public-contract change.
- [ ] TC-03: Channel lifecycle, event projection and the permission/user-action queues are owned by
      separate named units, with focused tests for listener identity, idempotent teardown and symmetric
      queue draining on `abort()`, `cancelQueue()`, `shutdown()` and `stop()`.
- [ ] TC-04: App coordination is separated from its presentation tree without changing visible history,
      prompt, status, background-work, picker or shutdown behavior.
- [ ] TC-05: Existing terminal unit/integration/PTY suites, the provider-injected transcript scenario and
      built CLI PTY launch/exit scenario pass; no file-size scan result is used as delivery evidence.
- [ ] TC-06: The package SPEC records the new class contracts and ownership boundaries, and the final
      delivery updates the #2670 parent projection while leaving unrelated product Tasks open.

## Provenance

- Source outcome: [Issue #2054](https://github.com/woojubb/robota/issues/2054), already closed after its
  remaining work was transferred to [Issue #2670](https://github.com/woojubb/robota/issues/2670).
- Parent decision: AGREEMENT-2670 TC-07 requires narrow TUI ports and responsibility extraction and
  explicitly removes the obsolete deleted-scan requirement.
- Recommendation review: 2026-09-14 — after two bounded clarifications to enforce the narrow App port,
  reachable verification paths, all four queue drains and public-surface preservation, the independent
  reviewer returned `REVIEW VERDICT: ENDORSE` with zero actionable findings.
- Execution authority: the user directed that #2670's next product Task continue after the verified
  #2732 landing; this record narrows that authorized work to the already-mapped REFACTOR-025 outcome.
