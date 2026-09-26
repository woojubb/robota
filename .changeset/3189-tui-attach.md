---
'@robota-sdk/agent-ui-terminal': minor
'@robota-sdk/agent-cli': minor
---

`robota --attach` puts the full terminal UI on this workspace's running daemon.

- **`agent-ui-terminal`:**
  - `renderAttachedApp` renders the same App over a wire connection, through `WireTuiChannel`, a second implementation of the TUI's channel port.
  - Leaving detaches; the daemon keeps running.
  - The session picker lists and switches the daemon's sessions.
  - Features that belong to the runtime process say they are unavailable while attached: the plugin manager, background task details and sending to an agent job.
- **`agent-cli`:**
  - `robota --attach` finds the workspace daemon and asks the user to confirm on the terminal, as `robota session attach` does, then attaches.
  - Options that shape a session are refused, because the daemon shapes its session.
  - A terminal attached over the supervised socket can now list, start and switch sessions.
