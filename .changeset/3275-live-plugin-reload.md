---
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-command': patch
---

Reloading plugins updates the live session's skill routing and model skill catalogue together
with command completion. Disabled plugins stop being executable after reload, and unreadable
settings clear the plugin skill snapshot. Hook changes require a new session.
