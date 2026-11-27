---
'@robota-sdk/agent-roundtable': minor
---

`TurnServices` gains `admitToolEffect({ callId, toolName, tokens })`, so a participant can declare a paid tool effect before it starts and have it admitted against the conversation budget. A tool effect is recorded as a ledger record of `kind: 'tool-effect'` (provider `'tool'`, the tool name as the model, a bound with no output), is settled and reconciled like a model call, and never counts against a model-call limit. Every `UsageRecord` now carries a `kind`; `PricePolicy.bound` and `UsageEstimator.estimate` receive it, and `UsageSummary` gains `toolEffects` while its call counters count model calls only. Custom `TurnServices` implementations must add `admitToolEffect`.
