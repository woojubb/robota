---
'@robota-sdk/agent-framework': patch
---

The system prompt no longer names a tool the session denies outright (by `deniedTools` or a bare `deny` rule). The model is never offered such a tool, so describing it only invited calls that were refused.
