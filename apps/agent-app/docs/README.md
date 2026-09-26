# @robota-sdk/agent-app

An **Electron desktop app** (macOS / Linux / Windows) that drives a live `robota` session graphically —
the graphical mirror of the terminal TUI (`agent-ui-terminal`).

`agent-app` is a **thin shell**: it runs `robota daemon start --json`, which starts this workspace's headless
runtime daemon (**not** the terminal TUI) or reuses the live one, and loads the GUI web app
(`packages/agent-gui-web`), handing it the daemon's loopback address through the preload bridge. The daemon
outlives the window: closing the app leaves it running, and the next launch reattaches to it. The page is the same one the CLI serves on
`robota --serve --open`; design work and the user scenarios run in a browser there (`pnpm gui:dev`, `test:e2e`). The GUI drives a
shared runtime and does not control the CLI's terminal UI. All session, command, and permission logic lives in
the daemon (reached over the wire), so the GUI holds no agent runtime and depends on neither `agent-framework`
nor `agent-core` (the OWNER PRINCIPLE: the GUI is "just another surface").

The loopback connection is authenticated by a token (GUI-002): the CLI mints it with the daemon and reports it
in the address the shell hands the page, and the `WsTransport` rejects any connection lacking the token
**before** emitting session data — closing the otherwise-unauthenticated
loopback port against a co-resident browser page.

## Run (dev)

```bash
pnpm app:dev   # from the repo root: builds the page and the shell, opens the window on the CLI from source
```

`app:dev` sets `ROBOTA_GUI_SIDECAR_CMD` to `scripts/dev/robota`; outside it, an unpackaged shell runs PATH
`robota`. Set the variable yourself to use another command **binary** (the e2e uses the scripted sidecar); the
shell always runs it as `daemon start --json`. The other ways to run from source are in the
[development guide](../../../content/development/README.md#run-from-source).

## Status (Stage 1 — GUI-002)

Foundation MVP: window + workspace daemon attach + live session render + permission/ask + required loopback
auth. **Deferred:** per-OS packaging/code-signing (GUI-003), richer co-drive UI. See
[`docs/SPEC.md`](./SPEC.md) for the architecture, the daemon/token contract, and the User Execution Test
Scenario.
