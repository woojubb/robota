---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-cli': patch
---

Serialize cooperating session record mutations and marker transitions with a crash-released per-session operation lock. Marker construction now requires a host lock, and hosts must stop older writers before sharing their session directory with the new version. Forced release does not stop a running writer or its children.
