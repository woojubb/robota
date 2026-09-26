---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-ui-web': patch
'@robota-sdk/agent-app': minor
---

`robota daemon start | status | stop` runs one long-lived runtime per workspace that clients attach to.

- A daemon is a supervised session marked as the workspace's daemon.
- Its control socket answers `connect` with the loopback WebSocket address, but only to a caller that
  names the daemon's current start. The token is never written to disk and never put on argv.
- `daemon start --json` prints one line, `{"id","url"}`, for a client host to read.
- The desktop app now attaches to the workspace daemon, starting one only when none is running. Closing
  the window leaves the daemon running, so the next launch continues the same session.
