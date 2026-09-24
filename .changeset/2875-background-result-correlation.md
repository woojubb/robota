---
'@robota-sdk/agent-executor': patch
'@robota-sdk/agent-session': patch
---

Reject background runner results whose task ID or kind differs from the task being completed, and report the same mismatch as corruption when decoding a persisted session record.
