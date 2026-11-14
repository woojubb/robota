---
'@robota-sdk/agent-transport': patch
---

`WsTransport` reports the port it actually bound, so a host can ask for `port: 0` (any free port) and hand its client a reachable URL.
