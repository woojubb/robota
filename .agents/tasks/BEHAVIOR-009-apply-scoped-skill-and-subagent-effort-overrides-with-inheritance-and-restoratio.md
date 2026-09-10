---
title: 'BEHAVIOR-009: apply scoped skill and subagent effort overrides with inheritance and restoration'
issue: https://github.com/woojubb/robota/issues/1987
status: in-progress
created: 2026-08-29
priority: critical
urgency: now
area: agent-framework, agent-executor, agent-session
depends_on: []
---

# BEHAVIOR-009: scoped skill and subagent effort semantics

## Objective

Define and implement one typed execution contract for skill and subagent effort overrides. Today
skill frontmatter reads `effort` as an arbitrary string, and subagent execution applies model/tool
request overrides without an effort override. The missing behavior is not parsing alone: it is how an
override inherits, competes with session/environment authority, remains temporary, and restores the
parent value after success, failure, or cancellation.

This Task is the semantic prerequisite for issue #2094. Issue #2094 owns strict decoder and discovery-loader
migration; it must consume this Task's typed contract instead of inventing effort semantics.

## Plan

- [ ] TC-01 — use the core-owned `TModelEffort` guard at skill, agent-definition, background-request,
      and child-process DTO boundaries; reject invalid values without arbitrary-string propagation.
- [ ] TC-02 — apply one precedence rule to skill and subagent execution: explicit request > selected
      skill/agent definition > parent effective effort > core neutral default.
- [ ] TC-03 — add the session scoped override API and prove success, rejection, cancellation, and
      nested scopes restore the value active at scope entry while the parent remains unchanged.
- [ ] TC-04 — project the selected effort through in-process and child-process subagent assembly while
      preserving model, tools, role, permission, cwd, resume, provider, and session-tier fields.
- [ ] TC-05 — add the public SDK example/fixtures and record its exact four-line output and exit 0;
      run affected package tests, builds, and typechecks.
- [ ] TC-06 — update affected package SPECs, run `pnpm harness:scan` and
      `pnpm harness:verify-like-ci`, and record final review convergence with zero actionable findings.

The implementation must not take over issue #2094's strict raw frontmatter decoder or discovery-root
migration. The existing Task scenario is the public verification boundary; it remains credential-free
and uses only exported SDK/session contracts.

## Completion Criteria

- A typed effort value crosses the post-decode skill boundary and the subagent request boundary;
  neither runtime path accepts an arbitrary string or silently manufactures a default.
- The reviewed precedence contract is identical for skill and subagent execution.
- Temporary overrides are restored on success, failure, cancellation, and nested execution.
- Issue #2094 can migrate all discovery roots by consuming this contract without defining a second one.

## Test Plan

- Type-level and unit tests for the typed vocabulary and request-boundary values; issue #2094 owns
  raw metadata rejection and source-path diagnostic tests.
- Framework integration tests for inheritance, explicit override, nesting, failure, and cancellation.
- Regression tests proving parent session effort is unchanged after scoped execution.
- Affected package builds, `pnpm harness:scan`, and CI-equivalent verification before merge.

## User Execution Test Scenarios

Prerequisites: this child adds the public-SDK example
`packages/agent-framework/examples/verify-scoped-effort-overrides.ts` plus example definitions under
`packages/agent-framework/examples/fixtures/effort/{skills,agents}`. The example sets the parent effort
through the existing session/preset SDK seam, uses only exported SDK interfaces and an inline recording
provider, and directly injects the decoded skill/agent definitions; it must not import a test fixture or
a FLOW-008 CLI surface.

Run
`pnpm --filter @robota-sdk/agent-framework exec tsx examples/verify-scoped-effort-overrides.ts`.

Expected: the example prints `success scoped=high restored=low`, `failure scoped=high restored=low`,
`cancel scoped=high restored=low`, and `nested inner=high outer=medium restored=low`, then exits 0.
The example uses no persistent settings and removes its temporary session directory before exit.
Evidence: pending implementation with exact output and exit code.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

### Scenario 1: public SDK scoped-effort example

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: dependencies installed; no live provider or credentials; current directory is `packages/agent-framework`
- command: `pnpm exec tsx examples/verify-scoped-effort-overrides.ts`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=scoped-effort-four-lines
- cleanup: the example removes its temporary session directory before exit
- evidence: stdout contains exactly `success scoped=high restored=low`, `failure scoped=high restored=low`, `cancel scoped=high restored=low`, and `nested inner=high outer=medium restored=low`; exit code is `0`

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-10

**Status upgrade:** scenario drafted → scenario written

<!-- checkpoint-evidence:v1:start -->
```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: public SDK scoped-effort example",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/verify-scoped-effort-overrides.ts",
      "observableType": "sdk-result",
      "observable": "result=scoped-effort-four-lines",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "dependencies installed; no live provider or credentials; current directory is `packages/agent-framework`",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/verify-scoped-effort-overrides.ts"
      },
      "expectedObservable": "result=scoped-effort-four-lines",
      "cleanup": "the example removes its temporary session directory before exit",
      "evidence": "stdout contains exactly `success scoped=high restored=low`, `failure scoped=high restored=low`, `cancel scoped=high restored=low`, and `nested inner=high outer=medium restored=low`; exit code is `0`"
    }
  ]
}
```
<!-- checkpoint-evidence:v1:end -->

- DONE-GATE-STAGE-1 — scenario contract: PASS — the public SDK invocation, prerequisite, observable,
  cleanup, evidence, and product-behavior verdict are bound to the single authored scenario.
