---
'@robota-sdk/agent-core': patch
---

A call to a registered tool the session hides from the model (denied outright, or outside its allowed set) is answered as not allowed in this session, naming the tools it does offer, instead of reaching the permission gate, whose refusal read as the person having declined. A deferred tool the session denies is no longer offered for loading.
