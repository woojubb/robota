---
'@robota-sdk/agent-ui-terminal': minor
---

The terminal UI classifies the new `history_rewritten` session event as not its own: the CLI never rewrites its conversation, and a remote terminal UI already reloads on `history_changed`.
