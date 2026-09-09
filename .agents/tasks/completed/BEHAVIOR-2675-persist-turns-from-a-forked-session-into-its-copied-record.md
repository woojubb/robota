---
title: 'BEHAVIOR-2675: Persist turns from a forked session into its copied record'
issue: https://github.com/woojubb/robota/issues/2675
status: done
created: 2026-09-10
priority: medium
urgency: soon
area: packages/agent-framework, packages/agent-subagent-runner, packages/agent-session, packages/agent-transport-tui
depends_on: []
completed: 2026-09-10
---

Spec: `.agents/spec-docs/done/BEHAVIOR-2675-persist-turns-from-a-forked-session-into-its-copied-record.md`

# BEHAVIOR-2675: Persist turns from a forked session into its copied record

## Objective

When `/fork` resumes a copied InteractiveSession record, every new child turn must persist into that
copied record so attach sees current work. The source parent remains a separate record; ordinary
background jobs that do not resume a record remain transient. The task covers the in-process and
child-process runners plus strict record decoding of the existing `resumeSessionId` field.

## Plan

- [x] Update the paired `BEHAVIOR-2675` spec and affected package SPEC/README/docs before code.
- [x] Add red tests for in-process persistence, child-process persistence, codec round-trip, missing
      store failure, and ordinary-job non-persistence.
- [x] Implement conditional session-store wiring and stable resumed session id in both runners.
- [x] Run the public SDK scenario, focused tests, builds, typechecks, lint, and affected harness scans.
- [x] Record the final spec/task gate evidence and complete the task lifecycle after verification.

## Test Plan

- `pnpm exec vitest run packages/agent-framework/src/interactive/__tests__/fork-background-attach-persistence.test.ts`
- `pnpm exec vitest run packages/agent-framework/src/subagents/__tests__/fork-job-resumes-record.test.ts packages/agent-subagent-runner/src/__tests__/child-process-subagent-runner.test.ts packages/agent-session/src/__tests__/session-record-codec.test.ts`
- `pnpm --filter @robota-sdk/agent-framework scenario:verify:fork-record-persistence`
- `pnpm --filter @robota-sdk/agent-session build && pnpm --filter @robota-sdk/agent-framework build && pnpm --filter @robota-sdk/agent-subagent-runner build`
- `pnpm --filter @robota-sdk/agent-session typecheck && pnpm --filter @robota-sdk/agent-framework typecheck && pnpm --filter @robota-sdk/agent-subagent-runner typecheck`
- `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

**Environment:** the framework package already provides a public `InteractiveSession` SDK surface and
deterministic scripted-provider examples; no live network or external service is required.

### Scenario 1: SDK fork record persists new turns

- executability: agent-executable
- product surface: public-sdk-example
- surface rationale: shipped-interface=public-sdk-example
- prerequisites: repository dependencies installed and the agent-framework package built; current directory is `packages/agent-framework`; no live provider credentials or external service required because the example uses a deterministic scripted provider
- command: `pnpm exec tsx examples/verify-fork-record-persistence.ts`
- observable type: sdk-result
- observable rationale: source=public-sdk-return
- expected observable: result=FORK_RECORD_PERSISTENCE_PASS
- cleanup: the example removes its temporary session-store directory before exit
- evidence: stdout: FORK_RECORD_PERSISTENCE_PASS; exit code: 0.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-10

**Status upgrade:** scenario drafted → scenario written

**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § DONE-GATE-STAGE-1. A
guardian subagent was not dispatched because the user's current instruction prohibits multi-agent use.
The scenario is agent-executable through the public SDK example and includes the required canonical
surface, rationale, prerequisites, exact command, observable, cleanup, and evidence field.

- DONE-GATE-STAGE-1 — Every scenario is written with exact commands, prerequisites, expected observable, cleanup, and evidence: PASS — Scenario 1 contains each canonical field.
- DONE-GATE-STAGE-1 — Every scenario carries an executability decision: PASS — `executability: agent-executable`.
- DONE-GATE-STAGE-1 — Canonical product surface and matching invocation: PASS — `public-sdk-example`, `shipped-interface=public-sdk-example`, and a literal script path below `packages/agent-framework/examples/`.
- DONE-GATE-STAGE-1 — Observable is product behavior: PASS — `sdk-result`, `source=public-sdk-return`, and the example's returned result token.
- DONE-GATE-STAGE-1 — Required credentials or external service are stated: PASS — the scenario is explicitly offline and uses a deterministic provider.
- DONE-GATE-STAGE-1 — The agent can execute it via Bash: PASS — the command is a single `pnpm exec tsx` invocation with no interactive TTY or network prerequisite.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: SDK fork record persists new turns",
      "surface": "public-sdk-example",
      "surfaceRationale": "shipped-interface=public-sdk-example",
      "invocation": "pnpm exec tsx examples/verify-fork-record-persistence.ts",
      "observableType": "sdk-result",
      "observable": "result=FORK_RECORD_PERSISTENCE_PASS",
      "observableRationale": "source=public-sdk-return",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "repository dependencies installed and the agent-framework package built; current directory is `packages/agent-framework`; no live provider credentials or external service required because the example uses a deterministic scripted provider",
      "action": {
        "kind": "command",
        "value": "pnpm exec tsx examples/verify-fork-record-persistence.ts"
      },
      "expectedObservable": "result=FORK_RECORD_PERSISTENCE_PASS",
      "cleanup": "the example removes its temporary session-store directory before exit",
      "evidence": "stdout: FORK_RECORD_PERSISTENCE_PASS; exit code: 0."
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

## Tasks

- [x] Complete the paired BEHAVIOR-2675 spec and deliver the verified behavior.
