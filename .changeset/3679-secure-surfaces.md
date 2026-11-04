---
'@robota-sdk/agent-cli': patch
---

Every listener the CLI opens now opens through one gate that reads its row in a single table of what
each surface may be in secure mode: the control socket, the WebSocket transport, the served HTTP API
and browser monitor, MCP over HTTP, external events, the hosted serve relay, local peers, remote
control, the device mesh and device linking, and the OAuth sign-in callbacks. Nothing changes while
secure mode is off, which it is everywhere until it can be turned on: every listener binds the same
address and port and admits the same clients as before.

What to do: nothing.
