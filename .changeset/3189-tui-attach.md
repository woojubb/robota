---
'@robota-sdk/agent-ui-terminal': minor
'@robota-sdk/agent-cli': minor
---

`robota --attach` puts the full terminal UI on this workspace's running daemon.

- **`agent-ui-terminal`:**
  - `renderAttachedApp` renders the same App over a wire connection, through `WireTuiChannel`, a second implementation of the TUI's channel port.
  - Leaving detaches; the daemon keeps running.
  - The session picker lists and switches the daemon's sessions. It opens on the daemon's answer to `/resume`; a daemon that cannot list its sessions says why instead.
  - With no saved sessions to resume, `/resume` says so and keeps the prompt, instead of opening an empty picker that blocks input. This applies to the in-process TUI too.
  - The session picker lists an unnamed session by the part of its id that differs, not by the `session_` prefix every id shares. This applies to the in-process TUI too.
  - The status bar names the daemon's current session: its name, or else its short id.
  - A question already open when the terminal attaches is shown, and a long session's history reaches the terminal without the daemon cutting it off.
  - Features that belong to the runtime process say they are unavailable while attached: the plugin manager, background task details and sending to an agent job.
- **`agent-cli`:**
  - `robota --attach` finds the workspace daemon and asks the user to confirm on the terminal, as `robota session attach` does, then attaches.
  - Options that shape a session are refused, because the daemon shapes its session.
  - A terminal attached over the supervised socket can now list, start and switch sessions.
  - A client's command no longer stops or restarts the workspace daemon. `/language`, `/reset`, `/exit` and provider setup or switch keep their saved change, and the client is told to run `robota daemon stop`, then `robota daemon start`.
  - `robota --attach` installs the plain TUI's process guards, so an error the plain TUI survives no longer ends the attached terminal.
  - A client's command no longer stops or restarts any supervised session either; the client is told to run `robota session stop <id>`, and the saved change applies to a new session from `robota session start --background`.
