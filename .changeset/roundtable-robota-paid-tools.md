---
'@robota-sdk/agent-roundtable-robota': minor
---

An `enforcement` declaration accepts `paidTools`, a record from tool name to the most tokens one effect may consume (`0` for a tool that only spends money). A paid tool effect is admitted against the conversation budget before it starts, with the journal's action id as its call id, and a rejection (the budget, or a cost budget with no price for it) keeps the effect from running; a denied approval charges nothing. At the tool result a money-only effect settles as `reported` with zero tokens and a model-backed one as `unknown` and not final, so its bound stays counted until the host reconciles it. A tool declared both free and paid, or a bound that is not a non-negative safe integer, is refused with `invalid-config`.
