---
title: 'SEC-022: demonstrate and wire the provider-free route to a PreToolUse denial through the CLI product surface'
issue: https://github.com/woojubb/robota/issues/2225
status: todo
created: 2026-09-04
priority: critical
urgency: now
area: agent-cli, agent-transport
depends_on: []
---

# SEC-022: demonstrate and wire the provider-free route to a PreToolUse denial through the CLI product surface

Registered as [issue #2225](https://github.com/woojubb/robota/issues/2225) (P0), filed by SEC-016
([issue #2093](https://github.com/woojubb/robota/issues/2093)) as the blocker under its unmet TC-11.

Paired spec-doc:
`.agents/spec-docs/todo/SEC-022-demonstrate-and-wire-the-provider-free-route-to-a-pretooluse-denial-through-the-.md`.
The prior art, the alternatives, the decision and the delivery order live there. This file is the
problem record and the verification plan; it does not restate the design.

## Objective

Issue #2225 asked which of two readings is true and said the remedy follows from that and not
before. Establish the answer by execution, then deliver the smallest thing that makes the answer
survive: an executing test, so the next contributor does not have to rediscover it from prose.

## The re-diagnosis, and why the issue's framing does not survive it

Measured against `develop@a81cc85b7` on 2026-09-04. Full commands and outputs are in the paired
spec-doc's `## Evidence Log`.

**A provider-free route to a real `PreToolUse` denial through the CLI EXISTS, and it was run.** No
API key, no network. The real `packages/agent-cli/bin/robota.cjs`, driven by `--session-log` with the
already-committed fixture, dispatches the recorded tool call and fires the hook — a substituted hook
script received `"hook_event_name":"PreToolUse","tool_name":"Read"` on stdin. When the hook cannot
evaluate, the tool does not run; when no hook is configured, it does. The persisted session record
carries the denial with its failure kind and its source executor:

```text
{"blocked":true,"reason":"Hook could not evaluate (nonzero-exit, source: command): Hook exited 127: zsh:1: no such file or directory: /nonexistent/sec-016-hook."}
```

against the allowed run's `{"success":true,"output":"[File: …/SEC-016-PROBE.txt (1 lines)]\n1\tSEC-016 probe MARKER_XYZ"}`.

**So SEC-016's four candidate causes are all falsified** — streaming does not drop `toolCalls`, the
cursor is not consumed early, the tool surface is populated, and the recorded shape is complete.
Three different things were true instead:

1. `--output-format stream-json` has no tool event in its vocabulary at all
   (`packages/agent-transport/src/headless/headless-stream-json.ts:45`, and lines 129–134 subscribe
   to none). Measured on a run whose tool demonstrably executed: **0** stdout lines contain the
   substring `tool`. `text` and `json` formats carry nothing either. SEC-016 read that absence as
   absence of dispatch.
2. SEC-016's scenario passed `--no-session-persistence`, which removed the one surface that records
   the denial. The `tool_blocked` audit line
   (`packages/agent-session/src/tool-permission-wrapper.ts:92`) reaches a `SilentSessionLogger` on
   every CLI path, because no CLI code supplies a `sessionLogSink`.
3. TC-11 expected the kind `spawn-failure`. A `command` hook at a nonexistent path runs through a
   shell that exits 127, so the kind is `nonzero-exit`. The assertion could not have matched even on
   the right surface.

**What is genuinely missing is live observability, not reachability**, and it has one measurable
consequence today: `packages/agent-cli/src/testing/binary-agent-driver.ts` derives its
`InteractionEvent`s from stdout only (`appendStreamJsonLine`, line 57), so `toolCalls()` (line 130)
returns `[]` on the binary fidelity for a run whose tool executed, while the in-process fidelity
returns the real calls. The two fidelities of one contract disagree by returning an empty array
rather than failing.

**The mechanism that let this happen is the thing to fix.**
`packages/agent-cli/docs/SPEC.md:110` already documents the answer, added when
[issue #2302](https://github.com/woojubb/robota/issues/2302) settled the same question on `0cf426dbb`:
"In `-p` print mode only the final assistant text reaches stdout, so a tool's RESULT is invisible
there by design — observe it through a side effect, the session record, or the server log." A
sentence in a SPEC did not reach the contributor. The fixture at
`packages/agent-cli/src/__tests__/e2e/fixtures/sec-016-tool-call.jsonl` is read by no test — verified,
its only four references in the tracked tree are markdown records. An executing test would have.

## Scope

**In:** an executing built-binary suite that drives the committed fixture through the real CLI and
asserts the denied/allowed contrast on the persisted session record; correcting the three wrong facts
in SEC-016's TC-11 record; making `binary-agent-driver`'s `toolCalls()` report what ran instead of
`[]`.

**Out, and deliberately:** adding `tool_use` / `tool_result` events to the `stream-json` output
contract, and a denial roll-up on its `result` envelope. Both are the better end state, both change a
user-facing output contract, and both are recorded as options in the spec-doc's `## USER-DECISION`
rather than taken here. Also out: a new "run one builtin tool without a model turn" surface — issue
issue #2225 proposed it conditionally on there being no route, and there is one; a second path to a
security boundary is a liability.

## Plan

One item per Completion Criterion in the paired spec, in the spec's delivery order — the step that
proves the denial precedes the step that reports it.

- [x] TC-01 — the denied arm's persisted record carries `"blocked":true`, `nonzero-exit`,
      `source: command` and the hook path.
- [x] TC-02 — the allowed arm's record carries `"success":true` and the probe content, and none of
      the denial markers.
- [x] TC-03 — both arms exit `0`; the tool call is denied, the session is not.
- [x] TC-04 — red proof: with the driver change reverted, the S2 assertion fails with `[]`, and the
      mutation is confirmed applied before the result is read.
- [x] TC-05 — after the driver change, a binary-driver run over a one-tool-call fixture reports one
      `Read` call, and `cross-fidelity.bintest.ts` still passes.
- [x] TC-06 — the fixture is referenced by at least one file under `packages/agent-cli/src`.
- [ ] TC-07 — `pnpm build && pnpm typecheck` exit 0.
- [ ] TC-08 — `pnpm harness:scan` exits 0.
- [x] TC-09 — the SEC-016 record names `nonzero-exit` as the kind the CLI run observes; its two
      lines that asserted `spawn-failure` (62, 226) say so only as the expectation that was wrong,
      and line 246's SDK-surface output is left as recorded.

## The mutant this must kill

A test that spawns the binary, sees exit 0, and asserts on stdout would pass whether or not the hook
ever fired — which is exactly how SEC-016 reached a wrong conclusion, and exactly the shape where a
check is satisfied by something other than the property it names. Measured: stdout is byte-identical
between the denied and allowed arms apart from session ids and uuids.

So the assertion must read the **session record**, and it must read **both arms**. One arm alone is
explainable by the fixture; the pair is not. TC-04 carries the second mutant — a driver accessor that
returns `[]` is indistinguishable from a run with no tool calls, so the red proof has to confirm the
mutation actually applied before the result is read.

## Test Plan

Engineering verification. The spec's `## Test Plan` table is the owner; this is the execution record.

- `pnpm --filter @robota-sdk/agent-cli exec vitest run --config vitest.bin.config.ts src/__tests__/e2e/sec-022-pretooluse-denial.bintest.ts` — TC-01, TC-02, TC-03, TC-05.
- `pnpm --filter @robota-sdk/agent-cli exec vitest run --config vitest.bin.config.ts src/__tests__/e2e/cross-fidelity.bintest.ts` — TC-05's no-regression half. Verified runnable before any change: 1 file, 1 test, passed in 1254ms.
- `pnpm --filter @robota-sdk/agent-cli test:bin` with the driver change reverted — TC-04.
- `rg -c 'sec-016-tool-call\.jsonl' packages/agent-cli/src` — TC-06.
- `pnpm build && pnpm typecheck` — TC-07.
- `pnpm harness:scan` — TC-08.
- `rg -n 'spawn-failure' .agents/tasks/completed/SEC-016-per-event-hook-enforcement-policy.md` — TC-09.

**TC-04's red proof took the stronger form of the two, and the difference is recorded rather than
glossed.** The plan wrote it as "revert S2, run, see `[]`" — which needs a `git diff --stat` check
because a mutation that silently fails to apply reports the reassuring answer. It was instead run
test-first: the S2 assertion was written and executed against the **unmodified** driver, so there was
no mutation that could fail to apply, and `packages/agent-cli/src/testing/binary-agent-driver.ts`
was at HEAD when the result was read. Observed:

```text
 ✓ … > records the denial with its kind, its source executor and the hook path … (TC-01, TC-02, TC-03)  853ms
 × … > reports the tool call that ran through the binary fidelity of IAgentDriver (TC-05) 376ms
   → expected [] to have a length of 1 but got +0
 Test Files  1 failed (1) | Tests  1 failed | 1 passed (2)
```

After S2, the same command reports `Test Files 1 passed (1) | Tests 2 passed (2)`, and
`pnpm --filter @robota-sdk/agent-cli test:bin` reports `Test Files 4 passed (4) | Tests 10 passed (10)`
— `cross-fidelity.bintest.ts` included (TC-05's no-regression half).

A built workspace is a prerequisite for every `*.bintest.ts` row: `vitest.bin.config.ts` spawns
`packages/agent-cli/bin/robota.cjs`, and `--session-log` resolves
`@robota-sdk/agent-provider-replay` through a guarded `createRequire`
(`packages/agent-cli/src/product/robota-plumbing.ts:34-51`), which is a dev-only package the
published CLI does not bundle.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

**The observable vocabulary is the binding limit here, and it is recorded rather than worked
around.** For `robota-cli` the scenario contract accepts `product-output` or `product-state-file`,
and for a state file the only expressible assertion is `change=created|updated|deleted` — not its
content, and not the absence of a side effect. The denial is a _content_ difference inside a record
that both arms create, so the contract can assert that the record exists but not what distinguishes
the two arms. The contrast is therefore carried by TC-01 and TC-02 in the executing suite, and the
`Evidence` field above quotes what those assert. This is the second reason the spec-doc's
`## USER-DECISION` option (b) matters: a `tool_result` event on stdout would make the denial
expressible as `output-contains=` in this very grammar.

### Scenario 1: a PreToolUse hook that cannot evaluate stops the tool, with no provider

- Executability: agent-executable
- Product surface: robota-cli
- Surface rationale: shipped-entrypoint=robota
- Command: `robota -p "read the probe file" --output-format stream-json --session-log packages/agent-cli/src/__tests__/e2e/fixtures/sec-016-tool-call.jsonl`
- Prerequisites: a built workspace (`pnpm install && pnpm build`); `robota` resolvable on PATH from `packages/agent-cli/bin/robota.cjs`; a throwaway `HOME` whose `.robota/settings.json` declares one provider profile (any placeholder key — `--session-log` swaps the provider in before a key is read) and a `PreToolUse` command hook whose `command` is a path that does not exist; a project directory containing `SEC-016-PROBE.txt`; no API key and no network egress required, and none is used.
- Observable type: product-state-file
- Observable rationale: source=robota-state-artifact
- Product state path: .robota/sessions
- Expected result: change=created
- Evidence: the created record's `"role":"tool"` message content is `{"blocked":true,"reason":"Hook could not evaluate (nonzero-exit, source: command): Hook exited 127: ... /nonexistent/sec-016-hook."}`, and the same command with the `hooks` key removed from the same settings file yields `{"success":true,"output":"[File: .../SEC-016-PROBE.txt (1 lines)]\n1\tSEC-016 probe MARKER_XYZ"}`; both runs exit 0; measured 2026-09-04 on `develop@a81cc85b7`.
- Cleanup: remove the throwaway `HOME` and the project directory.
