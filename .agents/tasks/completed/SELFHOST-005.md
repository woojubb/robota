# SELFHOST-005 — parallel guardrails (+ tool-output validation) — DONE

Spec: [`.agents/spec-docs/done/SELFHOST-005-guardrails-structured-output.md`](../../spec-docs/done/SELFHOST-005-guardrails-structured-output.md)
GATE-APPROVAL: PASSED (iteration 3 ENDORSE). GATE-IMPLEMENT + VERIFY + COMPLETE: done.

## Slices (all DONE)

- [x] **P1 — agent-core guardrail executor (TC-02).** `GuardrailExecutor` (`type: 'guardrail'`,
      `hooks/executors/guardrail-executor.ts`) fans out the injected guardrail set with `Promise.all`
      (fail-fast: first `pass:false`/throw → `exitCode:2`), mapping onto the existing `runHooks`
      `blocked` contract. `IGuardrailHookDefinition` added to `THookDefinition`; `IGuardrailResult` +
      `TGuardrail` contract. Pure mechanism — policy is the consumer's.
- [x] **P2 — tool-output validation (TC-03).** Optional `IToolSchema.outputSchema` +
      `tool-registry/output-validator.ts`; `FunctionTool.execute` validates the output beside the
      tool-input validator, throwing `ToolExecutionError` on mismatch (reuses CORE-015
      `validateAgainstJsonSchema`). Model-output validation (CORE-015) untouched.
- [x] **P3 — agent-framework registration (TC-01/04).** `create-session` `guardrails` option →
      pushes a `GuardrailExecutor` onto the already-threaded `hookTypeExecutors`; agent-session
      unchanged. A guardrail block rides the SINGLE `runHooks`→`runPreToolHook`→`PermissionEnforcer`
      blocked path (no second tier).
- [x] **TC-05 — neutrality.** No domain guardrail policy in `packages/`; `harness:scan` 54/54.

## Verification (AGENT-RUN)

agent-core 865 (incl. TC-02 7 / TC-03 4 / TC-01+04 4) + agent-framework 1141 + typecheck + build +
lint (0 errors) + `harness:scan` 54/54, all green. agent-session UNCHANGED as designed.
