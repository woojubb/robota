---
status: approved
type: SECURITY
tags: [cli, auth, streaming, typescript]
lane: L1
---

# SEC-022: demonstrate and wire the provider-free route to a PreToolUse denial through the CLI product surface

Paired with `.agents/tasks/SEC-022-demonstrate-and-wire-the-provider-free-route-to-a-pretooluse-denial-through-the-.md`.
Arising from [issue #2225](https://github.com/woojubb/robota/issues/2225), filed by SEC-016
([issue #2093](https://github.com/woojubb/robota/issues/2093)) as the blocker under its unmet TC-11.

## Problem

Issue #2225 asks which of two readings is true, and says the remedy follows from that and not
before. **Both readings were tested by execution against `develop@a81cc85b7` on 2026-09-04, and the
answer is neither of them as stated.** Every command and its output is in `## Evidence Log`; the
claims below are summaries of runs recorded there, not inferences from reading code.

**Reading 1 — "the setup was wrong."** Partly true, but not in the way the issue guessed. Its four
named candidates (streaming drops `toolCalls`; the replay cursor is consumed early; print mode's
tool surface is unpopulated; the recorded shape omits a field) are all **falsified**: the tool call
IS dispatched and the hook DOES fire.

**Reading 2 — "the product has no provider-free route to its enforcement boundary."** **False.** A
route exists, and it was executed end to end with no API key and no network egress.

### What was actually happening

**The `PreToolUse` hook fires.** A hook script substituted for the nonexistent path in SEC-016's own
scenario received, on stdin, from the real `packages/agent-cli/bin/robota.cjs` driven by
`--session-log` with the committed fixture:

```text
{"session_id":"session_01add975-7b38-45ef-808e-569d4042e263","cwd":".../run2/proj","hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"filePath":".../SEC-016-PROBE.txt"},"permission_mode":"bypassPermissions"}
```

**The denial is real and it stops the tool.** With a recorded `Bash` call whose command is
`touch SEC016_TOOL_RAN`, the marker file is absent when a `PreToolUse` hook cannot evaluate and
present when no hook is configured — same fixture, same binary, same prompt.

**The denial reason is recorded, with the failure kind and the source executor.** The persisted
session record's `tool` message carries, verbatim:

```text
{"blocked":true,"reason":"Hook could not evaluate (nonzero-exit, source: command): Hook exited 127: zsh:1: no such file or directory: /nonexistent/sec-016-hook."}
```

against the allowed run's

```text
{"success":true,"output":"[File: .../SEC-016-PROBE.txt (1 lines)]\n1\tSEC-016 probe MARKER_XYZ"}
```

That is TC-11's required contrast, produced through the CLI, with no provider.

### So why did SEC-016 see nothing? Three independent causes, none of them dispatch

1. **`stream-json` has no tool event in its vocabulary.**
   `packages/agent-transport/src/headless/headless-stream-json.ts:45` defines `TStreamJsonEvent` as
   exactly three variants — `content_block_delta`, `background_task_event`,
   `background_job_group_event` — and lines 129–134 subscribe to `text_delta`,
   `background_task_event`, `background_job_group_event`, `complete`, `interrupted`, `error`. No
   tool event is defined and none is subscribed. Measured on a run in which the tool demonstrably
   executed (the marker file was created): stdout carried **0** lines containing the substring
   `tool`, and exactly three events — two `content_block_delta`, one `result`. SEC-016 read that
   absence as absence of dispatch. The session already emits `tool_start` / `tool_end`, and
   `packages/agent-framework/src/interaction/createInteractiveRuntime.ts:51,58` maps them to
   `tool-call` / `tool-result`; the headless subscriber is the one consumer that does not.

2. **SEC-016's own scenario disabled the one surface that records the denial.** It passed
   `--no-session-persistence`, so the persisted record quoted above was never written. Nothing else
   in the CLI carries the denial: `enforcer.log('tool_blocked', …)`
   (`packages/agent-session/src/tool-permission-wrapper.ts:92`) reaches a `SilentSessionLogger`,
   because `sessionLogSink` is supplied only by `packages/agent-framework/src/testing/scripted-session-harness.ts:196`
   and `packages/agent-framework/examples/verify-session-log-external-payload-replay.ts:51`, never
   by the CLI product path.

3. **TC-11's expected string could not have matched.** It expected `spawn-failure`. A `command` hook
   pointing at a nonexistent path is run through a shell, which exits 127, so the kind produced by
   `packages/agent-session/src/tool-hook-helpers.ts:147` is `nonzero-exit`. `spawn-failure` and
   `nonzero-exit` are both members of the failure-kind union at
   `packages/agent-core/src/hooks/types.ts:185-195`; the scenario named the wrong one. So even a
   scenario reading the right surface would have failed on the assertion.

### What is genuinely missing, and it is narrower than the issue feared

The gap is **live observability, not reachability**. It has one measurable consequence in the tree
today: `packages/agent-cli/src/testing/binary-agent-driver.ts` implements the cross-fidelity
`IAgentDriver` contract, and `appendStreamJsonLine` (line 57) maps only `content_block_delta` and
`result`. So `toolCalls()` (line 130) returns `[]` on the binary fidelity for a run whose tool
executed, while the in-process fidelity returns the real calls — the two fidelities disagree
**silently**, by returning an empty array rather than failing.

### What was already documented, and was not read

`packages/agent-cli/docs/SPEC.md:110` already states the answer, added when
[issue #2302](https://github.com/woojubb/robota/issues/2302) settled the same question:

> **What a replay executes (issue #2302).** The replay substitutes the MODEL, never the tools: a
> `toolCalls` entry in a recorded response is dispatched against the session's live tool set, the
> tool's result is appended to the conversation, and the next recorded response is consumed
> (`agent-provider-replay/src/__tests__/replayed-tool-call-executes.test.ts`). In `-p` print mode only
> the final assistant text reaches stdout, so a tool's RESULT is invisible there by design — observe
> it through a side effect, the session record, or the server log.

Issue #2302 was closed as fixed on `0cf426dbb`. Issue #2225 was filed against behaviour this
sentence already describes. The reason a contributor did not find it is the thing to fix
mechanically: **the fixture at `packages/agent-cli/src/__tests__/e2e/fixtures/sec-016-tool-call.jsonl`
is read by no test.** Verified: the only references to that path in the tracked tree are two
markdown records (`.agents/tasks/completed/SEC-016-…md:193,295` and
`.agents/spec-docs/rejected/SEC-016-…md:361,455`). A prose sentence in a SPEC did not survive
contact with a contributor; an executing test would have.

## Prior Art Research

Every quote below was **re-fetched and verified verbatim by this author** at the URL beside it, not
taken on the research pass's word. Where a page could not be retrieved in full, that is stated and
the claim is not used.

### (A) How comparable agent CLIs make a denial observable

**Anthropic Claude Code — `tool_use`/`tool_result` blocks on the stream, and a denial roll-up on the
result message.** <https://code.claude.com/docs/en/headless> (verified 2026-09-04):

> "`stream-json`: newline-delimited JSON for real-time streaming"

> "By default, Claude Code emits only subagent `tool_use` and `tool_result` blocks."

and, in the section "Turn off permission prompts in unattended runs" — the scope matters and is
quoted with it:

> "With `--output-format stream-json`, denials appear as `permission_denied` system messages, and the final result message lists them in `permission_denials`."

**Google Gemini CLI — the same two event names, on a JSONL stream.**
<https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md> (verified verbatim):

> "Returns a stream of newline-delimited JSON (JSONL) events.
>
> - **Event types:**
>   - `init`: Session metadata (session ID, model).
>   - `message`: User and assistant message chunks.
>   - `tool_use`: Tool call requests with arguments.
>   - `tool_result`: Output from executed tools.
>   - `error`: Non-fatal warnings and system errors.
>   - `result`: Final outcome with aggregated statistics and per-model token usage breakdowns."

and a rejection roll-up on the final result object —
<https://google-gemini.github.io/gemini-cli/docs/cli/headless.html> (verified verbatim):

> `"totalDecisions": { "accept": 0, "reject": 0, "modify": 0, "auto_accept": 1 }`

**Cursor CLI — NDJSON with a started/completed tool-call pair; no denial event on that page.**
<https://cursor.com/docs/cli/reference/output-format> (verified verbatim):

> "The `stream-json` output format emits newline-delimited JSON (NDJSON). Each line contains a single JSON object representing an event during execution."

The page documents system initialization, user message, assistant message, tool call events
(`started` and `completed`) and a terminal result. **I did not find a permission-denied or
blocked-tool event documented on that page.** That is a statement about
`https://cursor.com/docs/cli/reference/output-format`, which is the page Cursor's docs designate as
the output-format reference; it is not a claim about the product as a whole, and I did not read
every Cursor docs page.

**Not used as evidence.** The research pass also reported quotations from
<https://code.claude.com/docs/en/agent-sdk/typescript> about an `SDKPermissionDeniedMessage` that
allegedly excludes `PreToolUse`-path denials and designates `permission_denials` as authoritative.
**I attempted to verify those and could not retrieve that section** — two fetches of that URL (bare
and with the `#sdkpermissiondeniedmessage` anchor) returned content that did not contain the
section, the page being long enough to truncate. Those claims are therefore **excluded from the
reasoning below**, and the Decision does not rest on them. They are recorded here only so a later
reader knows they were considered and why they are absent.

### (B) Exercising a tool-call path with no live provider

**Pydantic AI documents a test model that drives the tool-call path itself.**
<https://pydantic.dev/docs/ai/guides/testing/> (verified verbatim):

> "this will (by default) call all tools in the agent, then return either plain text or a structured response"

> "Set `ALLOW_MODEL_REQUESTS=False` globally to block any requests from being made to non-test models accidentally"

### Observed common behaviour, and the constraint on Robota

Across the three products whose output formats I verified directly, the denial rides the
**tool-call record**, and the stream carries a tool-call record to ride on: Claude and Gemini both
name the pair `tool_use` / `tool_result`; Cursor uses one `tool_call` record with `started` and
`completed` phases. Two of the three (Claude's `permission_denials`, Gemini's
`totalDecisions.reject`) additionally put a denial roll-up on the final result object.

**The constraint that applies to Robota is that it has no tool-call record on the stream to attach a
denial to** (`headless-stream-json.ts:45`, measured above). So "add a denial event" is not the
smallest available step and would be an event with nothing to attach to. Meanwhile Robota already
has the surface the same products treat as durable — a persisted per-session record that, as
measured in `## Evidence Log`, already carries `blocked`, the failure kind and the source executor.

Robota's `agent-provider-replay` is on the model-substitution axis that Pydantic AI's `TestModel`
exemplifies, not the HTTP-cassette axis. Its stated limit is real and is a constraint on this item:
`packages/agent-cli/src/product/robota-plumbing.ts:34-51` and `packages/agent-cli/docs/SPEC.md:105`
make `--session-log` a **dev-only** capability, "resolvable in the monorepo (and for anyone who
installs the package), and reported as unavailable — never a hard crash — in the default published
CLI". The scenario below therefore runs from a built workspace, which is what SEC-016's own scenario
already declared as its prerequisite, and this document does not claim the route is available to a
user of a published `npm i` install.

## Architecture Review

### Affected Scope

- `packages/agent-cli` — `src/__tests__/e2e/` (new bintest suite), `src/testing/binary-agent-driver.ts`,
  `docs/SPEC.md` (Test Strategy prose only).
- `.agents/tasks/completed/SEC-016-per-event-hook-enforcement-policy.md` — the TC-11 record that
  cited three wrong facts.

**Why the declared lane is L1, stated so a reviewer can refuse it rather than take it on trust.** The
floor is the highest any changed path reaches (`spec-workflow.md` § Lane floors). Two paths are under
`**/src/**` with a non-comment change → **L1**; the SEC-016 record is markdown → L0. The only path
that could reach L2 is `packages/agent-cli/docs/SPEC.md`, whose row is qualified
`#trigger-sections` — it counts at L2 only when a changed hunk lies under a heading the SPEC-update
table names. Computed from the rule text, those headings are `Public API Surface`, `Type Ownership`,
`Class Contract Registry`, `Error Taxonomy`, `State Lifecycle`, `Event Architecture`,
`Architecture Overview`, `relevant section`, `Extension Points`. **The SPEC edit is confined to
`## Test Strategy` (line 710), which is not among them.** If the edit moves under any of those
headings, the floor becomes L2 and this declaration must be raised — the diff decides, not this
paragraph.

No package's Public API Surface, Type Ownership, Class Contract Registry, Error Taxonomy or
State Lifecycle section is touched. `createBinaryAgentDriver` is not a published export:
`packages/agent-cli/package.json` exposes only `"."` → `src/index.ts`, and that file is three lines
long and exports `startCli` and `IStartCliOptions` only. Its sole consumer in the tree is
`packages/agent-cli/src/__tests__/e2e/cross-fidelity.bintest.ts:23`.

### Alternatives Considered

1. **Alternative 1 — record the existing route as an executing test, then repair the cross-fidelity
   driver's silent `[]`.** (Chosen.)
   **Pro:** closes issue #2225's P0 and SEC-016's TC-11 with behaviour that already ships; the fixture
   stops being orphaned; the one measurable defect (a contract accessor that returns `[]` instead of
   failing) is fixed at its cause. **Con:** leaves a live denial invisible on stdout, so a CI job still
   cannot gate on "was anything denied" without reading a file afterwards.

2. **Alternative 2 — add `tool_use` / `tool_result` to the `stream-json` vocabulary and carry the
   denial as the terminal state of `tool_result`.**
   **Pro:** matches the shape all three verified comparables use, and makes the denial observable live;
   would also fix the driver at the source rather than by a second reader. **Con:** it adds variants to
   the documented output contract of `--output-format stream-json`, which is a user-facing surface
   every existing parser reads. That is outside standing pre-approval, so it cannot be taken here —
   see `## USER-DECISION`. It also does not close #2225 any sooner: the route already exists.

3. **Alternative 3 — build a new "run one builtin tool without a model turn" product surface**, the
   cheapest fix the issue itself suggested.
   **Pro:** would serve permission tests too. **Con:** **the premise is now falsified** — the issue proposed
   it conditionally on there being no route, and there is one. It would add a second way to reach the
   enforcement boundary whose behaviour would then have to be kept in agreement with the real one, and
   a second path to a security boundary is a liability, not a convenience.

4. **Alternative 4 — accept the SDK-surface evidence SEC-016 already has and tick TC-11.**
   **Pro:** zero work. **Con:** SEC-016 explicitly refused this, correctly: the criterion names the CLI
   because this leaf's deliverable is CLI-observable. Ticking it on a different surface is moving the
   criterion to fit what was runnable.

### Decision

**Alternative 1.** The trade-off that decides it: Alternative 2 is the better end state and this
document says so, but it changes a user-facing output contract, and issue #2225 is a P0 that Alternative 1
closes with behaviour that already ships. Doing 2 first would make the P0 wait on an approval it does
not need. Alternative 1 is also what makes Alternative 2 _safe_ to do later — after S1 lands there is
an executing test that fails if a denial stops happening, so a future change to the stream vocabulary
is judged against a live assertion rather than against prose.

**Delivery mode:** `sequenced`

**Continuation artifacts:** `packages/agent-cli/src/__tests__/e2e/sec-022-pretooluse-denial.bintest.ts`, `packages/agent-cli/src/testing/binary-agent-driver.ts`, `packages/agent-cli/docs/SPEC.md`, `.agents/tasks/completed/SEC-016-per-event-hook-enforcement-policy.md`

**Delivery order is security-first: the step that PROVES the denial precedes the step that REPORTS
it.** S2 turns `toolCalls()` from a silent `[]` into a populated array, which is a new affordance
that scenarios will start asserting against. If S2 landed first, the first assertion written on it
would be trusted before anything proved the denial underneath it actually occurs — a reporting
surface believed on its own word. So:

1. **S1 — prove the boundary.** Add
   `packages/agent-cli/src/__tests__/e2e/sec-022-pretooluse-denial.bintest.ts`, driving the real
   binary with the already-committed fixture, asserting the denied/allowed contrast on the persisted
   session record and on the tool's side effect. Correct the three wrong facts in SEC-016's TC-11
   record. Criteria: TC-01, TC-02, TC-03, TC-06.
2. **S2 — stop the silent disagreement.** Make `binary-agent-driver.ts` populate `tool-call` /
   `tool-result` `InteractionEvent`s from the persisted session record, so the binary fidelity's
   `toolCalls()` reports what ran. Criteria: TC-04, TC-05.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the three headless output formats were checked together:
      `text`/`json`/`stream-json` all settle through `writeJsonResult` /
      `runTextFormat` in `packages/agent-transport/src/headless/headless-runner.ts`, and none of
      them carries a tool event, so this item does not fix one format and leave a sibling behind.
- [x] 대안 최소 2개 검토 완료 — four
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None.

S2 reads the persisted session record. If session persistence is off for a run, the driver reports
no tool events for that run — that is the accurate answer, not a fallback: the record is the source,
and there is nothing to degrade to. S2 must not silently substitute stdout-derived events for
record-derived ones.

## Solution

**S1.** `packages/agent-cli/src/__tests__/e2e/sec-022-pretooluse-denial.bintest.ts`, a `*.bintest.ts`
suite in the existing built-binary project (`packages/agent-cli/vitest.bin.config.ts`, which
includes `src/**/*.bintest.ts`). It:

- spawns `packages/agent-cli/bin/robota.cjs` twice against a temp `HOME` and a temp project, with
  `-p`, `--output-format stream-json`, `--session-log <the committed fixture>` and **session
  persistence left on**;
- run A configures a `PreToolUse` command hook at a path that does not exist; run B uses the same
  settings with the `hooks` key removed, so the provider profile survives and only the hook differs;
- asserts the tool message in run A's persisted record contains `"blocked":true`, `nonzero-exit`,
  `source: command` and the hook path, and that run B's contains the file content and none of those;
- asserts both runs exit `0` — the tool call is denied, the session is not.

It also corrects the record in `.agents/tasks/completed/SEC-016-per-event-hook-enforcement-policy.md`:
`--no-session-persistence` removed the observing surface, the expected kind is `nonzero-exit` not
`spawn-failure`, and the "no tool event → not dispatched" inference is wrong.

**S2.** `packages/agent-cli/src/testing/binary-agent-driver.ts` gains a per-`send` read of the
session record the run just wrote, appending `tool-call` and `tool-result` `InteractionEvent`s in
recorded order, so `toolCalls()` reports the calls that ran. `--no-session-persistence` is dropped
from the spawned argument list for that reason and the temp `HOME` becomes the record's location.
`appendStreamJsonLine` is unchanged: stdout keeps meaning exactly what it means today.

## Affected Files

| File                                                                        | Change                                                   |
| --------------------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/agent-cli/src/__tests__/e2e/sec-022-pretooluse-denial.bintest.ts` | new — S1                                                 |
| `packages/agent-cli/src/testing/binary-agent-driver.ts`                     | modified — S2                                            |
| `packages/agent-cli/docs/SPEC.md`                                           | Test Strategy prose: name the provider-free denial suite |
| `.agents/tasks/completed/SEC-016-per-event-hook-enforcement-policy.md`      | correct the TC-11 record                                 |

## Completion Criteria

- [ ] TC-01: `pnpm --filter @robota-sdk/agent-cli exec vitest run --config vitest.bin.config.ts src/__tests__/e2e/sec-022-pretooluse-denial.bintest.ts` → exits 0, and its denied-run assertion reads a persisted session record whose `tool` message content contains all four of `"blocked":true`, `nonzero-exit`, `source: command`, and the configured hook path.
- [ ] TC-02: the same run's allowed-run assertion reads a `tool` message whose content contains `"success":true` and the probe file's content, and contains none of `blocked`, `nonzero-exit`, `source: command`.
- [ ] TC-03: both runs in TC-01/TC-02 exit `0` — asserted explicitly, because a non-zero session exit is a behaviour this boundary does not deliver.
- [ ] TC-04: red proof for S2 — with S2 reverted and S1 present, `pnpm --filter @robota-sdk/agent-cli test:bin` reports the S2 assertion failing with a received value of `[]`, and the mutation is confirmed applied before the result is read (`git diff --stat packages/agent-cli/src/testing/binary-agent-driver.ts` → non-empty).
- [ ] TC-05: after S2, a binary-driver run over a fixture carrying one recorded tool call reports `driver.toolCalls().length === 1` with `name === 'Read'`, and `pnpm --filter @robota-sdk/agent-cli exec vitest run --config vitest.bin.config.ts src/__tests__/e2e/cross-fidelity.bintest.ts` still exits 0.
- [ ] TC-06: `rg -c 'sec-016-tool-call\.jsonl' packages/agent-cli/src` → at least `1` (the fixture is read by an executing test, not only by markdown records).
- [ ] TC-07: `pnpm build && pnpm typecheck` → both exit 0.
- [ ] TC-08: `pnpm harness:scan` → exits 0.
- [ ] TC-09: `rg -c 'nonzero-exit' .agents/tasks/completed/SEC-016-per-event-hook-enforcement-policy.md` → at least `1`, and `rg -n 'spawn-failure' ` over the same file returns exactly the three lines it returns today — 62 and 226 rewritten so `spawn-failure` appears only as the expectation that was wrong, and 246 unchanged, because there `spawn-failure` is the kind an SDK-surface run genuinely produced and a closed record is a record of what was observed then.

## Test Plan

Type `SECURITY` + tags `cli`, `auth` → auth integration + permission boundary test, run against the
real binary; tag `typescript` → typecheck; tag `streaming` → the stream-json output assertion is
part of TC-05's cross-fidelity row.

| TC-ID | Test Type               | Tool / Approach                                                                                  | Notes                                                                     |
| ----- | ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| TC-01 | Permission boundary E2E | `vitest run --config vitest.bin.config.ts` over the new `*.bintest.ts`, spawning the real binary | Denied arm; the whole point of the item                                   |
| TC-02 | Permission boundary E2E | same suite                                                                                       | Allowed arm; the contrast is the observable, one arm alone proves nothing |
| TC-03 | Process integration     | same suite, asserting `exitCode === 0` on both arms                                              |                                                                           |
| TC-04 | Mutation / red proof    | revert S2, run `test:bin`, confirm the diff is non-empty before reading the result               | A mutation that silently failed to apply reports the reassuring answer    |
| TC-05 | Contract test           | same suite plus the existing `cross-fidelity.bintest.ts`                                         | Guards against fixing one fidelity by breaking the other                  |
| TC-06 | Command-form check      | `rg -c` over `packages/agent-cli/src`                                                            | Mechanically refuses a re-orphaned fixture                                |
| TC-07 | Build / type gate       | `pnpm build && pnpm typecheck`                                                                   |                                                                           |
| TC-08 | CI smoke                | `pnpm harness:scan`                                                                              |                                                                           |
| TC-09 | Command-form check      | `rg -n` over the SEC-016 record                                                                  | Keeps the corrected record from drifting back                             |

## USER-DECISION

Alternative 2 is **outside standing pre-approval** and is not taken by this item. It changes the
documented output contract of `--output-format stream-json`, which is a user-facing surface. Recorded
here as options rather than decided:

- **(a) Do nothing further.** A live denial stays invisible on stdout; a CI job gates on the session
  record after the run, not on the stream during it. Cost: zero. This is what shipping only S1+S2 means.
- **(b) Add `tool_use` / `tool_result` to `stream-json`, with the denial as the terminal state of
  `tool_result`.** Matches all three verified comparables. Cost: a new spec-doc at lane **L2** (it
  edits a SPEC trigger section), and every existing `stream-json` parser sees event types it did not
  see before — additive, but a parser written with an exhaustive switch will meet an unknown variant.
- **(c) (b) plus a denial roll-up on the final `result` object**, following Claude's
  `permission_denials` array and Gemini's `totalDecisions.reject`. Cost: (b)'s, plus one more field on
  the `result` envelope. Benefit: `jq` can fail a CI job on "anything was denied" in one line, which
  the per-event form alone does not give.
- **(d) Also adopt a documented no-live-provider rail** in the shape of Pydantic AI's
  `ALLOW_MODEL_REQUESTS=False`, so a test that accidentally reaches a real provider fails loudly.
  Independent of (a)–(c); would need its own item.

A second, smaller decision, because it is a product-direction call and not mine: **should
`--session-log` remain absent from `robota --help`?** It is accepted by
`packages/agent-cli/src/utils/cli-args.ts:208` and printed by no help section — verified by running
`robota --help` and reading its output. That is defensible for a dev-only flag and it is also the
reason issue #2225 says the route "is not discoverable from the surfaces a contributor would try".

## Tasks

- [ ] `.agents/tasks/SEC-022-demonstrate-and-wire-the-provider-free-route-to-a-pretooluse-denial-through-the-.md` — created

## Evidence Log

All runs on `develop`, tree at `a81cc85b7`, 2026-09-04, macOS, Node 22.14.0
(`/Users/jungyoun/.volta/tools/image/node/22.14.0/bin/node`). No `ANTHROPIC_API_KEY` was set in any
run; every settings file used the literal string `dummy` / `sec016-dummy-key` as the key, and
`--session-log` swaps the provider before the key is read.

**E1 — the `PreToolUse` hook fires through the real binary.** A hook script replacing SEC-016's
nonexistent path, run with the committed fixture:

```
=== hook log ===
HOOK_FIRED 1788530497
=== hook stdin ===
{"session_id":"session_01add975-7b38-45ef-808e-569d4042e263","cwd":".../run2/proj","hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"filePath":".../SEC-016-PROBE.txt"},"permission_mode":"bypassPermissions"}
```

**E2 — the denial stops the tool; the allowed run does not.** Fixture recording
`Bash{"command":"touch SEC016_TOOL_RAN"}`; `--no-session-persistence`; identical prompts:

```
########## denied ##########
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"\n\n"}},…}
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"SEC_016_TURN_COMPLETE"}},…}
{"type":"result","result":"SEC_016_TURN_COMPLETE","subtype":"success"}
-- marker present? --
########## allowed ##########
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"\n\n"}},…}
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"SEC_016_TURN_COMPLETE"}},…}
{"type":"result","result":"SEC_016_TURN_COMPLETE","subtype":"success"}
-- marker present? --
SEC016_TOOL_RAN
```

stdout is byte-identical between the two arms apart from session ids and uuids. The tool's effect is
the only difference.

**E3 — the persisted session record carries the denial, with kind and source.** Same runs with
persistence left on, using the **committed** fixture
`packages/agent-cli/src/__tests__/e2e/fixtures/sec-016-tool-call.jsonl` (the `Read` probe):

```
--- DENIED (shipped Read fixture) ---
{"blocked":true,"reason":"Hook could not evaluate (nonzero-exit, source: command): Hook exited 127: zsh:1: no such file or directory: /nonexistent/sec-016-hook."}
--- ALLOWED (shipped Read fixture) ---
{"success":true,"output":"[File: .../SEC-016-PROBE.txt (1 lines)]\n1\tSEC-016 probe MARKER_XYZ"}
```

The record is at `$HOME/.robota/sessions/<session id>.json` under `record.messages[]`, the entry with
`"role":"tool"`, `"name":"Bash"` / `"Read"`.

**E4 — stdout carries no tool event on a run whose tool executed.**

```
tool executed? (marker):
SEC016_TOOL_RAN
stdout lines mentioning 'tool': 0
distinct stdout event types:
  stream_event content_block_delta
  stream_event content_block_delta
  result
```

**E5 — the fixture is read by no test.** `grep -rn "sec-016-tool-call"` over the tracked tree
returned four hits, all in markdown:
`.agents/tasks/completed/SEC-016-…md:193,295`, `.agents/spec-docs/rejected/SEC-016-…md:361,455`.

**E6 — the bintest invocation form in TC-01 is real.** Run against the existing suite before any
change:

```
 ✓ src/__tests__/e2e/cross-fidelity.bintest.ts (1 test) 1254ms
   ✓ IAgentDriver cross-fidelity (INFRA-020 TC-04) > the same scenario observes the recorded reply via the programmatic AND binary drivers  1254ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

**E7 — the work-item id was allocated, not guessed.**

```
::measured:: HEAD is 0 commit(s) behind origin/develop@a81cc85b7
::examined:: 1685 claimed work-item id(s); 1081 from records, 1671 from citations, 383 from issue titles and bodies
SEC-022
```

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-08-28, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base 99e2ba804eb7) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/SEC-022-demonstrate-and-wire-the-provider-free-route-to-a-pretooluse-denial-through-the-.md) is at or above the floor L0)
**Review fingerprint:** 3c9eb9516ecc (review 5f1700e3, type/tags 5daa04ab)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (3c9eb9516ecc) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `99e2ba804eb7` · base `origin/develop@99e2ba804eb7` · document `.agents/spec-docs/draft/SEC-022-demonstrate-and-wire-the-provider-free-route-to-a-pretooluse-denial-through-the-.md` blob `51ca0a4e9477` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: SECURITY` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (4 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 6388 chars, 31 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 4/4 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 4 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 9 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 9 Test Plan rows = 9 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 9 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (3c9eb9516ecc) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/SEC-022-demonstrate-and-wire-the-provider-free-route-to-a-pretooluse-denial-through-the-.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/SEC-022-demonstrate-and-wire-the-provider-free-route-to-a-pretooluse-denial-through-the-.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`

**Judged at:** HEAD `99e2ba804eb7` · base `origin/develop@99e2ba804eb7` · document `.agents/spec-docs/draft/SEC-022-demonstrate-and-wire-the-provider-free-route-to-a-pretooluse-denial-through-the-.md` blob `ed5637b1d7d1` (untracked)
