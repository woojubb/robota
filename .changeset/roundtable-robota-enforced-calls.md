---
'@robota-sdk/agent-roundtable-robota': minor
---

`sessionParticipant`, `runtimeParticipant`, `runtimeSelector` and `meterJournal` accept an `enforcement` declaration (`providerAttempts`, `requestOverheadTokens`, `freeTools`). With it a participant declares `'enforced'` model calls and a budgeted conversation admits it: every call is admitted with a bound taken from the request about to be sent, and a call whose bound cannot be established (no positive output cap, a non-text part, hosted web tools, automatic compaction, an undeclared tool) is refused with `RuntimeParticipantError('unbounded-call')` before it is sent. Without it a participant stays `'metered'`.
