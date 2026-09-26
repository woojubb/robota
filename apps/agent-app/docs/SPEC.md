# SPEC.md — @robota-sdk/agent-app

## Purpose

`agent-app` is a thin Electron desktop application (macOS / Linux / Windows) that drives a live
`robota` session graphically. It is a shell only: it runs the sidecar, owns the window, and loads the
GUI web app (`@robota-sdk/agent-gui-web`), which it reaches only through that package's build output.

## Contract

- All session/command/permission logic lives below the wire, in a spawned `robota` sidecar process
  reached over a loopback WebSocket. The GUI never imports `@robota-sdk/agent-framework` or
  `agent-core`, and does not own the wire protocol or session contract (owned by `agent-transport`
  / `agent-interface-transport`).
- The shell mints a per-launch 256-bit nonce and a free loopback port, and passes them to the sidecar
  only via the child environment — never on argv, which is world-readable.
- The transport closes any connection that does not present the correct token (constant-time compare)
  before emitting any session data, closing the otherwise-unauthenticated loopback port against a
  co-resident browser page. This contract is owned by `@robota-sdk/agent-transport-ws`.
- The renderer is hardened: context isolation, no Node integration, sandboxed, loads only local
  content, a CSP restricted to `self` plus the loopback WebSocket origin, and navigation/new-window
  lockdown — so the nonce-holding renderer cannot carry the session to an external origin.
- Closing the window shuts down the sidecar cleanly (no orphaned `robota` process); if the sidecar
  dies externally, the UI reaches a non-hanging fatal state rather than hanging silently.

## Non-goals

- Does not own packaging/signing (installers, code-signing, notarization, auto-update).
- No `agent-framework`/`agent-core` dependency — the sidecar owns the runtime.

## Design decisions

- Packaging copies a manifest-verified, OS/architecture-specific headless CLI build to a fixed
  `resources/robota` path rather than bundling the full CLI release, keeping the shipped binary
  minimal and reproducible per platform.
