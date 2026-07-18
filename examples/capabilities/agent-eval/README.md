# Capability: evals-as-code

Define **metrics over your agent's runs** and gate CI on a metric breach — the same
`eval = { dataset } × { metrics } × { threshold }` shape every agent stack ships, but neutral: Robota
provides only the definition/runner; **you** supply the metrics and dataset.

- A **metric** is a pure function over the run's `IExecutionResult` (response + tool trajectory + usage +
  history) — not just the final string, so you can score whether the agent used the right tool, stayed under a
  token budget, etc.
- `runEval(definition, runFn)` runs each case through a `runFn`, applies each metric, and returns a report with
  per-case scores and an overall pass/fail against the threshold.
- A failing eval `process.exit(1)`s, so dropping this into a CI job fails the build on a regression.

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
