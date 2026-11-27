---
'@robota-sdk/agent-roundtable': minor
---

A roundtable can carry a token or cost `budget` that covers the whole conversation and is saved with it. A call is admitted only while the `bound` it declares (`{ inputTokens, maxOutputTokens }`) fits beside what is already spent or reserved, a call that was never fully reported keeps its bound counted, and a spent budget ends the run `limited` with reason `'budget'` and rejects admission with the new `budget-limit` error. A host settles such a call with `reconcileUsage`, which a participant cannot reach. Every agent factory and the selector must declare `modelCalls` as `'none'` or the new `'enforced'`; an `estimated` budget takes an `estimator` for calls that declare no bound. The stored conversation schema gains the budget and each usage record's reservation, so conversations saved by earlier versions cannot be loaded.
