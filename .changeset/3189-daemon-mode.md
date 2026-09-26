---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-ui-web': minor
'@robota-sdk/agent-app': minor
---

`robota daemon start | status | stop | unlock` runs one long-lived runtime per workspace for clients to attach to.

- **What a daemon is.** A supervised session marked as the workspace's daemon.
  - Its control socket answers `connect` with the loopback WebSocket address, and only to a caller that names the daemon's current start.
  - The token never touches disk or argv. The daemon removes it from its own environment, so its tools do not inherit it.
- **Starting.** `daemon start --json` prints one line, `{"id","url"}`, for a client host to read.
  - Starts in one workspace take turns through a lock.
  - A lock left behind by a start that is gone is never removed automatically. The start refuses and names `robota daemon unlock`.
  - A daemon that cannot hand over its address fails its start and is not left running.
- **The desktop app attaches** to the workspace daemon and starts one only when none is running.
  - Closing the window leaves the daemon running.
  - If the daemon stops while the window is open, the window says so and offers Reconnect.
- **`agent-ui-web`.** The WebSocket session client reports when its retries are exhausted (`onGiveUp`, and `onConnectionLost` in `useWsSession`).
