# SELFHOST-011 P2 — `robota eval` CI gate (AGENT-RUN capability verification)

Closes the capability-reachability done-gate for the evals-as-code CLI gate: the agent drove the real
`robota` CLI through `robota eval` against a **live Anthropic provider** and confirmed the exit-code gate in
both directions on a **real agent run's** `IExecutionResult` — not the unit exit-code test alone.
Per [`.agents/rules/backlog-execution.md`](../../rules/backlog-execution.md) (Capability Reachability) and the
[SELFHOST-011 spec](../../spec-docs/done/SELFHOST-011-evals-as-code.md) TC-03.

Run by the agent on 2026-07-19 with `ANTHROPIC_API_KEY` set (no owner action).

## Definitions (dependency-free `.mjs` — metrics are plain functions over the run result)

`eval-pass.mjs` — a metric the real model satisfies:

```js
export default {
  name: 'math-pass',
  cases: [{ input: 'What is 2+2? Reply with only the number, nothing else.' }],
  metrics: [{ name: 'says-4', score: (r) => r.response.includes('4') }],
  threshold: 1,
};
```

`eval-fail.mjs` — a metric the real run cannot satisfy (proves the breach path):

```js
export default {
  name: 'impossible-fail',
  cases: [{ input: 'What is 2+2? Reply with only the number, nothing else.' }],
  metrics: [{ name: 'says-ZZZQ', score: (r) => r.response.includes('ZZZQ_impossible_token') }],
  threshold: 1,
};
```

## Observed (real agent runs)

**PASS — exit 0** (the live model answered `4`; the metric scored the run's `IExecutionResult.response`):

```
$ robota eval eval-pass.mjs   # real Anthropic run
Eval: math-pass
  case 1 [1.00] What is 2+2? Reply with only the number, nothing else. — says-4=pass
Overall 1.00 vs threshold 1.00 → PASS
$ echo $?
0
```

**FAIL — exit 1** (the metric breach fails the gate):

```
$ robota eval eval-fail.mjs   # real Anthropic run
Eval: impossible-fail
  case 1 [0.00] What is 2+2? Reply with only the number, nothing else. — says-ZZZQ=fail
Overall 0.00 vs threshold 1.00 → FAIL
$ echo $?
1
```

**Missing definition — exit 1** (usage on stderr; no live run):

```
$ robota eval
Usage: robota eval <definition-file> [--threshold <0..1>]
$ echo $?
1
```

## Verdict

The `robota eval` CI gate works end-to-end against a real coding-agent run: a metric a real run **passes**
exits **0**; a metric it **fails** exits **1** — droppable into a CI job to fail a build on an agent-quality
regression. The metric scored the full run result (`IExecutionResult.response`), the framework `runEval`
aggregated to the threshold verdict, and the CLI mapped it to the process exit code. Capability is
surface-reachable AND agent-run-verified.
