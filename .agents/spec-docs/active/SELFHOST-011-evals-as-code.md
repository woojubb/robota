---
status: in-progress
type: BEHAVIOR
tags: [evals, sdk, ci-gate, agent-framework, agent-cli, selfhost]
---

# SELFHOST-011 (EPIC): evals-as-code — neutral SDK eval-definition/runner + `robota eval` CI gate (v1)

## Problem

Promotes backlog [SELFHOST-011](../../backlog/SELFHOST-011-evals-as-code.md) toward
[VISION.md](../../../VISION.md). Concrete symptom: Robota already runs a rich **internal** eval harness to
develop Robota itself — `.agents/evals/` defines autonomy metrics (One-Shot CI Pass Rate ≥ 80 %, Human
Intervention Rate < 20 %, Tool Diversity, Build Verification), datasets/scenarios
(`.agents/evals/scenarios/*.md`), and a lesson loop over `local-metrics/*.jsonl` (see
[.agents/evals/README.md](../../evals/README.md)). But that harness is a **repo-internal dev instrument**: it
measures _the Robota agent building Robota_, its metric definitions are house-specific, and it is wired to
harness hooks — it is not a product surface. An **SDK user building their OWN agent has no supported way to
define evals (metrics over their agent's runs) and run them exit-coded to gate their CI.** Every competitive
agent stack ships an evals-as-code path that fails a deploy on a metric regression; Robota ships none. The two
must not be conflated: the internal harness stays a dev instrument for self-hosting; THIS spec adds a
consumer-facing product surface for users to eval _their_ agents. The internal `.agents/evals` concepts
(dataset of cases, metric that scores a run, pass/fail threshold) are reused **as concepts only** — no
house-specific metric or dataset **content** is copied into `packages/`.

## Prior Art Research

Compiled at draft time from product documentation (a `prior-art-researcher` pass is part of GATE-APPROVAL):

- **Mastra — evals/scorers in CI to gate deploys** (https://mastra.ai/docs): evals are defined as code
  (scorers such as faithfulness / answer-relevancy / toxicity), attached to an agent, run in the test suite,
  and a threshold breach fails the run — the eval is an ordinary test-runner + CI citizen. The metric set is
  **opinionated and shipped by the vendor**.
- **Google ADK — evaluate toolkit** (https://google.github.io/adk-docs/): a build → evaluate → deploy loop.
  Eval cases live in `*.evalset.json` files (input + expected trajectory/response); `AgentEvaluator` /
  `adk eval` runs them and scores **the trajectory (tool-call sequence), not just the final text**; the CLI
  returns non-zero on failure so it gates CI.
- **OpenAI Agents SDK — traces feeding eval** (https://openai.github.io/openai-agents-python/): a run emits a
  structured **trace** (spans, tool calls, tokens) that downstream eval tooling scores; the run trace, not the
  output string, is the object of measurement.

**Common shape (all three):** _eval = { dataset of cases } × { metrics that score a run/trace } × { pass
threshold }_, executed as code, **non-zero exit on breach** to gate CI, scoring over the **run/trace**
(tool trajectory + tokens + response), not only the final string.

**Robota constraint / delta:** Robota's library layer is **neutral** — no domain eval _content_ in
`packages/` (see [naming-style.md](../../rules/naming-style.md) library-neutrality; the
`agent-provider-*`/`agent-tools` precedent). Where Mastra/ADK **ship** concrete metrics and dataset formats,
Robota ships only the **neutral eval-definition + runner contract**; concrete metrics and datasets are
**consumer-supplied**. Robota already scores runs over a canonical SSOT run-result (`IExecutionResult` in
`agent-interface-transport`) and already has a pure metrics-over-a-run sibling
(`@robota-sdk/agent-session-analytics`), so v1 reuses those rather than inventing a trace format.

## Architecture Review

### Affected Scope

- **`agent-framework` (SDK surface)** — the neutral **eval-definition API + runner** live HERE, in a new
  `src/evals/` subsystem, mirroring two existing precedents in the same package: (a) `createAgentRuntime()`
  (`src/runtime/agent-runtime.ts`) — a reusable, headless-friendly session factory
  (`createSession(opts): InteractiveSession`) an eval runner hangs one session per case off of, **capturing
  that session's terminal `complete`-event `IExecutionResult` as the default `runFn` — this, not `createQuery`,
  is the default run source**; and (b) `createQuery()` (`src/query.ts`) — a prompt-in convenience wrapper over
  `InteractiveSession` that resolves on the terminal `complete` event **to `result.response` (a `string`)
  only**; it is the precedent for the resolve-on-`complete` wrapper pattern, but because it drops the rest of
  the run result it **cannot** supply a full-`IExecutionResult` `runFn`. A **metric is a pure function over the
  SSOT run-result** `IExecutionResult` (`packages/agent-interface-transport/src/session-contracts.ts:125` —
  `{ response, history, toolSummaries, contextState, usage }`), **mirroring the pure metrics-over-a-run
  sibling** `@robota-sdk/agent-session-analytics` whose `analyzeSession(input: Pick<IInteractiveSessionRecord,
…>)` scores over the same SSOT record with **no file I/O and no process concerns**. **Boundary:**
  `agent-session-analytics` scores a persisted **session RECORD** (`IInteractiveSessionRecord` — a whole
  conversation's history), whereas an eval metric scores a **single RUN RESULT** (`IExecutionResult` from one
  `runFn` invocation); the eval runner therefore does **not** extend `agent-session-analytics` — it needs the
  framework's run-primitives (`createAgentRuntime`) to **produce** the `IExecutionResult` in the first place,
  which a pure record-analytics package neither has nor should take on. The `src/evals/` folder mirrors the
  structural template of the small,
  pure `src/self-hosting/` and `src/goal/` subsystems (behavior module + local `index.ts` barrel; contract
  types that cross transport/persistence go to the `agent-interface-transport` SSOT, not duplicated). Exposed
  either through the root barrel under a `// ── Evals ──` header or, for a clean opt-in surface, a `"./evals"`
  subpath in the exports map mirroring the existing `"./testing"` entry.
- **`agent-cli` (CLI CI-gate)** — a new top-level `robota eval` subcommand, mirroring the **`robota diagnose`
  precedent exactly** (`packages/agent-cli/src/cli.ts:158`): a `runEvalCommand(...): Promise<number>` returns
  the count of failed evals and the dispatcher maps it to the exit code —
  `process.exitCode = failCount > 0 ? 1 : 0` (diagnose's `// Exit contract: 0 = no issues, 1 = one or more
failed checks` is the same CI-gate contract this command needs). If `eval` needs custom flags the strict
  global `parseArgs` would reject, it is intercepted on `process.argv` before `parseCliArgs()` and parses its
  own argv, mirroring the `session analyze` multi-word precedent (`cli.ts:110`, `runSessionAnalyze` with a
  local `parseSessionAnalyzeArgs`). The command reaches the agent via the existing
  `HeadlessInteractionChannel` (`@robota-sdk/agent-transport/headless`) reusing the provider/session-store/
  command-module assembly `startCli()` already builds — no new run path. Per agent-cli's packaging rule the
  new workspace edge (if any) goes in `devDependencies` (tsdown bundles it); nothing is added to runtime
  `dependencies`.
- **`examples/`** — one capability example `examples/capabilities/agent-eval/` (folder: `package.json`
  `robota-capability-agent-eval`, `tsconfig.json`, `README.md`, `src/index.ts` with top-level await, `tsx`
  `dev` script), registered as a row in the `examples/README.md` "Capability examples" table — the established
  convention (no numeric prefix; kebab-case slug).
- **Neutrality floor** — no concrete metric or dataset **content** lands in `packages/`; the shipped surface is
  the neutral definition/runner contract + a metric-as-function type. Concrete metrics/datasets are
  consumer-supplied (example lives in `examples/`, not `packages/`).
- **`agent-command`** — **out of scope** for v1. `robota eval` is a top-level binary subcommand (agent-cli),
  not an in-session slash command; `agent-command` (the `/help`, `/mode` in-session `ICommandModule` registry)
  is only touched if a later slice adds an in-session `/eval`.

### Alternatives Considered

1. **Neutral eval-definition API + runner in `agent-framework/src/evals/` (mirror `createQuery` /
   `createAgentRuntime` / `agent-session-analytics`); `robota eval` CLI gate in `agent-cli` (mirror
   `runDiagnoseCommand` → `process.exitCode`); metrics/datasets consumer-supplied; example in `examples/`
   (CHOSEN).**
   - ✅ Places the SDK surface where the backlog names it and where the analogous run-and-score primitives
     already live (`createQuery` resolves on `complete`; `agent-session-analytics` is a pure metrics-over-a-run
     sibling), so the eval metric scores the same SSOT `IExecutionResult` instead of a bespoke format; the CLI
     gate reuses the proven diagnose exit-code contract; neutral (no domain content in libs, consumer-supplied
     metrics), satisfying library-neutrality; distinguishes cleanly from the internal `.agents/evals` dev
     harness.
   - ❌ v1 ships no built-in metrics (unlike Mastra), so a first-time user must write their own metric to see
     value; mitigated by the `examples/` reference (stated, not hidden).
2. **Put the whole thing in `agent-cli` only — no SDK surface; evals runnable solely via `robota eval`.**
   - ✅ One place; simplest to build.
   - ❌ Capability loss + wrong layer: SDK users cannot define/run evals **programmatically** in their own test
     runner (vitest/CI job) — the backlog explicitly asks for "an `agent-framework` SDK surface **+** a CLI
     command", and prior art (Mastra scorers are test-suite citizens) is programmatic-first. Conflates the
     product library with the CLI. REJECTED on capability-preservation.
3. **New dedicated package `@robota-sdk/agent-evals`.**
   - ✅ Clean top-level separation.
   - ❌ Over-decomposition (the mirror-an-analog failure that SELFHOST-003 hit twice): the analogous
     metrics-over-a-run capability (`agent-session-analytics`) is a **sibling module**, and the run primitives
     (`createQuery`, `createAgentRuntime`) already live **inside** `agent-framework`. A new package adds
     publish-registry / project-structure / SPEC ceremony for a non-family. Extraction is deferred to a later
     slice **iff** a third-party-installable metric family emerges (as SELFHOST-003 defers its interface
     package to P4). REJECTED as premature.
4. **A metric scores only the final response string (not the run-result).**
   - ✅ Simplest metric signature.
   - ❌ Capability loss: cannot score tool trajectory, token/cost, or history — yet Mastra (faithfulness over
     context) and ADK (trajectory eval) score the run/trace, and Robota already exposes `IExecutionResult`
     (`toolSummaries`, `usage`, `history`) + the `agent-session-analytics` precedent that scores the SSOT
     record. REJECTED; a metric is a function over `IExecutionResult`, not over `string`.

### Decision

Adopt (1). The neutral **eval-definition API + runner** live in a new `agent-framework/src/evals/` subsystem
(mirroring `createQuery`/`createAgentRuntime` and the pure `agent-session-analytics` metrics-over-a-run
sibling); a **metric is a pure function over the SSOT `IExecutionResult`**; the runner drives an agent through
an injected run function (default built from `createAgentRuntime().createSession()`, capturing the session's
terminal `complete`-event `IExecutionResult`, so the consumer supplies provider/agent config and the library
stays neutral). `createQuery` is cited only as precedent for the resolve-on-`complete` convenience-wrapper
pattern — it resolves to `result.response` (a `string`), not the full `IExecutionResult`, so it cannot supply
the default `runFn`. A `robota eval` top-level subcommand in `agent-cli`
mirrors `runDiagnoseCommand` — returns a failed-eval count that the dispatcher maps to
`process.exitCode = failCount > 0 ? 1 : 0` (the CI gate), reaching the agent via the existing
`HeadlessInteractionChannel`. Concrete metrics/datasets are consumer-supplied; a reference example ships in
`examples/`. A dedicated package and any in-session `/eval` command are consciously deferred. The internal
`.agents/evals` dev harness is untouched and remains separate. Epic slices below.

### Validated Recommendation

- **Reachability:** every named surface exists and the mirror is exact — `createAgentRuntime().createSession()`
  spawns headless `InteractiveSession`s whose terminal `complete` event carries the full `IExecutionResult`,
  which the default `runFn` captures (the default run source); `createQuery()` (`src/query.ts`) is precedent
  for the resolve-on-`complete` convenience-wrapper pattern **only** — it resolves to `result.response` (a
  `string`), **not** the full `IExecutionResult`, so it cannot supply a full-result `runFn`;
  `agent-session-analytics.analyzeSession(Pick<IInteractiveSessionRecord,…>)` is a
  pure metric-over-a-run; `runDiagnoseCommand(): Promise<number>` + `process.exitCode = failCount > 0 ? 1 : 0`
  (`cli.ts:158–161`) is a live CI-gate exit contract; `HeadlessInteractionChannel` is the existing non-TUI run
  path; `examples/capabilities/*` + `examples/README.md` is the example convention. The design reuses these
  paths — nothing new-invented is required to reach a working v1.
- **Capability preservation:** a metric scores the full SSOT `IExecutionResult` (response + tool trajectory +
  usage + history), so nothing measurable today is dropped; the internal `.agents/evals` autonomy metrics are
  untouched; a dedicated package + in-session `/eval` are recorded as deferred, not silently discarded.
- **Adversarial:** the primary risk is **library neutrality erosion** — a contributor adding concrete
  metrics/datasets or a house-specific eval **content** file into `packages/` (turning the neutral surface into
  a Mastra-style opinionated one). This spec keeps only the neutral definition/runner + metric-as-function
  **type** in libs and puts all concrete content in `examples/`. Per
  [enforcement-architecture.md](../../rules/enforcement-architecture.md) (every guardian needs a mechanical
  floor), this must not rest on review alone: no existing `pnpm harness:scan` rule fences eval **content** in
  `packages/`, so a mechanical neutrality floor (a scan asserting no dataset/metric-content files under
  `packages/**/evals`) is filed as a follow-up (TC-05). Secondary framing: the product eval runner is itself a
  worker (agent produces a run) / guardian (metric judges it → verdict) / orchestrator (runner routes,
  aggregates, exit-codes) shape — the same enforcement shape as the repo's own gates, but pointed at the
  **user's** agent; the non-zero exit is the mechanical floor for the **user's** CI.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: `agent-framework` (`src/evals/` — neutral eval-definition API + runner, mirror
      `createQuery`/`createAgentRuntime`/`agent-session-analytics`), `agent-cli` (`robota eval` subcommand, mirror
      `runDiagnoseCommand` → `process.exitCode`), `examples/` (one capability example). `agent-command` out of
      scope; NO new package for v1 (extract iff a metric family emerges).
- [x] Sibling scan 완료 — mirrors THREE real precedents in the same package: `createAgentRuntime` (headless
      session factory — the default `runFn` captures its session's `complete`-event `IExecutionResult`),
      `createQuery` (resolve-on-`complete` wrapper precedent only; resolves to the `response` string, so NOT a
      full-result `runFn` source), and the pure `agent-session-analytics` metrics-over-a-run sibling; the CLI
      gate mirrors `runDiagnoseCommand`'s exit-code contract. Independent
      architecture-placement validation to be recorded in the Evidence Log at GATE-APPROVAL.
- [x] 대안 최소 2개 — 4 considered (framework-API + CLI-gate CHOSEN; CLI-only REJECTED capability/layer;
      new-package REJECTED over-decomposition; string-only-metric REJECTED capability), each Pro+Con.
- [x] 결정 근거 — neutrality forces consumer-supplied metrics/datasets; run-result-scoring per the
      `IExecutionResult`/`agent-session-analytics` precedent; CI gate per the diagnose exit contract; the internal
      `.agents/evals` dev harness stays separate. GATE-APPROVAL pending.

## Solution

v1 ships the neutral surface + the CI gate + one example:

- **`agent-framework/src/evals/`** — `eval-types.ts`: `IMetric` (`{ name; score(result: IExecutionResult) →
number | boolean }`), `IEvalCase` (`{ input; expected? }`), `IEvalDefinition` (`{ cases; metrics;
threshold }`), `IEvalReport`/`IEvalCaseResult` (per-case scores + pass/fail). `runner.ts`:
  `defineEval(def): IEvalDefinition` and `runEval(def, runFn): Promise<IEvalReport>` where `runFn: (input) =>
Promise<IExecutionResult>` is injected (default built from `createAgentRuntime().createSession()`, capturing
  the session's `complete`-event `IExecutionResult`, so the consumer owns provider/agent config). `createQuery`
  cannot supply this default — it resolves to `result.response` (a `string`), dropping
  `toolSummaries`/`usage`/`history`; it is cited only as precedent for the resolve-on-`complete` wrapper
  pattern. `index.ts` barrel; re-export under a `// ── Evals ──` header (or a
  `"./evals"` subpath mirroring `"./testing"`). Contract types that cross transport/persistence go to the
  `agent-interface-transport` SSOT; behavior stays in `src/evals/`. No concrete metrics ship.
- **`agent-cli` `robota eval`** — `src/eval/eval-command.ts`: `runEvalCommand(...): Promise<number>` loads a
  user eval definition (a project file the consumer supplies), builds a `runFn` from the provider/session-store
  assembly `startCli()` already resolves, drives one `HeadlessInteractionChannel` run per case, applies the
  metrics, and returns the failed-eval count. `cli.ts` gains a `positional[0] === 'eval'` branch:
  `const failed = await runEvalCommand(...); process.exitCode = failed > 0 ? 1 : 0;` (custom flags parsed
  pre-`parseCliArgs()` like `session analyze` if needed). An exit-code contract test mirrors
  `cli-exit-codes.test.ts`.
- **`examples/capabilities/agent-eval/`** — a runnable reference: defines a small dataset + a custom metric
  (e.g. "response mentions the requested file"), calls `runEval`, prints the report, and `process.exit(1)` when
  the eval fails — showing the SDK path and the CI-gate behavior. Registered in `examples/README.md`.

**Epic slices:** P1 (this) = neutral `src/evals/` definition API + runner + `IMetric`-over-`IExecutionResult`.
P2 = `robota eval` CLI subcommand + exit-code CI gate + example. P3 = built-in _optional_ neutral metric
helpers (e.g. exact-match, JSON-schema-match — mechanism only, no domain content) + dataset-file loader. P4 =
consciously deferred: dedicated `agent-evals` package iff a third-party metric family emerges; in-session
`/eval` command.

## Affected Files

| File                                                      | Change                                                                                                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-framework/src/evals/eval-types.ts` (new)  | `IMetric` (score over `IExecutionResult`), `IEvalCase`, `IEvalDefinition`, `IEvalReport`/`IEvalCaseResult`                                                  |
| `packages/agent-framework/src/evals/runner.ts` (new)      | `defineEval` + `runEval(def, runFn)`; default `runFn` via `createAgentRuntime().createSession()` (capture `complete` `IExecutionResult`; NOT `createQuery`) |
| `packages/agent-framework/src/evals/index.ts` (new)       | barrel (values then `export type`), mirror `src/self-hosting`/`src/goal`                                                                                    |
| `packages/agent-framework/src/index.ts`                   | re-export `// ── Evals ──` block (or add `"./evals"` subpath in `package.json` like `"./testing"`)                                                          |
| `packages/agent-cli/src/eval/eval-command.ts` (new)       | `runEvalCommand(...): Promise<number>` — run cases via `HeadlessInteractionChannel`, apply metrics                                                          |
| `packages/agent-cli/src/cli.ts`                           | `positional[0] === 'eval'` branch → `process.exitCode = failed > 0 ? 1 : 0` (mirror diagnose)                                                               |
| `packages/agent-cli/src/utils/cli-args.ts`                | `printHelp()` `Commands:` gains `robota eval`; any `--eval-*` flags (or pre-parse like `session analyze`)                                                   |
| `packages/agent-cli/src/__tests__/cli-exit-codes.test.ts` | assert `eval` exits non-zero on failing eval, zero on pass                                                                                                  |
| `examples/capabilities/agent-eval/` (new)                 | `package.json` (`robota-capability-agent-eval`), `tsconfig.json`, `README.md`, `src/index.ts`                                                               |
| `examples/README.md`                                      | add a row to the "Capability examples" table                                                                                                                |

## Completion Criteria

- [ ] TC-01: `runEval(def, runFn)` runs every case, applies each metric to the run's `IExecutionResult`, and
      returns a report with per-case scores and an overall pass/fail against the threshold (unit test with a fake
      `runFn` returning a synthetic `IExecutionResult` — no live provider).
- [ ] TC-02: a metric is a pure function over `IExecutionResult` (scores response + `toolSummaries` + `usage`,
      not just the string) and `runEval` is IO-free/provider-free given an injected `runFn` (unit test; mirrors
      `agent-session-analytics` purity).
- [ ] TC-03: **a failing eval returns non-zero** — `robota eval` on a definition whose metric falls below
      threshold sets `process.exitCode` to `1`, and to `0` when all pass (exit-code contract test mirroring
      `cli-exit-codes.test.ts`; this is the CI gate).
- [ ] TC-04: a runnable example exists at `examples/capabilities/agent-eval/` (defines a dataset + a custom
      metric, calls `runEval`, exits non-zero on failure), typechecks (`tsc --noEmit`), and is registered in
      `examples/README.md` — no eval **content** is added under `packages/`.
- [ ] TC-05: **neutrality** — `packages/` ships only the neutral definition/runner + metric-as-function type;
      no concrete metric or dataset **content** file lives under `packages/`. This is a MANUAL floor today: no
      existing `pnpm harness:scan` rule fences eval content in `packages/`. Per
      [enforcement-architecture.md](../../rules/enforcement-architecture.md) (every guardian needs a mechanical
      floor), a follow-up is filed for a mechanical neutrality scan (assert no dataset/metric-content files under
      `packages/**/evals`); neutrality does not rest on the manual grep alone.
- [ ] TC-06: the runner reaches the agent through injected/assembled run paths only
      (`createAgentRuntime().createSession()` capturing the `complete`-event `IExecutionResult` in the SDK;
      `HeadlessInteractionChannel` in the CLI) — the library defines no provider and no agent config (unit test
      on the injected-`runFn` seam; the default `runFn` is constructed by the caller). The default `runFn` is
      NOT built from `createQuery`, which yields only the `response` string.

## Test Plan

| TC    | Verification                                             | Type/Tool                                         |
| ----- | -------------------------------------------------------- | ------------------------------------------------- |
| TC-01 | `runEval` scores cases + threshold pass/fail             | vitest unit (fake `runFn`)                        |
| TC-02 | metric = pure fn over `IExecutionResult`; runner IO-free | vitest unit                                       |
| TC-03 | failing eval → exit 1, passing → exit 0                  | vitest exit-code contract (mirror cli-exit-codes) |
| TC-04 | example runs + typechecks + registered; no lib content   | `tsc --noEmit` + example run + review             |
| TC-05 | no eval content in `packages/`                           | manual grep/review + follow-up mechanical floor   |
| TC-06 | injected/assembled run path; no lib-side provider/config | vitest unit (fake-`runFn` seam)                   |

## Tasks

Epic P1 (neutral `src/evals/` definition API + runner) / P2 (`robota eval` CLI gate + example) / P3 (optional
neutral metric helpers + dataset loader) / P4 (deferred: dedicated package iff a family; in-session `/eval`).

- **P1** — [`.agents/tasks/SELFHOST-011-P1.md`](../../tasks/SELFHOST-011-P1.md) (GATE-IMPLEMENT PASSED; in progress).
- P2/P3/P4 task files created after P1 completes.

## Evidence Log

- 2026-07-17 — **Draft authored**, grounded in the actual code: SDK run-and-score precedents
  `createQuery()` (`packages/agent-framework/src/query.ts` — resolves on the `complete` event, returns the run
  result) and `createAgentRuntime()` (`packages/agent-framework/src/runtime/agent-runtime.ts`); the pure
  metrics-over-a-run sibling `@robota-sdk/agent-session-analytics`
  (`packages/agent-session-analytics/src/index.ts` — `analyzeSession(Pick<IInteractiveSessionRecord,…>)`, "pure
  analysis … no file I/O, no process concerns"); the SSOT run-result `IExecutionResult`
  (`packages/agent-interface-transport/src/session-contracts.ts:125`); the CLI CI-gate exit contract
  `runDiagnoseCommand` → `process.exitCode = failCount > 0 ? 1 : 0` (`packages/agent-cli/src/cli.ts:158–161`)
  and the multi-word `session analyze` pre-parse precedent (`cli.ts:110`); the headless run path
  `HeadlessInteractionChannel` (`@robota-sdk/agent-transport/headless`); the example convention
  (`examples/capabilities/*` + `examples/README.md` table); the internal dev harness it must NOT conflate with
  (`.agents/evals/README.md`); and library-neutrality + mechanical-floor rules
  ([enforcement-architecture.md](../../rules/enforcement-architecture.md)). **GATE-APPROVAL pending** (independent
  proposal-reviewer + prior-art-researcher pass to run; architecture-placement validation to be recorded here).
- 2026-07-17 — **RE-REVIEW → REVISE (iteration 1), applied.** GATE-APPROVAL re-review confirmed the design
  DIRECTION correct (SDK eval surface in `agent-framework/src/evals/`, `robota eval` CLI gate mirroring
  `runDiagnoseCommand`'s exit contract, metric = pure fn over `IExecutionResult`, neutrality) but flagged the
  **default-`runFn` source as wrong**: the draft said the default `runFn` is built from
  `createAgentRuntime`/`createQuery`, but `createQuery` resolves to `result.response` — a `string` — only
  (`packages/agent-framework/src/query.ts:34,62–67`: `TQueryFunction = (prompt) => Promise<string>`, `onComplete`
  resolves `result.response`), **not** the full `IExecutionResult`. Wiring the default path through it would
  silently drop `toolSummaries`/`usage`/`history` and collapse the default eval into the string-only metric that
  Alternative 4 was REJECTED for, making TC-02 (which scores `toolSummaries` + `usage`) unmeetable. **Fixed:** the
  default `runFn` is now built from **`createAgentRuntime().createSession()`, capturing the session's terminal
  `complete`-event `IExecutionResult`** — the `InteractiveSession` `complete` payload is the full result (per
  `query.ts`'s `onComplete(result: IExecutionResult)`); `createQuery` is demoted to precedent for the
  resolve-on-`complete` convenience-wrapper pattern only. Updated Decision, Solution (`runner.ts`), Affected Files
  (`runner.ts` row), Validated Recommendation (Reachability), Architecture-Review Checklist (sibling scan), and
  TC-06. **Also added the `agent-session-analytics` boundary** (Affected Scope): it scores a persisted **session
  RECORD** (`IInteractiveSessionRecord`) whereas an eval metric scores a **single RUN RESULT**
  (`IExecutionResult`), so the metric does NOT extend that package — the runner needs the framework run-primitives
  (`createAgentRuntime`) to PRODUCE the result, which a pure record-analytics package neither has nor should take
  on. Everything else retained: placement, neutrality, the `.agents/evals` dev-harness-vs-product distinction, the
  4 correctness-grounded alternatives, and TC-05's honest manual floor + filed mechanical-scan follow-up.
- 2026-07-17 — **GATE-APPROVAL iteration 2: ENDORSE** (independent proposal-reviewer). Both fixes verified against
  the code: `createQuery` resolves only `result.response` (a `string`, `query.ts:34/62-67`) while
  `createAgentRuntime().createSession()`'s `complete` event carries the full `IExecutionResult`
  (`interactive-session-execution-controller.ts:281-283/394`) — so the corrected default `runFn` makes TC-02
  (scores `toolSummaries`+`usage`) meetable and no longer collapses into the rejected string-only metric; the
  `agent-session-analytics` boundary (scores a session RECORD, not a single RUN RESULT) is accurate. Placement,
  neutrality, and the `robota eval` exit-contract mirror all intact; no regression. **GATE-APPROVAL PASSED.**

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-19

**Status upgrade:** approved → in-progress

- Prior-gate precondition: GATE-APPROVAL recorded PASS (2026-07-17 iteration-2 ENDORSE, "GATE-APPROVAL PASSED."); frontmatter `status: approved` in `todo/` matches the expected GATE-IMPLEMENT input stage. ✓
- Task file created: `.agents/tasks/SELFHOST-011-P1.md` exists (epic P1 slice — neutral `src/evals/` definition API + runner). ✓
- Path recorded in `## Tasks`: the section references `.agents/tasks/SELFHOST-011*.md` (glob matching the created `SELFHOST-011-P1.md`) plus the P1–P4 epic slice breakdown. Note: the section's "미생성" wording is now stale (the P1 file exists) — a doc-currency nit, not a gate blocker; the path reference is present and discoverable. ✓
- Tasks correspond to Completion Criteria: P1 slices S1–S4 back TC-01/TC-02/TC-06 (pure contracts, `runEval` over an injected `runFn`, default `runFn` via `createAgentRuntime().createSession()` capturing the `complete`-event `IExecutionResult`); TC-03 (CLI exit contract), TC-04 (example), TC-05 (neutrality floor) are explicitly named as pending P2/P3 in the task file's "P1 scope boundary" section — no TC-N silently unaddressed. ✓
- Tasks file `## Test Plan` present and ≥50 chars: vitest unit plan for TC-01/TC-02/TC-06 with an injected fake `runFn` + regression (`pnpm --filter @robota-sdk/agent-framework test`, typecheck, lint, `pnpm harness:scan`). ✓

- 2026-07-19 — **[P1 IMPLEMENTED]** — neutral `agent-framework/src/evals/` shipped: `eval-types.ts` (`IMetric` = pure fn over the SSOT `IExecutionResult`; `IEvalCase`/`IEvalDefinition` = cases × metrics × threshold; `IEvalReport`/`IEvalCaseResult`/`IEvalMetricScore`/`TEvalRunFn`), `runner.ts` (`defineEval` validates + defaults threshold→1; `runEval(def, runFn)` runs each case through the INJECTED `runFn`, scores with each metric, normalizes boolean→1/0, aggregates `overallScore` = mean of every case×metric score, `passed = overallScore >= threshold`; IO-free/provider-free), `session-run-fn.ts` (`createSessionRunFn(runtime)` — the default `runFn` from `createAgentRuntime().createSession()` capturing the terminal `complete`-event **full** `IExecutionResult`, a fresh session per case; NOT `createQuery`, which yields only `result.response`). Barrel `src/evals/index.ts` + root `// ── Evals ──` re-export. agent-framework SPEC.md updated (What-lives-here + Type Ownership + Public API). **TC-01/TC-02/TC-06 green** (`src/evals/__tests__/runner.test.ts`, 8 tests, injected fake `runFn` + synthetic `IExecutionResult`). Regression: agent-framework 143 files / 1207 tests, typecheck clean, evals lint 0 warnings, **57/57 harness scans**. TC-03 (CLI exit gate)/TC-04 (example)/TC-05 (neutrality floor) + the **agent-run capability verification** remain P2/P3 per the capability-reachability rule (P1 is the neutral library seam). Epic-level GATE-VERIFY/COMPLETE run after the P-slices land.
- 2026-07-19 — **[P1 REVIEW → fixes applied]** (pr-review-reviewer, PR #1232, 2 SHOULD). (1) **Session leak**: `createSessionRunFn` spawned a fresh session per case but never shut it down → now `await session.shutdown()` in a `finally` (extracted `awaitRun`); the fresh-per-case design otherwise leaked N sessions + could block the CI process exit. (2) **Unclamped numeric score false-pass**: `normalized` was documented `[0,1]` but a numeric metric returning > 1 could force a false aggregate pass (mean 1.5 ≥ 1 despite a 0-scoring case) → `normalizeScore` now clamps numeric scores to `[0,1]`; `IMetric` doc states numeric scores are `[0,1]`. Also (CONSIDER) added `session-run-fn.test.ts` (4 tests: full-result capture + shutdown, interrupted-scorable, error-rejects-but-shuts-down, fresh-session-per-case+options) closing the untested-wiring gap, a clamp regression, and documented the `interrupted`-scored + `bypassPermissions` posture. Green: agent-framework 144 files / 1212 tests, typecheck, 0 evals lint warnings.
