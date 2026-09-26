---
'@robota-sdk/agent-transport-webrtc-web': patch
---

The browser remote client runs one warm-reconnect loop at a time. When a reconnected link drops again while the
previous loop is still waiting on a room, that older loop stops instead of moving on and tearing down the new
loop's connection.
