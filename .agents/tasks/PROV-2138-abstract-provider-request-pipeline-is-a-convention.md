---
title: 'PROV-2138: the abstract provider request pipeline is a convention, not a seam — three providers skip validateTools, so any per-request step must be remembered at every site'
issue: https://github.com/woojubb/robota/issues/2138
status: todo
created: 2026-09-22
priority: medium
urgency: later
area: agent-core provider abstraction
depends_on: []
---

# PROV-2138: the abstract provider request pipeline is a convention, not a seam

## Objective

`AbstractAIProvider` declares `chat`/`chatStream` abstract (`packages/agent-core/src/abstracts/abstract-ai-provider.ts:117,153`)
and offers `validateTools` as a helper the concrete provider must remember to call — and Anthropic, Gemini
and OpenAI do not call it (only deepseek `:227` and qwen `:109,186,254` do). MCP-005 adds a second such helper
(`projectTools`) and guards it with a grep test (TC-13) because the base cannot enforce it. Found by
`proposal-reviewer` on MCP-005 (2026-09-22); filed under umbrella issue #2138 rather than folded in, because
the fix is a template-method base owning validate → project → delegate (and absorbing today's duplicated
executor branch), which changes every provider's shape.

## Plan

- [ ] Decide the template-method shape under #2138: the base owns `chat`/`chatStream` and calls protected `validateTools` → `projectTools` → abstract `sendRequest`/`streamRequest`.
- [ ] Migrate the six request-building sites MCP-005 enumerated; delete the per-provider helper calls and the TC-13 grep guard once the base enforces the order.
- [ ] Add a test proving a provider that overrides only the abstract request method still gets validation and projection.

## Test Plan

Unit test over a minimal subclass; the six provider suites stay green.

## User Execution Test Scenarios

Not user-facing; verification is the unit suite above.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`
