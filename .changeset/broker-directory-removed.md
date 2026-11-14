---
'@robota-sdk/agent-cli': patch
---

The workspace-root broker now removes its `/tmp/robota-root-*` directory when it ends because its user-state root is gone, and a start that launches a new broker removes the directories of brokers that are gone. Every user-state root used to leave a directory holding a socket and a guard file behind, so they accumulated without bound.
