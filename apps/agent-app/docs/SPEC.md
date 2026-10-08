# SPEC.md — Electron desktop host

## Purpose

The Electron desktop host is a thin desktop application (macOS / Linux / Windows) that drives a live
Robota session graphically. It is a shell only: it attaches to the workspace's runtime CLI daemon or an owner-authorized remote task, owns
the window, and loads the GUI web app (`@robota-sdk/agent-gui-web`), which it reaches only through
that package's build output.

## Contract

- All session/command/permission logic lives below the wire, in the workspace's runtime CLI daemon
  reached through an authenticated host connection. The GUI never imports `@robota-sdk/agent-framework` or
  `agent-core`, and does not own the wire protocol or session contract (owned by `agent-transport`
  / `agent-interface-transport`).
- The renderer receives only a loopback endpoint with a local nonce. Remote issuer and operator credentials stay in the main process, bound to the owner-selected HTTPS task and session; remote task paths never confer access to the local filesystem. Remote permission approval requires a native owner decision and a separate scoped operator credential, never a renderer response or model text. Invalid remote configuration refuses startup rather than selecting a local runtime.
- The transport closes any connection that does not present the correct token (constant-time compare)
  before emitting any session data, closing the otherwise-unauthenticated loopback port against a
  co-resident browser page. This contract is owned by `@robota-sdk/agent-transport-ws`.
- The renderer is hardened: context isolation, no Node integration, sandboxed, loads only local
  content, a CSP restricted to `self` plus the loopback WebSocket origin, and navigation/new-window
  lockdown — so the nonce-holding renderer cannot carry the session to an external origin.
- The daemon belongs to the workspace, not the window: closing the window leaves it running, and the
  next launch reattaches to the same daemon and its conversation. In a folder not trusted yet the window
  asks the person before any daemon starts (trust it, start Restricted, or quit), because the daemon has
  no one to ask and would be refused; whether to ask is the CLI's answer, never the shell's guess. When
  the daemon cannot be started, the window still opens and shows the CLI's reason (which names the fix)
  instead of hanging. When the daemon stops while the window is open, the window keeps the conversation
  visible and says so in a banner above it rather than sitting disconnected or hiding the conversation,
  and offers to reconnect: the shell asks the CLI again, re-points the page at whatever daemon it
  answers with, and returns to the session the person was in.

## Non-goals

- Does not auto-update itself.
- No `agent-framework`/`agent-core` dependency — the daemon owns the runtime.
- Does not supervise or stop the daemon; its lifetime is the CLI's to manage.

## Design decisions

- Packaging embeds the configured platform CLI because the window delegates workspace trust and daemon
  ownership to the CLI; a serve-only host cannot fulfill that contract. The desktop shell and bundled
  runtime report one artifact version, while the runtime retains its source version for diagnosis.
