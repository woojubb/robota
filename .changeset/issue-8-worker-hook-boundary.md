---
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-subagent-runner': patch
---

Pass the child execution root and restored sandbox to hook composition. The stock CLI explicitly refuses command and HTTP hooks for separate task workers whose hook capabilities are unavailable, instead of executing those hooks on the host.
