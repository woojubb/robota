# BEHAVIOR-005: expose token usage on the streaming execution path

- **Status:** in-progress
- **Spec:** `.agents/spec-docs/draft/BEHAVIOR-005-streaming-token-usage-exposure.md`
- **Branch:** `fix/streaming-usage-exposure`
- **Approved:** 2026-07-05 (user sign-off "좋아")

## Goal

Streaming requests send `stream_options: { include_usage: true }` (opt-out via
`includeStreamUsage`, default true); the shared OpenAI-compatible stream assembler captures the
final-chunk `usage` and attaches top-level `usage: { promptTokens, completionTokens, totalTokens }`
— the same shape the non-streaming `parseUsage` path emits — so `readTokenUsageFromMessage` and
the usage analytics work unchanged for `run()` and `runStream()`.

## Progress

- [x] Spec drafted + approved (GATE-WRITE, GATE-APPROVAL PASS).
- [x] SPEC-first: updated `packages/agent-provider/docs/SPEC.md` (Streaming Token Usage).
- [x] TDD: assembler + request-builder + runStream regression tests (red → green).
- [x] Live UE: bug-report reproduction stub shows usage populated for run()/runStream().
- [ ] PR → develop, CI green, merge.

## Test Plan

Full detail (TC-01…TC-06) lives in the spec-doc
`.agents/spec-docs/draft/BEHAVIOR-005-streaming-token-usage-exposure.md`. Summary:

- **Unit (agent-provider):** `stream-assembler.test.ts` asserts the assembler captures the
  final empty-choices `usage` chunk (and ignores `usage: null`); `provider.test.ts` asserts the
  streaming request carries `stream_options: { include_usage: true }`, the `includeStreamUsage:
false` opt-out omits it, the non-streaming request omits it, and the assembled message carries
  `usage`.
- **Integration (agent-core):** `robota.test.ts` drives `runStream` over a fake `chatStream`
  ending in a usage chunk and asserts the committed assistant message metadata carries
  `inputTokens`/`outputTokens`/`usage`.
- **Live UE:** local OpenAI-compatible HTTP stub (no key) — `run()` and `runStream()` both yield
  `readTokenUsageFromMessage = { inputTokens: 123, outputTokens: 45 }`.
