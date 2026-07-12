# @robota-sdk/agent-gui

An **Electron desktop app** (macOS / Linux / Windows) that drives a live `robota` session graphically —
the graphical mirror of the terminal TUI (`agent-transport-tui`).

`agent-gui` is a **thin presentation shell**: it spawns a `robota` **sidecar** process, connects to it over
a loopback WebSocket, and renders the session by reusing `@robota-sdk/agent-web-ui`'s React view + reducer
**verbatim**. All session, command, and permission logic lives in the sidecar (reached over the wire), so the
GUI holds no agent runtime and depends on neither `agent-framework` nor `agent-core` (the OWNER PRINCIPLE:
the GUI is "just another surface").

The loopback connection is authenticated by a **per-launch nonce** (GUI-002): the shell mints a token + free
port, passes them to the sidecar via env (`ROBOTA_WS_TOKEN` / `ROBOTA_WS_PORT`), and the `WsTransport` rejects
any connection lacking the token **before** emitting session data — closing the otherwise-unauthenticated
loopback port against a co-resident browser page.

## Run (dev)

```bash
pnpm --filter @robota-sdk/agent-gui build     # renderer (Vite) + electron main/preload (tsc)
pnpm --filter @robota-sdk/agent-gui start      # launch Electron (needs a display + a `robota` on PATH)
```

Set `ROBOTA_GUI_SIDECAR_CMD` to override the sidecar command (default `robota`).

## Status (Stage 1 — GUI-002)

Foundation MVP: window + sidecar spawn/supervise + live session render + permission/ask + required loopback
auth. **Deferred:** per-OS packaging/code-signing (GUI-003), richer co-drive UI. See
[`docs/SPEC.md`](./SPEC.md) for the architecture, the sidecar/nonce contract, and the User Execution Test
Scenario.
