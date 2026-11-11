# SPEC.md — Electron desktop host

## Purpose

The Electron desktop host is a thin desktop application (macOS / Linux / Windows) that drives a live
Robota session graphically. It is a shell only: it attaches to the workspace's runtime CLI daemon, a
natively unlocked secure session or an owner-authorized remote task, owns the window, and loads the GUI
web app (`@robota-sdk/agent-gui-web`), which it reaches only through that package's build output.

## Contract

- All session/command/permission logic lives below the wire, in the workspace's runtime CLI daemon
  reached through an authenticated host connection. The GUI never imports `@robota-sdk/agent-framework` or
  `agent-core`, and does not own the wire protocol or session contract (owned by `agent-transport`
  / `agent-interface/transport`).
- The renderer receives only a loopback endpoint with a local nonce, and in a secure conversation no endpoint at all. Remote issuer and operator credentials stay in the main process, bound to the owner-selected HTTPS task and session; remote task paths never confer access to the local filesystem. Remote permission approval requires a native owner decision and a separate scoped operator credential, never a renderer response or model text. Invalid remote configuration refuses startup rather than selecting a local runtime.
- The transport closes any connection that does not present the correct token (constant-time compare)
  before emitting any session data, closing the otherwise-unauthenticated loopback port against a
  co-resident browser page. This contract is owned by `@robota-sdk/agent-transport/ws`.
- A secure conversation starts no plain daemon and exposes no socket. The passphrase or recovery key is
  typed only into an isolated, product-owned native window, never into the renderer; the shell proves or
  starts the folder's certified runtime and hands the page one message-port relay of that session. Only a
  native dialog decides folder trust or accepts an imported conversation. Closing or reloading the window,
  screen lock, suspend and quit lock the session, and while a lock is unconfirmed the app refuses to unlock,
  close or quit. It runs on macOS only; elsewhere the window refuses and points to the secure CLI.
- The renderer is hardened: context isolation, no Node integration, sandboxed, loads only local
  content, a CSP restricted to `self` plus the loopback WebSocket origin, and navigation/new-window
  lockdown — so the nonce-holding renderer cannot carry the session to an external origin.
- The packaged app can be neither borrowed to run another program's code nor driven from outside: no Node
  entry point, app code only from its asar (integrity-checked on macOS and Windows; on Linux the AppImage or deb
  install is not writable by the user, which is what keeps the asar unaltered), and no remote debugging (no fuse
  covers it, so the app refuses to start when asked for it), because a program of the same OS user must not reach
  the main process that holds the remote credentials. A development launch keeps these doors open, since tests drive it through them.
- The daemon belongs to the folder the person opened, not to the window or to the folder the app
  process happened to start in: every CLI run happens in that folder, closing the window or switching
  folders leaves its daemon running, and reopening the folder reattaches to the same daemon and its
  conversation. In a folder not trusted yet the window
  asks the person before any daemon starts (trust it, start Restricted, or quit), because the daemon has
  no one to ask and would be refused; whether to ask is the CLI's answer, never the shell's guess. When
  the daemon cannot be started, the window still opens and shows the CLI's reason (which names the fix)
  instead of hanging. When the daemon stops while the window is open, the window keeps the conversation
  visible and says so in a banner above it rather than sitting disconnected or hiding the conversation,
  and offers to reconnect: the shell asks the CLI again, re-points the page at whatever daemon it
  answers with, and returns to the session the person was in.

## Non-goals

- Does not auto-update itself.
- No `agent-framework`/`agent-core` runtime dependency — the daemon owns the runtime.
- Does not supervise or stop the daemon; its lifetime is the CLI's to manage.

## Design decisions

- Packaging embeds the configured platform CLI because the window delegates workspace trust and daemon
  ownership to the CLI; a serve-only host cannot fulfill that contract. The desktop shell and bundled
  runtime report one artifact version, while the runtime retains its source version for diagnosis.
