---
title: "CORE-033: the engine's abnormal-path provider calls and history mutations are off-contract — the forced-summary call drops signal/effort/timeout and emits no replay events, and capacity/failure/streaming appends emit none of the required event families"
status: done
created: 2026-08-13
completed: 2026-08-17
priority: medium
urgency: soon
area: packages/agent-core
depends_on: []
---

# CORE-033: required replay events and per-call options are dropped on abnormal paths

## Problem

The SPEC declares `provider_request`, `assistant_message_committed`, and `history_mutation` REQUIRED
event families, and says every provider call carries `signal` and an explicit `effort`. Several engine
mutation/provider-call sites emit none of the families, and the forced-summary provider call drops the
per-call options — so a replay consumer's reconstruction diverges from the store at exactly the
abnormal paths (forced summary, capacity block, provider failure) and across the entire streaming path.

## Evidence (round-2 engine audit, 2026-08-13)

- `packages/agent-core/docs/SPEC.md:850-861` — the three REQUIRED event families;
  `:461-463`/`:495-496` — every provider call carries a signal and explicit effort.
- `execution-pipeline.ts:136-192` — `forceSummaryCall` appends a synthetic user message, calls
  `provider.chat()` directly with only `{ model, onTextDelta }` (`:161-168` — no `signal`, no
  `effort`, no idle timeout), appends the summary assistant message, and rebuilds history via
  `clear()` + re-add — emitting ZERO events (and the strip is an unannounced non-append mutation).
- `execution-round-context.ts:85-100` — the hard-capacity diagnostic assistant message is appended
  with no events; `execution-round-streaming.ts:138-141` — the `Request failed:` assistant message
  likewise.
- `execution-stream.ts` — accepts `context.onExecutionEvent` (`robota-execution.ts:39`) and never
  invokes it once; no event families on the streaming path at all.

## What was still true when this was picked up — two of five already fixed

The evidence above was gathered 2026-08-13, before CORE-042 and CORE-043 landed. Re-measured
2026-08-17 against the current tree:

| Reported                                                               | Status                                                                                                                                  |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| forced-summary drops `signal` / `effort` / idle timeout                | **already fixed by CORE-042** — the call goes through `callProviderWithIdleTimeout` with `signal`, `effort`, `maxTokens`, `temperature` |
| `execution-stream.ts` emits no families at all                         | **already fixed by CORE-042** — there is no second engine; `runStream` runs the same `execute()`                                        |
| forced-summary emits none of the three families                        | live                                                                                                                                    |
| capacity-block append emits no `history_mutation`                      | live                                                                                                                                    |
| provider-failure append emits no `history_mutation`                    | live                                                                                                                                    |
| the forced-summary history strip is an unannounced non-append mutation | live                                                                                                                                    |

The two already-fixed rows are asserted rather than assumed: the regression file carries a case that
`runStream` emits all three families, because "another change covered it" is exactly the claim that
should be checked before it is repeated.

## Direction

Emit the three families at the forced-summary, capacity-block, and provider-failure append sites.

**The strip: neither of the two options the Direction posed.** It offered "a `history_mutation`
removal vocabulary or a non-destructive strip". Both accept the premise that the synthetic
round-limit instruction belongs in the conversation and must then be taken back out. It does not: it
is a per-call prompt artifact, exactly like the schema instruction
`applyStructuredOutputTransport` adds (CORE-043), and that one is appended to the OUTGOING array and
never touches the store. The instruction now does the same. Nothing is added, so nothing has to be
removed, `mutation` still needs no removal member, and the append-only invariant is restored by
deleting code rather than by adding vocabulary.

## Test Plan

`packages/agent-core/src/services/__tests__/abnormal-path-replay-events.test.ts` — five cases,
**four red** against the unfixed code:

```
× the forced-summary call ... emits provider_request, assistant_message_committed and history_mutation
  → expected [ …(2) ] to have a length of 3 but got 2
× a replay built from the announced mutations reconstructs the real history
  → expected [ 'loop please', '', …(3) ] to deeply equal [ 'loop please', '', …(4) ]
× a provider failure emits history_mutation for the message it records
× a hard-capacity block emits history_mutation for the diagnostic it records
✓ runStream emits the same families run does          ← already true; CORE-042 fixed it
Tests  4 failed | 1 passed (5)
```

**The replay-reconstruction case is the one that matters**, and it is deliberately not written as
"the synthetic instruction is absent from the final history". That weaker assertion PASSES against
the defect — the old code appended the instruction and then stripped it, so the end state was already
clean. What was never true is that the announced mutations ADD UP to the conversation. Replaying them
is exactly what a session-log consumer does, so a divergence there is a divergence here.

Signal/effort threading on the forced call is not re-tested: CORE-042 landed it with its own
coverage, and duplicating that assertion here would put one rule in two files.

`agent-core` 1086 tests pass, and every consumer of it — `agent-framework` 1367, `agent-cli` 306,
`agent-session` 224, `agent-executor` 104.

## User Execution Test Scenarios

**Applies.** The surface is the session log — the real `.robota/logs/*.jsonl` a `Session` writes,
through the same `session-run` wiring the CLI uses. The scenario writes one, reads the FILE back, and
replays it.

`agent-executable` and provider-free: a local scripted provider drives the round cap
deterministically, so no API key and no network. (Probed: no `ANTHROPIC_*` / `OPENAI_*` / `GEMINI_*`
in the environment, no `.env`, no `~/.robota` — only `.env.example`. The scenario was designed not to
need them, which also makes it deterministic rather than merely runnable.)

### Scenario — the session log replays to the conversation that actually happened

**Command:** `cd scratch && node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-033.ts`

Runs a real `Session` with a `FileSessionLogger` and a provider that keeps calling a tool until the
round cap forces the summary call, then reads `.robota/logs/*.jsonl` and applies every announced
append in order.

**Evidence:** EXIT:0

```
live conversation : ["user:loop until the cap","assistant:","tool:{...}","assistant:","tool:{...}","assistant:here is the summary"]
replayed from log : ["user:loop until the cap","assistant:","tool:{...}","assistant:","tool:{...}","assistant:here is the summary"]
provider_request entries in the log: 3
every logged mutation is an append : true
PASS the session log replays to the SAME conversation the turn produced
PASS the forced-summary call appears in the log as a provider_request
PASS the summary the user reads is in the replayed conversation
PASS the synthetic round-limit instruction is NOT in the conversation — it never entered it
PASS and it IS in the request that was sent, so the log explains where the summary came from
PASS every logged mutation is an append — no unannounced rewrite
CORE-033 SCENARIO PASS
```

**Red-proof.** Re-run with the source edits stashed — 4 of 6 fail, and the divergence is visible in
one line: the replayed conversation simply STOPS before the summary, and only 2 of the 3 provider
calls appear in the log.

```
replayed from log : [... ,"assistant:","tool:{...}"]          ← "assistant:here is the summary" missing
provider_request entries in the log: 2                         ← the forced call is invisible
FAIL the session log replays to the SAME conversation the turn produced
FAIL the forced-summary call appears in the log as a provider_request
FAIL the summary the user reads is in the replayed conversation
FAIL and it IS in the request that was sent, so the log explains where the summary came from
CORE-033 SCENARIO FAIL (4)
```

Note which check PASSES in both runs: "the synthetic instruction is NOT in the conversation". The old
code achieved that by stripping it after the fact. That is precisely why the scenario's load-bearing
check is the replay comparison and not the end-state one.

**Scope stated, not glossed.** The comparison excludes the session's own system message, which
`Session` injects outside the execution turn and which is therefore not one of the turn's
`history_mutation` appends. Whether session-level injection should also be announced is a question
about a different layer; this item does not claim it.

**Cleanup:** the scenario creates its own temp cwd and removes it on exit.
