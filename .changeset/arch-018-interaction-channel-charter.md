---
'@robota-sdk/agent-transport-tui': major
---

Stop presenting `TuiInteractionChannel` as an `IInteractionChannel`: the TUI owns its session and
subscribes to the full session-event surface, so its unused no-op `write()` method is removed.
