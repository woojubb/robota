---
'@robota-sdk/agent-roundtable': patch
---

A restart no longer refuses a conversation whose host already answered a reconciliation request. When recovery finds the effect still without a journaled result and the request already answered, the member continues with the committed response instead of parking the same request again, which the conversation rejected as already used.
