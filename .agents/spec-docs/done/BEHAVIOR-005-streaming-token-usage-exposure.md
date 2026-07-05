---
status: done
type: BEHAVIOR
tags: [streaming, async, typescript]
---

# BEHAVIOR-005: expose token usage on the streaming execution path

## Problem

Token usage is silently lost on the streaming execution path, so after any
`Robota.run()` / `Robota.runStream()` a consumer cannot read the turn's token usage —
`readTokenUsageFromMessage(lastHistoryMessage)` returns `undefined`, and robota's own
usage analytics (`collectAssistantUsageMetadata` → `execution-round.ts` →
`assistant_message_committed` event → `sumHistoryUsage`, ANALYTICS-001) sum to 0 for
streaming turns.

Reproduction (local OpenAI-compatible HTTP stub, no key needed — full script in
`.design/bug-report-streaming-usage-2026-07-05.md`): a stub that returns a final SSE
chunk carrying `usage: { prompt_tokens, completion_tokens, total_tokens }` still yields
`readTokenUsageFromMessage(last) === undefined`, and the assembled assistant message
metadata contains only `executionId` — no usage.

Root causes (source-confirmed):

1. **`stream_options: { include_usage: true }` is never sent.**
   `buildChatRequestParams` (`packages/agent-provider/src/openai/chat-completions-chat.ts:121`)
   emits no `stream_options`; `grep -rn 'include_usage|stream_options' packages/*/src` = 0.
   OpenAI-compatible endpoints do not emit a usage chunk on streams without it.
2. **The stream assembler drops final-chunk usage.**
   `assembleOpenAICompatibleStream` / `applyChunk` / `buildMessage`
   (`packages/agent-provider/src/shared/openai-compatible/stream-assembler.ts:27,48,158`)
   never read `chunk.usage`. `applyChunk` also early-returns on the empty-`choices` final
   chunk (L57–60) that actually carries usage. So even when the endpoint sends usage, it is
   discarded during assembly.
3. **Premise correction to the bug report — there is no `IRunOptions.stream` flag.**
   The report's proposal #3 ("`stream: false` is ignored") targets a field that does not
   exist: `IRunOptions` (`packages/agent-core/src/interfaces/agent.ts:190`) has no `stream`
   boolean (the cited L114 is JSDoc prose). `run()` uses the round path
   (`execution-round-provider.ts:callProviderWithCache` → `provider.chat` with a wrapped
   `onTextDelta` → the streaming-assembly branch), so it always streams; there is nothing to
   "respect". No new dispatch option is added.
4. **`runStream()` uses a SEPARATE path that reconstructs the message and never collected usage.**
   (Discovered during implementation — corrects the initial "agent-core needs no change" reading.)
   `run()` (round path) collects usage at `execution-round.ts:193`
   (`collectAssistantUsageMetadata(assistantResponse)`) → commits it into the assistant
   message metadata, so once (1)+(2) make the assembled message carry `usage`, `run()` works.
   But `runStream()` goes through `execution-stream.ts`, which iterates `provider.chatStream`
   and commits the assistant message from the accumulated `fullResponse` **string** +
   `toolCalls` (`execution-stream.ts:248` `addAssistantMessage(fullResponse, toolCalls,
{ executionId })`) — the provider message object and its `usage` are discarded, and
   `collectAssistantUsageMetadata` is never called. So `runStream()` needs a third change:
   capture the usage-bearing final chunk in that loop and attach the usage metadata at commit,
   mirroring the round path.

## Architecture Review

### Affected Scope

- `packages/agent-provider` — the only package with behavior changes:
  - `src/openai/chat-completions-chat.ts` — add `stream_options: { include_usage: true }` to
    the two streaming request literals (L38–40, L79–82), gated by the opt-out option.
  - `src/openai/types.ts` — add opt-out `IOpenAIProviderOptions.includeStreamUsage?: boolean`
    (default `true`), read via `input.providerOptions` at the request-build site.
  - `src/shared/openai-compatible/stream-assembler.ts` — capture `chunk.usage` (incl. the
    empty-`choices` final chunk) into `IAssemblyState`; attach top-level
    `usage: { promptTokens, completionTokens, totalTokens }` in `buildMessage`.
  - `src/shared/openai-compatible/response-parser.ts` — `parseStreamingChunk` (L102) attaches
    the same `usage` shape for the `chatStream` generator path (parity).
  - `docs/SPEC.md` — SPEC update (behavior + new provider option).
- `packages/agent-core` — the `runStream` path needs the usage collected into the committed
  message (the round path already does this; readers are unchanged):
  - `src/services/execution-stream.ts` — in the `chatStream` consumption loop, capture the
    usage-bearing chunk via `collectAssistantUsageMetadata(chunk)` and spread it into the
    `addAssistantMessage(fullResponse, toolCalls, { executionId, ...usageMetadata })` commit —
    mirroring `execution-round.ts:193`/`209`.
  - `src/core/robota.test.ts` — regression test: a `chatStream` ending in a usage chunk →
    committed assistant message metadata carries `inputTokens`/`outputTokens`/`usage`.
  - Readers `readTokenUsageFromMessage` / `collectAssistantUsageMetadata` are **unchanged** —
    they already accept the top-level `usage: { promptTokens, completionTokens, totalTokens }`
    shape the non-streaming `parseUsage` produces; the fix makes streaming emit that shape and
    routes it into the committed metadata on both execution paths.

### Alternatives Considered

1. **Send `include_usage` + assemble the usage chunk (chosen).** Mirror the non-streaming
   `parseUsage` shape as a top-level `usage` on the assembled message. Pro: zero changes to
   agent-core readers/analytics; one coherent shape across streaming + non-streaming; fixes
   `run()` and `runStream()` together. Con: `stream_options` is unsupported by a few
   OpenAI-compatible servers → mitigated by the `includeStreamUsage` opt-out (default on).
2. **Add a real `IRunOptions.stream: false` and route it to a non-streaming `provider.chat`.**
   Pro: matches the bug report's literal proposal #3. Con: the option does not exist today
   (scope creep — a new public API + a second dispatch path in the round service), and is
   **unnecessary**: (1)+(2) already fix usage for the always-streaming `run()`. Rejected as
   out-of-scope feature work; may be a separate future item.
3. **Expose usage via a side channel (return metadata / callback) instead of on the message.**
   Pro: avoids touching the assembler shape. Con: duplicates the usage contract, diverges from
   the non-streaming path, and strands the existing `readTokenUsageFromMessage` /
   `metadata.usage` readers. Rejected.

### Decision

Alternative 1. Send `stream_options: { include_usage: true }` on OpenAI-compatible streaming
requests (opt-out via `includeStreamUsage`, default `true`), and make the shared stream
assembler capture the final-chunk `usage` and attach top-level
`usage: { promptTokens, completionTokens, totalTokens }` — byte-for-byte the shape
`response-parser.ts:parseUsage` already emits on the non-streaming path.

**Validation (wide blast radius — streaming is the default execution path):**

- **Reachability** — every usage consumer reads the message/metadata, not a provider-specific
  field: `readTokenUsageFromMessage` (top-level `usage` or `metadata.usage`),
  `collectAssistantUsageMetadata` (execution-round.ts:193), `sumHistoryUsage`. Producing the
  existing top-level `usage` shape reaches all of them with no reader edits (confirmed by
  reading `context/token-usage.ts` + `services/execution-usage.ts`).
- **Capability preservation** — the non-streaming path's usage capability (`parseChoice` +
  `parseUsage`) is preserved and mirrored, not replaced; both paths converge on one shape.
- **Adversarial pass** — (a) servers rejecting `stream_options` → opt-out flag, default on;
  (b) final usage chunk has `choices: []` and would hit the assembler's early return → the fix
  reads `chunk.usage` before that return; (c) providers that never send usage → `usage` stays
  absent (readers already treat absence as "no usage", unchanged from today); (d) tool-call
  streams → usage chunk is independent of choices, captured the same way.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — non-streaming path (`response-parser.ts` `parseChoice`/`parseUsage`) is the sibling; the fix mirrors its exact usage shape
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. `chat-completions-chat.ts`: when building a streaming request (both the `onTextDelta`
   assembly branch and the `chatStream` generator branch), include
   `stream_options: { include_usage: true }` unless `input.providerOptions.includeStreamUsage`
   is `false`. Never send it on the non-streaming `create`.
2. `types.ts`: add `includeStreamUsage?: boolean` to `IOpenAIProviderOptions` (documented
   default `true`).
3. `stream-assembler.ts`: add `usage?: { promptTokens; completionTokens; totalTokens }` to
   `IAssemblyState`; in `applyChunk`, map `chunk.usage` (`prompt_tokens`/`completion_tokens`/
   `total_tokens`) before the empty-choices early return; in `buildMessage`, attach it as a
   top-level `usage` on the returned `TUniversalMessage`.
4. `response-parser.ts`: `parseStreamingChunk` attaches the same `usage` shape when a chunk
   carries `usage` — for the `chatStream` generator, the final usage chunk (empty `choices`)
   becomes a usage-only assistant message instead of being dropped (chatStream parity, and the
   channel `runStream` consumes).
5. `execution-stream.ts` (agent-core): in the `chatStream` loop, capture the usage-bearing chunk
   via `collectAssistantUsageMetadata(chunk)` and spread it into the `addAssistantMessage(...)`
   commit metadata — so the `runStream` committed message exposes usage like the round path.

## Affected Files

- `packages/agent-provider/src/openai/chat-completions-chat.ts`
- `packages/agent-provider/src/openai/types.ts`
- `packages/agent-provider/src/shared/openai-compatible/stream-assembler.ts`
- `packages/agent-provider/src/shared/openai-compatible/response-parser.ts`
- `packages/agent-provider/src/shared/openai-compatible/stream-assembler.test.ts` (tests)
- `packages/agent-provider/src/openai/provider.test.ts` (tests)
- `packages/agent-provider/docs/SPEC.md` (SPEC update)
- `packages/agent-core/src/services/execution-stream.ts` (runStream usage collection)
- `packages/agent-core/src/core/robota.test.ts` (runStream usage regression test)

## Completion Criteria

- [x] TC-01: A streaming `provider.chat(messages, { onTextDelta })` call invokes the OpenAI
      client `create` with `stream: true` AND `stream_options: { include_usage: true }`
      (provider test `toHaveBeenCalledWith(expect.objectContaining({ stream_options: { include_usage: true } }))`).
- [x] TC-02: With `new OpenAIProvider({ …, includeStreamUsage: false })`, the streaming
      `create` call omits `stream_options` (provider test asserts absence).
- [x] TC-03: `assembleOpenAICompatibleStream` over a stream ending in a `choices: []` chunk
      with `usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 }` returns
      `result.usage` deep-equal to `{ promptTokens: 123, completionTokens: 45, totalTokens: 168 }`
      (assembler unit test).
- [x] TC-04: End-to-end reproduction (local OpenAI-compatible stub, no key): after
      `for await (…) of agent.runStream('hi')`, `readTokenUsageFromMessage(getHistory().at(-1))`
      returns `{ inputTokens: 123, outputTokens: 45, totalTokens: 168 }` (integration test /
      scratch script exits 0 with usage populated).
- [x] TC-05: The non-streaming `create` (no `onTextDelta`) is NOT called with `stream_options`
      (regression: option only on streaming requests).
- [x] TC-06: `runStream()` over a `provider.chatStream` ending in a usage chunk commits an
      assistant message whose metadata carries `inputTokens: 123`, `outputTokens: 45`, and
      `usage: { totalTokens: 168, inputTokens: 123, outputTokens: 45 }` (agent-core
      `robota.test.ts` integration test).

## Test Plan

BEHAVIOR + streaming → stream output integration test; supporting unit tests for the assembler
and request builder.

| TC-ID | Test Type            | Tool / Approach                                                                                                                             | Notes |
| ----- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| TC-01 | Unit (request build) | vitest — `provider.test.ts`, mock `client.chat.completions.create`, assert args                                                             |       |
| TC-02 | Unit (request build) | vitest — provider constructed with `includeStreamUsage:false`, assert no `stream_options`                                                   |       |
| TC-03 | Unit (assembler)     | vitest — `stream-assembler.test.ts`, feed empty-choices usage chunk, assert `result.usage`                                                  |       |
| TC-04 | Integration (stream) | vitest — in-memory async-generator stream through `provider.chat`, assert assembled `usage`; the doc's HTTP-stub repro re-run as scratch UE |       |
| TC-05 | Unit (request build) | vitest — non-streaming `create` args exclude `stream_options`                                                                               |       |
| TC-06 | Integration (stream) | vitest — `robota.test.ts`, `runStream` over a fake `chatStream` with a usage chunk, assert committed metadata usage                         |       |

## Tasks

- [x] `.agents/tasks/BEHAVIOR-005.md` — created at GATE-APPROVAL.

## Evidence Log

- **GATE-WRITE — PASS (2026-07-05).** All required sections present; TC-01…TC-05 carry TC-N
  prefixes with command/observable forms; Architecture Review checklist all `[x]`; Test Plan has
  a row per TC; no `manual` rows. Premise correction (no `IRunOptions.stream`) documented in
  Problem/Decision.
- **GATE-APPROVAL — PASS (2026-07-05).** Design + scope presented (Paths 1+2; corrected report
  Path 3; `include_usage` default-on with `includeStreamUsage` opt-out; assembler attaches the
  non-streaming `parseUsage` shape). User sign-off, verbatim: **"좋아"**. Implementation authorized.
- **SPEC CORRECTION during implement (2026-07-05).** The approved scope claimed "agent-core needs
  no change". While verifying the live UE, the `runStream` E2E returned `undefined` — the `runStream`
  path (`execution-stream.ts`, via `provider.chatStream`) commits from the accumulated string and
  never called `collectAssistantUsageMetadata`. Corrected the spec (Problem cause #4, Affected Scope,
  Solution #5, Affected Files, TC-06) and added the `execution-stream.ts` collection + parseStreaming
  chunk usage-only-message handling. `run()` (round path) already worked with the provider-only fix.
- **GATE-VERIFY — PASS (2026-07-05).**
  - TC-01…TC-05 (agent-provider): full suite green — `stream-assembler.test.ts` (usage captured /
    absent / null-ignored), `provider.test.ts` (stream_options sent / opt-out omits / non-streaming
    omits / assembled usage). agent-provider **580 tests pass**, typecheck + lint (0 errors) clean.
  - TC-06 (agent-core): `robota.test.ts` runStream usage regression green; agent-core **839 tests
    pass** (840 with the new test), typecheck clean, 0 lint errors.
  - TC-04 live UE (local OpenAI-compatible HTTP stub, no key, source build): endpoint received
    `stream_options: { include_usage: true }`; `run()` → `readTokenUsageFromMessage = { inputTokens:
123, outputTokens: 45 }`; `runStream()` committed metadata `{ inputTokens:123, outputTokens:45,
usage:{ totalTokens:168, inputTokens:123, outputTokens:45 } }` and `readTokenUsageFromMessage =
{ inputTokens:123, outputTokens:45 }`.
- **GATE-COMPLETE — PASS (2026-07-05).** Merged to `develop` via **PR #969** (squash `6f308d10`);
  SPEC (`packages/agent-provider/docs/SPEC.md` Streaming Token Usage) + changeset
  (`.changeset/fix-streaming-token-usage.md`, agent-core/agent-provider patch) landed. CI green
  (the single `tui-e2e` failure was an unrelated pre-existing teardown flake — `rmSync` `ENOTEMPTY`
  race; passed on a zero-change re-run; tracked separately as **INFRA-026**). Spec-doc promoted
  `draft/ → done/`; task archived to `.agents/tasks/completed/`.
