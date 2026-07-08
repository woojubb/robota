---
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-session': patch
---

Fix: an in-flight autonomous `goal` is no longer lost on session resume. `fromSessionRecord` was a hand-enumerated field whitelist that omitted `goal` (while the write path persisted it), so the goal silently vanished on load. The read path is now a structural mirror of the write path (`{ ...session }`), so every persisted field — including `goal` — round-trips, and a future field cannot be dropped by omission (ARL-08 / DATA-006). `ISessionRecord` gains an opaque `goal?: unknown` for contract honesty.
