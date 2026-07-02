---
title: 'DOCS-014: adoption-path docs — gateway quickstart, decision-agent pattern, execution/history contracts, agent-testing positioning'
status: todo
created: 2026-07-03
priority: medium
urgency: soon
area: content/, packages/agent-core/docs, packages/agent-testing/docs
depends_on: []
---

# Adoption-path documentation

External adoption feedback (speech project, `.design/feedback-speech-adoption-2026-07-03.md`
§3.6–3.7, §5): the fastest answers came from `.d.ts` files and `robota.test.ts`, not the docs. The
reporter's verdict: "기능 추가보다 이 네 가지의 계약 명문화가 다음 도입자의 경험을 가장 크게 바꿀 것" —
the four real-world pitfalls they hit were all discoverable only by reading source.

## What

Quickstarts (content/ guide pages with runnable snippets):

1. **OpenAI-compatible gateway usage** — `baseURL` + non-OpenAI model slugs (their AI Gateway +
   `anthropic/claude-*` setup worked first try but is documented nowhere).
2. **Decision-agent pattern** — tool-call-as-answer with the execute-callback extraction technique,
   stated as an intended pattern (or superseded by CORE-011's terminal tool once that lands).

Contract documentation (JSDoc + package SPEC + guide, one owner each):

3. **`maxExecutionRounds` semantics** — what a "round" is (model/tool cycles; the reporter first
   guessed `maxToolRounds`).
4. **Concurrency contract** of `run()`/`runStream` (pairs with CORE-012 — whichever lands first
   documents the actual behavior).
5. **History lifetime & cost** — history accumulates and is sent every call; `clearHistory()` +
   CORE-010 re-injection; `retainHistory` once CORE-014 lands.
6. **`destroy()` failure contract** (pairs with CORE-013).

Positioning:

7. **`@robota-sdk/agent-testing` README** — what layer it tests (PTY/real-binary E2E harness), when
   to use it vs hand-rolled fakes; the reporter could not tell from the current README.

## Test Plan

- Docs-only: snippets compile/run (doc-test or example script), `pnpm docs:build` green,
  three-doc-layer sync respected (no drift between JSDoc/SPEC/content).

## User Execution Test Scenarios

- Prereq: a fresh consumer following only the new gateway quickstart.
- Steps: set up baseURL + non-OpenAI slug per the doc; run the snippet.
- Expected: first-try streaming + tool call success without reading source.
- Evidence: _to fill at implementation._
