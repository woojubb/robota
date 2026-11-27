---
'@robota-sdk/agent-roundtable': minor
---

A usage record can now be stored with the outcome `not-dispatched`, written only by recovery for a call it proved never reached the provider: it charges nothing, so exactly what admission set aside is released, while the call still counts against call limits. `CallSettlement` (`not-dispatched`, `settled` with the journal's final report, or `uncertain`, which keeps the bound counted) is applied once per reserved call, for the principal and attempt it belongs to; an answer naming a call that is already settled, by recovery or by a report, is refused with the new `call-settled` error. `UsageSummary` gains `notDispatchedCalls`, and `UsageRecord.outcome` is typed `StoredUsageOutcome`; a participant still cannot report `not-dispatched`.
