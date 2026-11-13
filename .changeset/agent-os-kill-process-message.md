---
"@robota-sdk/agent-os": patch
---

The error `killProcessTree` throws for a child that never spawned no longer carries the retired `[agent-process]` prefix and now reads as a plain sentence naming the helper and the missing pid.
