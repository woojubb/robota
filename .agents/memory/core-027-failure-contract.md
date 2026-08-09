# CORE-027: a failure survives to the result by identity

DONE (#1676, merged to develop 2026-08-09). The failure contract used to destroy the failure — a
provider error was rendered to prose and re-parsed, a tool crash reported as `success: true`, and an
error whose message contained "abort" returned as a successful interrupted run. The failure now
survives to the final result AS ITSELF.

- `packages/agent-core/src/services/execution-failure.ts` (new) owns `resolveProviderFailureError` +
  `buildFinalResult`: the result is built from the failure, not from its display prose.
- `IExecutionRoundState.providerFailure?: unknown` carries the failure by identity; the streaming
  round hands it out via an `onProviderFailure` callback; `execution-round.ts` sets it.
- `packages/dag-scheduler`: the batch stop is ONE shape per outcome (no second, prose-only path).
- `packages/dag-framework`: the absent dead-letter reinject is a named error
  `DAG_VALIDATION_DLQ_REINJECT_UNSUPPORTED`, not a silent no-op.
- `packages/dag-nodes/http-request`: the node's timeout is read from its OWN signal.

Verification: every Test Plan item red-proved; `headless-provider-failure.integration.test.ts`
proves an abort-prose failure exits non-zero through the real headless path. NOTE: that abort-prose
case passes on develop's sources too (the earlier `isAbortFailure` fix covers it), so it is SCENARIO
coverage of the exit contract — the identity red-proofs live in the agent-core units beside
`execution-failure.ts`. Agent-run evidence:
`.agents/evals/scenarios/core-027-failure-contract-agent-run.md`. Task archived at
`.agents/tasks/completed/CORE-027-failure-contract-destroys-the-failure.md`.
