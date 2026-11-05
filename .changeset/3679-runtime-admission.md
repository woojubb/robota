---
'@robota-sdk/agent-transport-link': minor
'@robota-sdk/agent-keyring': minor
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': patch
---

Add the runtime half of owner-link admission. Secure mode remains dormant until the product enables it.

The transport provides the spawner-pair exchange and bounded delivery of queued link frames. The CLI
uses the exchanged runtime identity to admit owner links, receives read grants without a passphrase,
locks keys when access ends, and refuses unsecured listener and control paths. The child-session spawn
paths can be held while a handed-over descriptor is consumed, and the runtime uses that hold during the
exchange.
