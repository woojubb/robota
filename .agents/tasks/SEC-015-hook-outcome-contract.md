---
title: 'SEC-015: decoded allow/deny/error outcomes for hook execution'
status: in-progress
created: 2026-08-23
priority: critical
urgency: now
area: agent-core, agent-framework, agent-session
depends_on: []
---

Registered as GitHub issue #2083 (execution leaf of tracker issue #2075).

Paired spec-doc: `SEC-015-hook-outcome-contract.md` under `.agents/spec-docs/` — the plan, the
alternatives, the decision, and the measured baseline live there. Its lifecycle folder tracks its
gate status and is deliberately not hardcoded here, so this reference does not go stale on the next
gate transition. This file is the problem record and the verification plan; it does not restate the
design.

## Problem

A hook executor's result type (`IHookResult { exitCode, stdout, stderr }`) has room for a verdict and
no room for "I could not reach one". Every failure is therefore coerced into a verdict, and which
verdict it lands on is an accident of JavaScript truthiness:

- A truthy non-boolean `ok` (`{"ok": "false"}`, `{"ok": 1}`) → **allow**. The gate is silently
  disabled; an endpoint that said "block" is heard as "proceed".
- A falsy or absent `ok` (`{}`, `{"ok": null}`, a non-object body) → **deny**. The user's tool call is
  blocked and the block is attributed to a hook that never rendered a verdict.
- A timeout, a spawn failure, an HTTP `503`, a refused connection, and an unparseable model response
  are all discarded identically by `runHooks` (`if (result.exitCode !== 0) continue;`), so a caller
  cannot tell an enforcement gate that passed from one that never ran.

Consequence: `IRunHooksResult` has no field in which a failed evaluation appears, so the enforcing
consumer (`tool-hook-helpers.ts`, `if (hookResult.blocked)`) has nothing to fail closed on. That is
what blocks issue #2093 and issue #2099.

Measured against `origin/develop@73dff3344`; transcripts are in the spec-doc's `### Measured baseline`.

## Scope

In: the `allow | deny | error` outcome union, one shared `{ ok, reason }` verdict decoder for the
HTTP/prompt/agent executors, the command-executor exit mapping, and surfacing errors on
`IRunHooksResult`.

Out: making an `error` block (issue #2093), rejecting hook types with no reachable executor (issue #2099). New
concerns become siblings under issue #2075 — this Task does not absorb them.

## Plan

One item per Completion Criterion in the paired spec. The spec owns the criteria text; this is the
work breakdown that delivers them.

- [x] TC-01 — strict `ok` decode: a truthy non-boolean (`{"ok":"false"}`, `{"ok":1}`) becomes
      `error`/`malformed-response` instead of `allow`.
- [x] TC-02 — the other direction: `{}`, `{"ok":null}`, a non-object, `[]` become
      `error`/`malformed-response` and **not** `deny`, across the `http`, `prompt` and `agent`
      executors.
- [x] TC-03 — `CommandExecutor` exit mapping: 0⇒`allow`, 2⇒`deny`, other⇒`error`/`nonzero-exit`,
      signal-kill⇒`error`/`nonzero-exit`, timeout⇒`error`/`timeout`, `child.on('error')`⇒
      `error`/`spawn-failure`.
- [x] TC-04 — `HttpExecutor` transport mapping against a local `node:http` server: non-2xx, timeout,
      refused connection, non-JSON body, and both well-formed verdicts.
- [x] TC-05 — every outcome carries `source` equal to the definition's `type`, all five executors.
- [x] TC-06 — `runHooks` aggregates errors into `IRunHooksResult.errors`, absent when every hook
      decided. **This is the mutant-killing criterion** (see `## The mutant this must kill`).
- [x] TC-07 — enforcement policy unchanged for every outcome the decoder does not reclassify.
- [x] TC-08 — `GuardrailExecutor` verdicts preserved exactly (SELFHOST-005 fail-safe intact).
- [x] TC-09 — `IHookResult` is gone, not aliased.
- [x] TC-10 — workspace build and typecheck green; the compiler is the consumer sweep.
- [x] TC-11 — the user-execution scenario runs and prints its four `PASS` lines.
- [x] TC-12 — `pnpm harness:scan` green.

Migration surface: 13 files hold a hand-rolled `IHookTypeExecutor` returning
`{ exitCode, stdout, stderr }` and all must move to the union — enumerated in the spec's
`## Affected Files`, found by `git grep` after an inspection-based list missed seven of them.

## The mutant this must kill

A test suite for a fail-closed contract is worthless if it stays green against the implementation the
contract exists to prevent. The specific mutant here: **an `error` outcome silently folded into
`allow`.**

It is not caught by asserting `blocked`. Within this leaf's boundary an `error` legitimately does not
block — that is issue #2093's job — so the folded implementation returns the _same_ `blocked` value as
correct code on every enforcing path. A suite that only checks `blocked` is green by construction.

What kills it. Kill point 1 is TC-06's literal requirement; kill point 2 is additional coverage this
Task commits to beyond the criterion's text, recorded here because a gate reading TC-06 alone would
not require it:

1. `IRunHooksResult.errors` is populated with the right `kind` and `source`. The folded
   implementation leaves it `undefined`.
2. An errored hook contributes **no** stdout to `IRunHooksResult.stdout`. The folded implementation
   pushes it.

Checked rather than assumed: `packages/agent-session/src/__tests__/selfhost-009-pretooluse-gate.test.ts`
does assert a denied tool's `execute` is never called — a real behavioural assertion that survives
this migration — but the suite has no error case at all, so this property has zero coverage today.

## Engineering verification evidence

Recorded 2026-08-23 against the completed implementation, on branch
`fix/sec-015-hook-outcome-contract`:

- `pnpm build` — OK. `pnpm typecheck` — 0 errors across the workspace.
- `pnpm harness:scan` — 139 scans passed, 2 skipped, 0 failed.
- `pnpm --filter @robota-sdk/agent-core exec vitest run src/hooks` — 9 files, 97 tests passed
  (baseline before this work: 8 files, 51 tests).
- Package suites: agent-core 1156, agent-framework 1456, agent-session 244, agent-executor 104 —
  all passed.
- `git grep IHookResult -- 'packages/**' 'apps/**'` — no matches (TC-09).
- **Mutant check.** Folding `error` into `allow` in `hook-runner.ts` turns 4 tests red — both kill
  points independently — while every `blocked` assertion stays green:

  ```
  × TC-06: a failed hook lands in `errors` with its kind, reason and source
  × TC-06: a failed hook contributes NO stdout — its output is not a response
        → expected 'THIS MUST NOT APPEAR' to be ''
  × TC-06: several failures are all reported, in order
        → expected undefined to deeply equal [ 'failure 1', 'failure 2' ]
  × TC-06: an error is still reported when a LATER hook blocks
  Tests  4 failed | 13 passed
  ```

## Test Plan

Engineering verification. One row per spec Completion Criterion; the spec-doc's `## Test Plan` table
is the owner and this is the execution record.

- `pnpm --filter @robota-sdk/agent-core test src/hooks` — decoder + per-executor outcome tables
  (TC-01…TC-05, TC-08), including the two truthiness-regression rows in both directions.
- `pnpm --filter @robota-sdk/agent-core test src/hooks/__tests__/integration.test.ts` — runner
  aggregation and the unchanged-blocking-behavior pin (TC-06, TC-07).
- `pnpm --filter @robota-sdk/agent-framework test src/hooks` — prompt/agent executor decode paths.
- `pnpm --filter @robota-sdk/agent-session test` — the six `selfhost-009-*` / `tool-hook-helpers`
  suites whose hand-rolled executors migrate to the new return type.
- `grep -rn "IHookResult" packages apps --include=*.ts` → no matches outside `docs/` (TC-09).
- `pnpm build && pnpm typecheck` (TC-10) — the compiler is the consumer sweep for a union replacement.
- `pnpm harness:scan` (TC-12).

## User Execution Test Scenarios

### Scenario 1 — the three outcomes are decoded and reported, end to end

- **Agent-executability:** `agent-executable`.
- **Surface:** public SDK / example usage. `runHooks`, `IHookTypeExecutor` and the hook definition
  types are public exports of `@robota-sdk/agent-core`, and the repository's established form for
  exercising them is `packages/*/examples/verify-*.ts` chained by `pnpm scenario:verify`.
- **Why not the CLI:** a `PreToolUse` hook only fires behind a model-issued tool call, which needs
  live provider credentials. Probed 2026-08-23: `env` grep for `API_KEY|TOKEN|KEY` yields only
  `CLAUDE_CODE_MESSAGING_TOKEN`; the repo has `.env.example` and no `.env`; `~/.robota/` holds only
  `update-check.json`. No provider credential exists in this environment, so a CLI scenario would be
  unexecutable here. The example drives the same `runHooks` path with an offline provider.
- **Prerequisites:** a built workspace (`pnpm install && pnpm build`). No API key, no network egress,
  no external service. The example ships with this work; it creates its own temp directory and hook
  scripts and binds its HTTP endpoint to port 0.
- **Exact commands:**
  ```bash
  cd /home/ubunutu/dev/robota-4
  pnpm install
  pnpm build
  pnpm --filter @robota-sdk/agent-session scenario:verify
  echo "exit=$?"
  ```
- **Expected observable result:** exit code `0`, and stdout contains all four lines:
  - `PASS deny: tool blocked, reason="SEC-015 scenario: denied by command hook"`
  - `PASS error/spawn-failure: tool NOT blocked, error reported (source=command)`
  - `PASS error/malformed-response: tool NOT blocked, error reported (source=http)`
  - `PASS allow: tool executed`
- **Cleanup:** none required; the example removes its temp directory on exit and re-running is
  idempotent.
- **Evidence (2026-08-23, run against the completed implementation):**

  ```
  $ pnpm --filter @robota-sdk/agent-session scenario:verify
  sessions offline verify passed.
  {"scenario":"ARCH-015",...,"cleanupRemoved":true}
  {"manualCompaction":{"hookTriggers":["manual","manual"]},...}
  PASS deny: tool blocked, reason="SEC-015 scenario: denied by command hook"
  PASS error/spawn-failure: tool NOT blocked, error reported (source=command)
  PASS error/malformed-response: tool NOT blocked, error reported (source=http)
  PASS allow: tool executed
  SEC-015 hook outcome contract scenario passed.
  $ echo "exit=$?"
  exit=0
  ```

  Observed matches expected: exit code `0` and all four `PASS` lines, in the wording the scenario was
  written with before implementation began. The expectation was not rewritten to match the run.

  Durable artifact: `packages/agent-session/examples/verify-hook-outcome-contract.ts`, chained into
  `packages/agent-session/package.json` → `scenario:verify`.

### Pending verification owned by a later leaf

This Task does not deliver the fail-closed capability and does not claim it. The user-observable
change — a tool call blocked _because_ its hook failed — arrives with issue #2093, and the agent-run
verification of that behavior is issue #2093's gate. Tracker issue #2075 is not complete until it passes.
