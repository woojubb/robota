# SPEC.md — @robota-sdk/agent-app

## Purpose

`agent-app` is a thin Electron desktop application (macOS / Linux / Windows) that drives a live
`robota` session graphically. It is a shell only: it attaches to the workspace's `robota` daemon, owns
the window, and loads the GUI web app (`@robota-sdk/agent-gui-web`), which it reaches only through
that package's build output.

## Contract

- All session/command/permission logic lives below the wire, in the workspace's `robota` daemon
  reached over a loopback WebSocket. The GUI never imports `@robota-sdk/agent-framework` or
  `agent-core`, and does not own the wire protocol or session contract (owned by `agent-transport`
  / `agent-interface-transport`).
- The shell never mints or places a secret itself: the CLI starts the daemon (or reuses the live one)
  and answers with its loopback address and token, which the shell hands only to its own renderer. An
  answer that is not a loopback address with a token is refused rather than followed.
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

- Packaging copies a manifest-verified, OS/architecture-specific headless CLI build to a fixed
  `resources/robota` path rather than bundling the full CLI release, keeping the shipped binary
  minimal and reproducible per platform.
