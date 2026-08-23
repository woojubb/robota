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
- **Why not the CLI.** Not because no credential-free CLI path exists — one does, and an earlier
  version of this Task wrongly said otherwise without looking. `packages/agent-provider-replay`
  replays recorded provider responses including tool calls, and `packages/agent-cli/src/cli.ts:254`
  wires it behind `--session-log` precisely so a session can run with "no key is ever used". That
  correction came from the DONE-GATE-STAGE-1 guard, not from me.

  The real reason is that **this leaf's deliverable has no CLI-observable manifestation.** What it
  adds is `IRunHooksResult.errors`, and no consumer reads it. Verified with the check that actually
  establishes that, after a guard caught an earlier draft citing an over-broad one: of the nine
  non-test files that call `runHooks(`, not one reads `.errors` off the result — the only `.errors`
  occurrences in `hook-runner.ts` are its own writes. (The earlier draft cited
  `git grep '\.errors' -- 'packages/*/src/**'`, which also matches `externalPresetLoad.errors` and
  `this.stats.errors` and so proves nothing about this field.) No product surface consumes it until
  issue #2093 wires enforcement onto it. So a CLI run could show the deny path (which is unchanged)
  and could not show the two `error` cases, which are the change. The SDK surface is where the
  delivered contract is visible, not a fallback from an unavailable CLI.

  Recorded for issue #2093's gate: that item DOES deliver CLI-observable behaviour, so this reasoning
  must not be carried over — a replay-provider CLI scenario is both available and appropriate there.

  Environment probe, retained because the Done Gate requires capability-absence claims to be probed:
  `env` grep for `API_KEY|TOKEN|KEY` yields only `CLAUDE_CODE_MESSAGING_TOKEN`; the repo has
  `.env.example` and no `.env`; `~/.robota/` holds only `update-check.json`. No live provider
  credential is present — which is why the scenario needs none rather than why the CLI was declined.

- **Prerequisites:** a built workspace (`pnpm install && pnpm build`). No API key, no network egress,
  no external service, and no provider or `Session` at all — the example drives the enforcement
  boundary (`PermissionEnforcer.wrapTools`) and `runHooks` directly, which is the path this leaf
  changes. It ships with this work; it creates its own temp directory and hook scripts and binds its
  HTTP endpoint to port 0.
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

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-23

**Status upgrade:** in-progress → in-progress (this gate transitions nothing; `status: done` requires DONE-GATE-STAGE-2 as well, per backlog-execution.md > Done Gate)

- Ordering: DONE-GATE-STAGE-1 has no prior gate (gate-catalogue.md > Prior-gate map states it explicitly); the item carries a `## User Execution Test Scenarios` section, so the gate applies. Input state `status: in-progress` is consistent — stage 1 precedes completion and no terminal status has been claimed.
- Criterion 1 (exact commands / prerequisites / expected observable / evidence field) — MET for the one scenario present, "Scenario 1 — the three outcomes are decoded and reported, end to end". Commands: `cd`, `pnpm install`, `pnpm build`, `pnpm --filter @robota-sdk/agent-session scenario:verify`, `echo "exit=$?"`. Prerequisites: built workspace, explicitly "no API key, no network egress, no external service", fixture self-provisioned (temp dir, hook scripts, `node:http` server on port 0). Expected observable: exit `0` plus four literal `PASS` lines. Cleanup: stated (self-removing temp dir, idempotent re-run). Evidence field: present and filled with a transcript. Verified rather than accepted: `packages/agent-session/package.json:49` does chain `examples/verify-hook-outcome-contract.ts` into `scenario:verify`, and the example was executed at this gate (`pnpm exec tsx --conditions=source examples/verify-hook-outcome-contract.ts`) → exit `0` and the four `PASS` lines verbatim, so the "exact commands" and "expected observable" are real, not aspirational.
- Criterion 2 (executability decision) — MET. `**Agent-executability:** agent-executable`; no `manual-only:` label is claimed, and the scenario is in fact agent-executable (confirmed by the run above), so the Agent Executability Requirement is satisfied rather than deferred.
- Criterion 3 (drives a product surface; not a build/test/harness/text-inspection observable) — MET. The observable is the four `PASS` lines printed by an example program, not a vitest/harness/CI result. Surface legitimacy judged, not accepted: backlog-execution.md:245 admits "public SDK/example usage for SDK-only features", and the CLI-default preference at :246 binds `agent-cli` and **command-package** backlogs only — per project-structure.md > Command Package Rule, command packages are `agent-command` / command-module owners, and `git show --name-only 4db0235c4` shows the change touching only `agent-core`, `agent-framework`, `agent-session` with no `agent-cli` file. Code-path exercise confirmed by reading the example: it drives production code — `runHooks` and `CommandExecutor`/`HttpExecutor` imported from `@robota-sdk/agent-core`, and `PermissionEnforcer` from the package entry (`packages/agent-session/src/index.ts:21`) via `wrapTools(...).execute(...)` — with no re-implementation of the decoder or the runner under test, so the "no static check for a code-changing item" clause is honoured.
- Criterion 4 (credentials / external-service prerequisite stated explicitly) — MET, positively rather than vacuously: the scenario states no credential, no egress and no external service are needed, and the run above needed none.
- Capability-absence probe, checked not accepted — the recorded probe reproduces exactly on this machine today: `env` grep over `API_KEY|TOKEN|KEY` yields only `CLAUDE_CODE_MESSAGING_TOKEN` (and a broader grep for `anthropic|openai|google|gemini|openrouter|azure` yields nothing but `PATH`); repo root holds `.env.example` and no `.env`; `~/.robota/` holds only `update-check.json`. The claim is probed, not guessed.
- **Recorded finding (does not fail any criterion of this gate).** The "Why not the CLI" premise — "a `PreToolUse` hook only fires behind a model-issued tool call, which needs live provider credentials" — is inaccurate: `packages/agent-provider-replay` (INFRA-017/018) replays recorded provider responses, tool calls included, and `packages/agent-cli/src/cli.ts:254-262` wires it behind `--session-log` with the comment "no key is ever used", so a provider-free CLI path exists and was not looked for. The surface choice is nevertheless correct on a stronger ground the item does not state: no product consumer reads `IRunHooksResult.errors` yet (grep across `packages/*/src` finds no non-test reader), so the two `error` cases have **no** CLI-observable manifestation in this leaf and the SDK/example surface is the only one where the delivered contract is observable. Carry-forward for issue #2093's gate: once `error` blocks, the CLI does gain an observable and the "needs live credentials" premise must not be reused — `--session-log` replay is available.
- Also inaccurate, and recorded for the same reason: the item's "drives the same `runHooks` path with an offline provider" (and the spec-doc's "through a real `Session` with an offline provider") describes something the example does not do — it constructs no `Session` and no provider at all. The scenario is provider-free, i.e. it needs strictly less than the prose claims, so no executor is misled about executability.
- Expectation integrity — the four expected `PASS` lines in this item are byte-identical to the ones in the pre-implementation plan (`.agents/spec-docs/active/SEC-015-hook-outcome-contract.md:531-534`, whose evidence field still reads "to be filled after implementation"), so the expected result was not rewritten to match the observed run.
- "Pending verification owned by a later leaf" — judged a legitimate application of backlog-execution.md > Capability Reachability, not an N/A dodge: the user-execution gate is NOT marked not-applicable (a real scenario is written and executable), the still-pending agent-run verification is named and assigned to issue #2093 (`gh issue view 2093` → OPEN, "P1 hook leaf: enforce per-event fail-closed and advisory policies"), the capability is not claimed done here, and tracker issue #2075 is stated to remain incomplete until it passes.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-23

**Status upgrade:** in-progress → done (authorized by this PASS only; the frontmatter edit and the `git mv` into `.agents/tasks/completed/` are the completion act owned by backlog-execution.md § Completion Steps, and are not performed by this gate)

- **Ordering — PASS.** Prior gate per gate-catalogue.md § Prior-gate map is DONE-GATE-STAGE-1, which shows ✅ PASS for this document (entry immediately above, dated 2026-08-23, with per-criterion findings — not a bare verdict). Expected input state "scenarios written, implementation complete" holds on both halves: the `## User Execution Test Scenarios` section carries one fully-written scenario, and the implementation is merged — `gh pr view 2193` → state MERGED, head `999dfa738`, mergeCommit `4db0235c4`, mergedAt 2026-08-23T02:55:52Z; `git log --oneline -1` → `4db0235c4`, i.e. this branch (`chore/complete-sec-015`) sits on the squash commit that carries the implementation. No premature completion: frontmatter still reads `status: in-progress` and the file is still at `.agents/tasks/` root, so the act this gate authorizes has not been taken ahead of it.
- **Criterion 1 — every scenario directly executed against the completed implementation: MET, by re-execution rather than by reading the transcript.** One scenario exists ("Scenario 1 — the three outcomes are decoded and reported, end to end"); the "Pending verification owned by a later leaf" heading declares issue #2093's work and is not a scenario of this item. Ran the scenario's exact command at this commit: `pnpm --filter @robota-sdk/agent-session scenario:verify` → exit `0`, with the four `PASS` lines reproduced verbatim, including the embedded runtime value in `reason="SEC-015 scenario: denied by command hook"`. "Against the completed implementation" verified, not assumed: `git status --short` shows only four `.md` files modified — no `.ts` in the working tree — and `scenario:verify` runs `tsx --conditions=source`, so the run resolved `@robota-sdk/agent-core` and `packages/agent-session/src` from the source that `4db0235c4` merged.
- **Criterion 2 — observed matched expected, with the expectation as authored: MET.** Expected is exit `0` plus four literal lines; observed is exit `0` plus those four lines, byte-for-byte. Expectation integrity checked three ways, because git alone cannot answer it here (PR #2193 was squash-merged as a single commit, so no pre-implementation revision of the spec survives in history): (a) the item's four expected lines are byte-identical to the plan's copy at `.agents/spec-docs/active/SEC-015-hook-outcome-contract.md` (diffed mechanically, not by eye); (b) that plan's own `- **Evidence:**` field still reads `_(to be filled after implementation — command output and exit code)_`, i.e. the authored copy was never revisited after the run; (c) `git diff -U0` over both documents shows the uncommitted corrections touched only "Why not the CLI" and "Prerequisites" — no `+`/`-` line in either file touches a `PASS` expectation or the evidence transcript, and `git show HEAD:.agents/tasks/SEC-015-hook-outcome-contract.md` already contains that transcript. The expected result was not rewritten to match the run.
- **Criterion 3 — concrete evidence recorded under the scenario's evidence field: MET.** The field holds a command transcript (`$ pnpm --filter @robota-sdk/agent-session scenario:verify`, its stdout, `$ echo "exit=$?"` → `exit=0`), not a claim. The `{"scenario":"ARCH-015",...}` elisions are the chained sibling examples' output and were expanded on re-run; the four load-bearing lines are quoted in full.
- **Durable-artifact rule (code-changing item) — MET.** Both referenced artifacts resolve: `packages/agent-session/examples/verify-hook-outcome-contract.ts` exists (8879 bytes), and `packages/agent-session/package.json` → `scenario:verify` does chain `pnpm exec tsx --conditions=source examples/verify-hook-outcome-contract.ts` as its fourth link. Mechanical floor run on the current tree: `node scripts/harness/check-done-evidence.mjs` → exit 0, "done-evidence scan passed (14 superseded reference(s))" — none of the 14 belongs to this item.
- **FAIL-trigger check — engineering verification cited as user-execution evidence: does NOT fire.** Per backlog-execution.md § Done Gate's authoritative statement, checked deliberately because Scenario 1 and Test Plan row TC-11 share one command (flagged by the DONE-GATE-STAGE-1 entry). The scenario's evidence field cites only the example program's own `PASS` output — no vitest count, no `pnpm build`, no `harness:scan`, no CI result appears in it. The build/typecheck/139-scan/1156-test/mutant results live under the separate `## Engineering verification evidence` and `## Test Plan` headings, where they belong, and are cited nowhere inside the scenario. The observable is legitimate product-surface output and not a suite result: `verify-hook-outcome-contract.ts` imports `runHooks`, `CommandExecutor`, `HttpExecutor` from `@robota-sdk/agent-core` and `PermissionEnforcer` from the package entry, drives `wrapTools(...).execute(...)`, and prints `PASS`/`FAIL` from its own `check()` with `process.exit(1)` on failure — so a green line is a conditional assertion on production code, not an echo.
- **FAIL-trigger check — unprobed capability-absence claim: does NOT fire.** No capability absence is used as an exception here: the scenario was executed. The retained credential probe is now framed as why the scenario needs no credentials rather than why a surface was declined, and it still reproduces on this machine (`env` grep `API_KEY|TOKEN|KEY` → only `CLAUDE_CODE_MESSAGING_TOKEN`; `.env.example` present, no `.env`; `~/.robota/` holds only `update-check.json`).
- **Exception clause — N/A, stated rather than skipped.** The `manual-only` execution-impossible exception is not invoked and must not be: the scenario is labelled `agent-executable` and was in fact executed twice (at STAGE-1 and again here), so the exception has no application.
- **STAGE-1's two recorded inaccuracies — re-checked, both now corrected in this item.** The "Why not the CLI" paragraph no longer asserts that no credential-free CLI path exists; it names `packages/agent-provider-replay` and `agent-cli/src/cli.ts:254` and rests the surface choice on the deliverable having no CLI-observable manifestation — which I verified independently: `git grep '\.errors' -- 'packages/*/src/**'` outside tests matches only `hook-runner.ts`, so nothing outside tests reads `IRunHooksResult.errors` and the two `error` cases have no CLI observable in this leaf. The conclusion is true, but the command the item cites for it is not the one that shows it, and that is recorded rather than waved past: `git grep '\.errors' -- 'packages/*/src/**'` outside tests matches many unrelated fields (`externalPresetLoad.errors` in `agent-cli/src/cli.ts:172`, `this.stats.errors` in `agent-core/src/abstracts/abstract-plugin.ts`, and more), not only `hook-runner.ts`. The check that does establish it: of the fourteen non-test `runHooks(` call sites (`agent-session` ×9, `agent-framework` ×1, `agent-executor` ×1, plus the definition), not one reads `.errors` off the result — grepped file by file, all negative. So no product surface consumes the field, and the surface rationale stands on a verified fact even though the item points at the wrong command for it. Not a criterion of this gate — the rationale paragraph is not one of the three DONE-GATE-STAGE-2 criteria and the scenario's own evidence field does not rest on it. The carry-forward note for issue #2093 is present. The false "offline provider" / "real `Session`" claims are gone from both this item and the plan; the example builds neither, matching what it actually does.
- **Ancillary scans on the current tree, neither a criterion of this gate:** `node scripts/harness/check-backlog-placement.mjs` → exit 0, "backlog-placement scan passed"; `node scripts/harness/scan-capability-reachability.mjs` → exit 0, "capability-reachability scan passed".
- **Out-of-scope observation, recorded because the next gate owns it and this one must not.** The paired plan's `## Tasks` row already reads ``- [x] SEC-015 — done — `.agents/tasks/completed/SEC-015-hook-outcome-contract.md` `` (uncommitted), a path that does not exist yet — the task file is still at `.agents/tasks/` root with `status: in-progress`. That row is a spec-document projection judged by GATE-COMPLETE ("the spec's `## Tasks` section names the exact active task path"), not by any DONE-GATE-STAGE-2 criterion, and this item itself claims no terminal status. It fails nothing here; it is flagged so the spec's GATE-COMPLETE run does not inherit it unexamined.
