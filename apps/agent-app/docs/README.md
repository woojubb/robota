# @robota-sdk/agent-app

An **Electron desktop app** (macOS / Linux / Windows) that drives a live `robota` session graphically —
the graphical counterpart of the terminal UI (`agent-ui-terminal`). It is internal to the monorepo and not
published to npm.

`agent-app` is a **thin shell**: it runs `robota daemon start --json`, which starts this workspace's headless
runtime daemon (**not** the terminal UI) or reuses the live one, and loads the GUI web app
(`packages/agent-gui-web`), handing it the daemon's loopback address through the preload bridge. The daemon
outlives the window: closing the app leaves it running, and the next launch reattaches to it. The page is the
same one the CLI serves on `robota --serve --open`; design work and the user scenarios run in a browser there
(`pnpm gui:dev`, and `test:e2e` in `agent-gui-web`). The GUI drives a shared runtime and does not control the
CLI's terminal UI. All session, command, and permission logic lives in the daemon (reached over the wire), so
the GUI holds no agent runtime and depends on neither `agent-framework` nor `agent-core` — it is just another
surface on the same daemon.

The loopback connection is authenticated by a token: the CLI mints it with the daemon and reports it in the
address the shell hands the page, and the `WsTransport` rejects any connection lacking the token **before**
emitting session data — closing the otherwise-unauthenticated loopback port against a co-resident browser
page.

## Run (dev)

```bash
pnpm app:dev   # builds the shell and the page it loads, opens the window on the CLI from source
```

The daemon serves the directory `app:dev` was started from (or `ROBOTA_DEV_CWD`), which must be a trusted
workspace (`robota trust grant`).

`app:dev` sets `ROBOTA_GUI_SIDECAR_CMD` to `scripts/dev/robota`; outside it, an unpackaged shell runs PATH
`robota`. Set the variable yourself to use another command **binary** (the e2e uses the scripted sidecar); the
shell always runs it as `daemon start --json`. A packaged app ignores the variable and runs the `robota`
runtime bundled inside it. The other ways to run from source are in the
[development guide](../../../content/development/README.md#run-from-source).

## Packaging

`pnpm --filter @robota-sdk/agent-app dist:app` builds the shell, bundles a host-platform `robota` runtime, and
produces installers with electron-builder (configured in `electron-builder.yml`). Release tags attach these
installers to the GitHub Release. They are **not code-signed**, so macOS Gatekeeper and Windows SmartScreen
warn on first launch.

See [`SPEC.md`](./SPEC.md) for the daemon/token contract, renderer hardening, and what the shell does not own.
