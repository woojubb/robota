---
title: 'MCP-001: add a typed MCP configuration and management control plane'
issue: https://github.com/woojubb/robota/issues/2519
status: done
created: 2026-09-03
completed: 2026-09-21
priority: critical
urgency: now
area: MCP configuration
depends_on: [ARCH-1985]
---

# MCP-001: add a typed MCP configuration and management control plane

## Objective

Preserve and deliver the independently verifiable outcome of [issue #2519](https://github.com/woojubb/robota/issues/2519) after its redundant child-Issue queue entry is absorbed into the RULE-023 Task graph.

## Source Constraints

- The source Issue remains the complete historical problem and acceptance record.
- Closing it as `NOT_PLANNED` means only that GitHub no longer schedules it independently; this Task remains `todo` until the product outcome is delivered.
- Preserve every security, data-correctness, dependency, and direct-replacement constraint from the source Issue; do not add compatibility shims unless a current runtime consumer proves necessity.

## Plan

Spec: `.agents/spec-docs/done/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md`

Implementation:

- [x] Rename `packages/agent-tool-mcp` to `packages/agent-mcp` (`git mv`), set the npm identity to
      `@robota-sdk/agent-mcp`, keep it `private`, and update the four machine-read inventories and the
      five architecture-map documents in the same commit
- [x] Add `src/definition/{types,decode,env-template,precedence,overlay,projection,identity}.ts` —
      the pure pipeline the spec's § Solution steps 2-8 enumerate
- [x] Add `src/management/results.ts` and wire `IMCPActivationDefinitionRegistry` to the resolved set
- [x] Remove `agent-core`'s `IMCPToolConfig` and `IToolFactory.createMCPTool()` with no facade, remove
      the playground stub, and add the breaking changeset
- [x] Add `examples/verify-mcp-definition-control-plane.ts` and extend `scenario:verify`
- [x] Update `packages/agent-mcp/docs/SPEC.md`, its README, and `packages/agent-core/docs/SPEC.md`

Verification — one item per Completion Criterion:

- [x] TC-01 — `pnpm exec vitest run packages/agent-mcp/src/__tests__/definition-precedence.test.ts`
      exits 0, and exits 1 when the source order is permuted
- [x] TC-02 — `pnpm exec vitest run packages/agent-mcp/src/__tests__/definition-env-template.test.ts` exits 0
- [x] TC-03 — `pnpm exec vitest run packages/agent-mcp/src/__tests__/definition-decode.test.ts packages/agent-mcp/src/__tests__/definition-projection.test.ts` exits 0
- [x] TC-04 — the removal grep returns no hit outside `packages/agent-mcp` and
      `pnpm --filter @robota-sdk/agent-core build` exits 0
- [x] TC-05 — `pnpm exec vitest run packages/agent-mcp/src/__tests__/definition-no-side-effects.test.ts` exits 0
- [x] TC-06 — `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      exits 0 with `HARNESS_BASE_REF=origin/integration/agreement-014`
- [x] TC-07 — `pnpm --filter @robota-sdk/agent-mcp build && pnpm --filter @robota-sdk/agent-mcp test` exits 0
- [x] TC-08 — `pnpm --filter @robota-sdk/agent-mcp scenario:verify` exits 0 and prints
      `processesSpawned=0; socketsOpened=0`
- [x] TC-09 — `pnpm exec vitest run packages/agent-mcp/src/__tests__/definition-overlay.test.ts` exits 0
- [x] TC-10 — `pnpm exec vitest run packages/agent-mcp/src/__tests__/definition-identity.test.ts` exits 0
- [x] TC-11 — `pnpm exec vitest run packages/agent-mcp/src/__tests__/management-results.test.ts` exits 0

## Test Plan

Exercise the source Issue's primary success path and at least one failure or refusal path, then run affected package tests, typecheck, build, and repository boundary scans. Record exact commands and outputs in the implementation lifecycle.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

**Executability probe:** the surface was attempted before the scenario was written. On 2026-09-21,
`pnpm --filter @robota-sdk/agent-tool-mcp scenario:verify` — the same package's existing
`examples/` runner under its pre-rename name — exited 0 and printed
`result=status=untrusted; activationAttempts=0` and
`result=approved=true; changedDefinitionDenied=true; revokedDenied=true; activationAttempts=1`.
The example path below `examples/` is therefore a proven, runnable surface in this package; MCP-001
adds a second runner beside it and renames the package to `@robota-sdk/agent-mcp`, so the command
below is the same shape with the post-rename directory. It was not executed as written because the
runner is the behaviour this Task has not implemented yet.

### Scenario 1: the winning MCP definition, what it shadowed, and that nothing was contacted

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=public-sdk-example
- Prerequisites: Node.js and pnpm are installed and `pnpm install` has completed; run from `packages/agent-mcp`; the example builds its own in-memory five-scope fixture, including a malformed higher-precedence entry and an unset `${VAR}` reference; no network, no MCP server, no provider credential and no external service is required.
- Command: `pnpm exec tsx examples/verify-mcp-definition-control-plane.ts`
- Observable type: sdk-result
- Observable rationale: source=public-sdk-return
- Expected observable: result=winner=alpha:managed; alphaShadowed=4; betaWinner=beta:local; betaUnresolved=true; betaShadowed=1; unsetVarPreservedLiterally=true; envRedacted=true; headersRedacted=true; projectionKeysKept=true; processesSpawned=0; socketsOpened=0
- Cleanup: the example uses only in-memory state and exits without leaving files, processes or connections.
- Evidence: `pnpm exec tsx examples/verify-mcp-definition-control-plane.ts` exited 0 from `packages/agent-mcp` on 2026-09-21, printing `result=winner=alpha:managed; alphaShadowed=4; betaWinner=beta:local; betaUnresolved=true; betaShadowed=1; unsetVarPreservedLiterally=true; envRedacted=true; headersRedacted=true; projectionKeysKept=true; processesSpawned=0; socketsOpened=0` — the expected observable exactly. The durable artifacts are `packages/agent-mcp/examples/verify-mcp-definition-control-plane.ts` and the recorded run in `packages/agent-mcp/examples/scenarios/mcp-activation-admission.record.json`. The first execution of this scenario FAILED with a `TypeError` from `applyDisableOverlay(entries, {})`, a real defect the unit suites had missed because they always supplied a `disabled` map; `packages/agent-mcp/src/definition/overlay.ts` now treats an absent map as "nothing disabled" and `packages/agent-mcp/src/__tests__/definition-overlay.test.ts` pins that case.

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-09-21

**Status remains:** scenario drafted

**Ordering:** N/A — DONE-GATE-STAGE-1 has no prior gate (gate-catalogue.md § Prior-gate map). Input
state verified independently: the Task carries `## User Execution Test Scenarios` with the author
verdict `SCENARIO DRAFTED: automatable | 1`, no earlier `DONE-GATE-STAGE-1` entry exists in this
Task, and `git status --porcelain` on `feat/mcp-001-typed-control-plane` (HEAD `139097e83`) shows only
the paired planning artifacts (`.agents/spec-docs/active/MCP-001-…md`,
`.agents/tasks/MCP-001-…md`) — no implementation path was modified ahead of this gate, so the gate is
not retrospective.

**Per-criterion result (all four checked):**

- Criterion 1 — field completeness (exact command/UI steps, prerequisites, expected observable,
  evidence field): PASS. Scenario 1 carries Executability, Product surface, Surface rationale,
  Prerequisites, Command, Observable type, Observable rationale, Expected observable, Cleanup and
  Evidence, each exactly once and non-empty. `Evidence: pending implementation — recorded at
  DONE-GATE-STAGE-2 …` is a present, forward-bound field, which is what Stage 1 requires; Stage 2 owns
  filling it. The named runner `examples/verify-mcp-definition-control-plane.ts` and the package
  directory `packages/agent-mcp` do not exist yet, which is correct at Stage 1 because the `## Plan`
  items "Rename `packages/agent-tool-mcp` to `packages/agent-mcp`" and "Add
  `examples/verify-mcp-definition-control-plane.ts` and extend `scenario:verify`" build them inside
  this Task.
- Criterion 2 — executability decision recorded: PASS. `Executability: agent-executable` is declared,
  and the § Executability probe was verified rather than accepted:
  `pnpm --filter @robota-sdk/agent-tool-mcp scenario:verify` was re-run by this guardian on
  2026-09-21 and exited
  `0`, printing exactly `result=status=untrusted; activationAttempts=0` and `result=approved=true;
  changedDefinitionDenied=true; revokedDenied=true; activationAttempts=1` — the two lines the probe
  claims. The `examples/` surface in this package is therefore demonstrably runnable by an agent.
- Criterion 3 — canonical product-surface identity AND matching invocation: **FAIL** (details below).
  The surface identity half is correct: `public-sdk-example` with
  `surface rationale: shipped-interface=public-sdk-example`, `observable type: sdk-result` with
  `observable rationale: source=public-sdk-return`, and a literal script path below `examples/`. The
  observable is genuine product behaviour, not engineering verification — the example's own printed
  SDK return values, not a build, typecheck, lint, test run, harness check, CI check, or an
  inspection of repository text — so `guardian-observable-verdict=product-behavior` holds on
  substance. The invocation and expected-observable **forms** are non-canonical.
- Criterion 4 — live-credential / external-service prerequisite stated explicitly: PASS (satisfied by
  explicit negation, not silence). Prerequisites state "no network, no MCP server, no provider
  credential and no external service is required", and the fixture is described as in-memory
  five-scope state built by the example itself. An executor learns from the scenario, not from a
  failure, that nothing external gates the run.

**Failed criteria:**

- Criterion 3 — matching canonical invocation: the Command is
  `pnpm exec tsx --conditions=source examples/verify-mcp-definition-control-plane.ts`.
  `backlog-execution.md` § Scenario Design Preference Order allows only
  `--enable-source-maps`, `--no-warnings` and `--trace-warnings` before the literal script path and
  states that "code-loading/test-runner options are not canonical"; `--conditions=source` is a
  module-resolution (code-loading) option. Verified mechanically:
  `productSurfaceInvocation('public-sdk-example', '<the authored command>', null, null)` from
  `scripts/harness/user-execution-scenario-surface.mjs` returns `null`, while the same command
  without the flag returns the invocation. The flag is also not technically necessary — this
  guardian ran `pnpm exec tsx examples/verify-mcp-activation-admission.ts --status` from
  `packages/agent-tool-mcp` and it exited `0` printing
  `result=status=untrusted; activationAttempts=0`, i.e. the sibling runner works in the canonical
  form. The direct precedent in this very package, completed Task
  `.agents/tasks/completed/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md`,
  records the canonical flag-free form even though the package's `scenario:verify` script itself
  carries `--conditions=source`; the package script is not the scenario contract.
  **Required action:** record the Command as
  `pnpm exec tsx examples/verify-mcp-definition-control-plane.ts` (or an otherwise canonical direct
  `node`/`tsx`/`pnpm exec tsx` form, or the
  `pnpm (--dir|-C) <examples-path> run <script>` directory form), and make the shipped runner
  resolvable without a code-loading flag.
- Criterion 3 — expected observable shape for `sdk-result`: the Expected observable begins
  "exit=0 and the printed lines `winner=alpha:managed …`". For `observable type: sdk-result` the
  rule fixes the shape as `result=<SDK value>`; the contract enforces `/^result=\S.*$/`
  (`scripts/harness/user-execution-scenario-contract.mjs`). The authored line is prose that names an
  exit code and several print lines, so it does not match. MCP-2520 again shows the accepted form
  (`Expected observable: result=status=untrusted; activationAttempts=0`).
  **Required action:** restate the expectation as a single `result=…` value carrying the same
  content, e.g. `result=winner=alpha:managed; shadowed=alpha:local,alpha:project,alpha:user,alpha:plugin; …; processesSpawned=0; socketsOpened=0`.
- Combined mechanical confirmation: `scenarioContract(<Scenario 1 body>, 'automatable')` returns
  `null` for the document as written. Repairing only the command, or only the expected observable,
  still returns `null`; repairing both returns a valid contract object — the two defects above are
  jointly exactly what blocks this gate.
  **Required action:** apply both repairs, then re-run DONE-GATE-STAGE-1.

No `doneGateStageOne` checkpoint-evidence block is written by this entry: the rule-owned form
(`backlog-execution.md` § Checkpoint evidence contract) binds a Stage-1 PASS and the authored
scenario text verbatim, and binding a payload to text this gate refused would fabricate the
checkpoint that GATE-IMPLEMENT's PLAN criterion and `scan-user-execution-plan-order` read.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-21

**Status upgrade:** scenario drafted → scenario written

- DONE-GATE-STAGE-1 — ordering: N/A, this gate has no prior gate (`gate-catalogue.md` § Prior-gate
  map). Input state verified independently for this run: `## User Execution Test Scenarios` carries
  `SCENARIO DRAFTED: automatable | 1`; the only earlier `DONE-GATE-STAGE-1` entry on this Task is the
  `❌ FAIL | 2026-09-21` above, so this is a re-judgement of the repaired text and not a second
  verdict on the same content; `git status --porcelain` on `feat/mcp-001-typed-control-plane`
  (HEAD `139097e83`, base `origin/integration/agreement-014@139097e83c`) shows only the paired
  planning artifacts `.agents/spec-docs/active/MCP-001-…md` and `.agents/tasks/MCP-001-…md`, and
  `packages/agent-mcp` still does not exist — no implementation the gate authorises has run.
- DONE-GATE-STAGE-1 — every scenario is written with exact commands, prerequisites, an expected
  observable result and an evidence field: PASS. Scenario 1 carries Executability, Product surface,
  Surface rationale, Prerequisites, Command, Observable type, Observable rationale, Expected
  observable, Cleanup and Evidence, each exactly once and non-empty
  (`scenarioContract(<Scenario 1 body>, 'automatable')` returns a full binding object — every field
  resolved, `browserSteps`/`uiSteps`/`productStatePath`/barrier-trio correctly absent for an
  automatable SDK scenario). `Evidence: pending implementation — recorded at DONE-GATE-STAGE-2 with
  the exact command and its observed output.` is a present, forward-bound field, which is what Stage 1
  requires; Stage 2 owns filling it. `examples/verify-mcp-definition-control-plane.ts` and
  `packages/agent-mcp` do not exist yet, which is correct here because the Task's own `## Plan` builds
  both ("Rename `packages/agent-tool-mcp` to `packages/agent-mcp` (`git mv`)" and "Add
  `examples/verify-mcp-definition-control-plane.ts` and extend `scenario:verify`").
- DONE-GATE-STAGE-1 — every scenario carries its executability decision: PASS.
  `Executability: agent-executable`, so no `manual-only:` technical reason is owed and the barrier
  trio is correctly absent. The decision is substantiated rather than asserted: this guardian re-ran
  the recorded probe for this verdict — `pnpm --filter @robota-sdk/agent-tool-mcp scenario:verify`
  exited `0` and printed exactly `result=status=untrusted; activationAttempts=0` and
  `result=approved=true; changedDefinitionDenied=true; revokedDenied=true; activationAttempts=1`,
  the two lines the § Executability probe claims. The authored flag-free invocation shape was
  separately proven runnable in this package: `pnpm exec tsx examples/verify-mcp-activation-admission.ts --status`
  from `packages/agent-tool-mcp` exited `0` printing `result=status=untrusted; activationAttempts=0`,
  so the canonical form does not depend on the `--conditions=source` flag the package's
  `scenario:verify` script happens to use.
- DONE-GATE-STAGE-1 — canonical product-surface identity and matching invocation: PASS, and the
  criterion that decided the earlier FAIL. Identity: `public-sdk-example` with
  `surface rationale: shipped-interface=public-sdk-example`; `observable type: sdk-result` with
  `observable rationale: source=public-sdk-return` — the only observable type this surface allows.
  Invocation: `pnpm exec tsx examples/verify-mcp-definition-control-plane.ts` — a literal path below
  `examples/`, no variable or glob expansion, no chained or substituted command, balanced quoting, and
  no option before the script path, so the code-loading flag that failed the previous run is gone.
  `productSurfaceInvocation('public-sdk-example', <command>, null, null)` now returns the invocation
  instead of `null`. Expected observable is the single `result=<SDK value>` line the `sdk-result`
  shape fixes (`/^result=\S.*$/` in `user-execution-scenario-contract.mjs`), carrying
  `winner=alpha:managed; alphaShadowed=4; betaWinner=beta:local; betaUnresolved=true; betaShadowed=1;
  unsetVarPreservedLiterally=true; envRedacted=true; headersRedacted=true; projectionKeysKept=true;
  processesSpawned=0; socketsOpened=0` — the same precedence, unresolved-reference, literal-unset-var,
  redaction and no-contact facts the prose form named, now in a machine-comparable shape.
  `guardian-observable-verdict=product-behavior`: the observable is the shipped example's own printed
  SDK return values, not a build, typecheck, lint, test run, harness check, CI check, or an inspection
  of repository text; `processesSpawned=0; socketsOpened=0` is a property of the product run itself,
  not an assertion about the repository. Surface choice matches the completed precedent in this very
  package, `.agents/tasks/completed/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md`,
  whose two scenarios use the same flag-free `pnpm exec tsx examples/…` form on the same
  `public-sdk-example` surface.
- DONE-GATE-STAGE-1 — a scenario requiring live credentials or an external service states that
  prerequisite explicitly: PASS, satisfied by explicit negation rather than by silence. Prerequisites
  read "no network, no MCP server, no provider credential and no external service is required", and
  name the in-memory five-scope fixture — including the malformed higher-precedence entry and the
  unset `${VAR}` reference — that the example builds for itself. An executor learns from the scenario,
  before running it, that nothing external can prevent the gate from running in their environment.
- DONE-GATE-STAGE-1 — exception clause: N/A. The exception covers a scenario that is genuinely
  impossible to write; the one declared scenario is written in full, and nothing is recorded as
  unwritten, so there is nothing to excuse.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: the winning MCP definition, what it shadowed, and that nothing was contacted",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/verify-mcp-definition-control-plane.ts",
      "observableType": "sdk-result",
      "observable": "result=winner=alpha:managed; alphaShadowed=4; betaWinner=beta:local; betaUnresolved=true; betaShadowed=1; unsetVarPreservedLiterally=true; envRedacted=true; headersRedacted=true; projectionKeysKept=true; processesSpawned=0; socketsOpened=0",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "Node.js and pnpm are installed and `pnpm install` has completed; run from `packages/agent-mcp`; the example builds its own in-memory five-scope fixture, including a malformed higher-precedence entry and an unset `${VAR}` reference; no network, no MCP server, no provider credential and no external service is required.",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/verify-mcp-definition-control-plane.ts"
      },
      "expectedObservable": "result=winner=alpha:managed; alphaShadowed=4; betaWinner=beta:local; betaUnresolved=true; betaShadowed=1; unsetVarPreservedLiterally=true; envRedacted=true; headersRedacted=true; projectionKeysKept=true; processesSpawned=0; socketsOpened=0",
      "cleanup": "the example uses only in-memory state and exits without leaving files, processes or connections.",
      "evidence": "pending implementation — recorded at DONE-GATE-STAGE-2 with the exact command and its observed output."
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
