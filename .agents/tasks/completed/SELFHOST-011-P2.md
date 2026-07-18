# SELFHOST-011 P2 — `robota eval` CLI exit-code gate + example + agent-run verification (task breakdown)

Spec: [`.agents/spec-docs/active/SELFHOST-011-evals-as-code.md`](../spec-docs/active/SELFHOST-011-evals-as-code.md)
(EPIC; P2 = this slice; design-gated, spec `in-progress`). Builds on P1's neutral `agent-framework/src/evals/`
seam. Mirror the `robota session analyze` self-contained subcommand + the `robota diagnose` exit-code contract.
agent-cli stays a THIN shell. Commit per logical slice (commit-cadence).

## Design (approved, P2)

- **agent-cli `src/eval/eval-command.ts`** (new): `runEvalCommand(argv, cwd, deps?): Promise<number>` —
  - parse `<definition-path>` (positional) + optional `--threshold <n>` override;
  - **load the consumer's eval definition** via dynamic `import()` of the module path → its default (or
    `evalDefinition`) export, validated by `defineEval` (throws on an invalid/empty definition);
  - build the **default `runFn`** from the CLI's resolved provider: `createProviderFromSettings(cwd, …)` →
    `createAgentRuntime({ cwd, provider })` → `createSessionRunFn(runtime)` (P1). Injectable via
    `deps.runFn` / `deps.loadDefinition` for the exit-code test (no live provider);
  - `runEval(def, runFn)` → print a compact per-case + overall report → **return `report.passed ? 0 : 1`**.
  - A small inline `formatEvalReport(report): string` (thin-shell presentation; a neutral SDK formatter is a
    P3 candidate).
- **agent-cli `src/cli.ts`** — pre-parse intercept mirroring `session analyze` (the definition path + `eval`
  flags would be rejected by the strict global `parseArgs`): near the top of `startCli`,
  `if (process.argv[2] === 'eval') { process.exitCode = await runEvalCommand(process.argv.slice(3), process.cwd()); return; }`
  Plus a defensive `positional[0] === 'eval'` fallthrough (like the `session analyze` note).
- **agent-cli `src/utils/cli-args.ts`** — `printHelp()` `Commands:` gains `robota eval <definition>`.
- **agent-cli `src/eval/__tests__/eval-command.test.ts`** (new, mirrors the `cli-exit-codes.test.ts` pattern) — assert `runEvalCommand` returns `1` on a failing
  eval and `0` on a passing one, via an injected fake `runFn` + a fixture definition (no live provider) —
  **TC-03, the CI gate**.
- **`examples/capabilities/agent-eval/`** (new) — runnable reference: `package.json`
  (`robota-capability-agent-eval`), `tsconfig.json`, `README.md`, `src/index.ts` (top-level await): defines a
  small dataset + a custom metric (e.g. "response mentions the requested file"), calls `runEval` with a fake
  or real `runFn`, prints the report, and `process.exit(1)` on failure — showing the SDK path + the CI-gate
  behavior. Registered as a row in `examples/README.md` "Capability examples". **TC-04.** No eval **content**
  under `packages/` — **TC-05** (manual grep; mechanical floor filed as a follow-up).

## Status

**DONE (2026-07-19).** S1–S5 implemented + green; TC-03/TC-04/TC-05 satisfied. **AGENT-RUN VERIFIED**: drove
the real `robota eval` against a live Anthropic provider — PASS def → exit 0, FAIL def → exit 1, missing-path
→ exit 1 (evidence `.agents/evals/scenarios/selfhost-011-eval-gate-agent-run.md`). agent-cli 226 tests,
typecheck, lint 0 errors, 57/57 scans; example typechecks. P3/P4 deferred to backlog
(`.agents/backlog/SELFHOST-011-P3-P4-evals-followups.md`). Epic ready for GATE-VERIFY → GATE-COMPLETE.

## Slices (each green + committed)

1. **S1 — `runEvalCommand`** (`src/eval/eval-command.ts`): argv parse + definition load + injected/default
   `runFn` + `runEval` + report format + return exit code.
2. **S2 — dispatch** (`cli.ts` pre-parse intercept + defensive fallthrough) + help text (`cli-args.ts`).
3. **S3 — exit-code contract test** (`eval-command.test.ts`, mirrors the `cli-exit-codes.test.ts` pattern): fail→1, pass→0 via injected fake `runFn`
   (TC-03).
4. **S4 — example** `examples/capabilities/agent-eval/` + `examples/README.md` row (TC-04); no lib content
   (TC-05).
5. **S5 — docs**: agent-cli SPEC.md (`robota eval` command) + a mechanical neutrality-floor follow-up
   backlog item (TC-05 guardian).

## Test Plan

- **TC-03** (exit gate): `runEvalCommand` returns 1 on a failing eval, 0 on passing — vitest, injected fake
  `runFn` + fixture definition, no live provider (dedicated `eval-command.test.ts`, mirroring the `cli-exit-codes.test.ts` pattern).
- **TC-04** (example): `examples/capabilities/agent-eval/` typechecks (`tsc --noEmit`), runs, and is
  registered in `examples/README.md`.
- **TC-05** (neutrality): no eval content under `packages/` (manual grep) + file the mechanical floor.
- Regression: `pnpm --filter @robota-sdk/agent-cli test`, typecheck, lint, `pnpm harness:scan`.

## AGENT-RUN capability verification (REQUIRED — capability-reachability rule, `.agents/rules/backlog-execution.md`)

P2 makes the capability **surface-reachable**; the rule requires the agent to **drive a real coding agent
through it and complete verification**. Deliverable:

- Build a real eval definition (a small dataset + a metric over the run's `IExecutionResult`) and run
  **`robota eval <definition>`** against a **real provider** (e.g. claude-sonnet-4-6, key already available).
- Confirm the **exit-code gate** empirically: a definition whose metric the agent's real run **fails** exits
  **1**; a definition it **passes** exits **0**.
- Save the run as scenario evidence under `.agents/evals/scenarios/selfhost-011-eval-gate-agent-run.md`
  (commands + observed exit codes + report output), mirroring the SELFHOST-008/009 agent-run scenarios.

This closes the epic's user-execution done-gate; it is NOT satisfied by the unit exit-code test alone.
