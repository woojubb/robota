---
'@robota-sdk/agent-cli': patch
---

The CLI's hand-off receiver keeps a received session in memory instead of in a file under the state
root once its session stores seal (secure conversation, not switched on yet). The copy it holds is
zero-filled once the session is decoded, or as soon as the transfer fails, even after the payload was
verified; that is best effort, since the decoded text and any copy the runtime makes cannot be wiped.
