# Capability: evals-as-code

Define **metrics over your agent's runs** and gate CI on a metric breach. An eval is
`{ cases } × { metrics } × { threshold }`; Robota provides only the definition and the runner — **you** supply
the metrics and the dataset.

- A **metric** is a pure function over the run's `IExecutionResult` (response + tool trajectory + usage +
  history) — not just the final string, so you can score whether the agent used the right tool, stayed under a
  token budget, etc.
- `runEval(definition, runFn)` runs each case through a `runFn`, applies each metric, and returns a report with
  per-case scores and an overall pass/fail against the threshold.
- The demo exits with code 1 when the eval fails, so dropping it into a CI job fails the build on a regression.

## Run

```bash
pnpm install
ANTHROPIC_API_KEY=... pnpm dev
```

The `runFn` is built from `createAgentRuntime().createSession()` (a real agent run per case) via
`createSessionRunFn`. To score a run without a live provider (e.g. a unit test), pass your own
`runFn: (input) => Promise<IExecutionResult>` returning a synthetic result.

## CLI equivalent

The same definition, as a `.mjs` module exporting `default` (or `evalDefinition`), can be gated from the CLI:

```bash
robota eval ./my-eval.mjs            # exit 1 on a metric breach — a CI gate
robota eval ./my-eval.mjs --threshold 0.9
```
