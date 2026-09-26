---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

The device mesh can be turned on, and `/peers`, `/handoff` and `/devices` reach the user's other devices.

- New user setting `transports.mesh.enabled` (default `false`). When it is `true`, an interactive
  session opens the device mesh at startup and closes it on exit. Only the user settings count; a
  project's settings cannot turn it on. Print and serve runs never open it, and a device without an
  identity is told to run `/devices init`.
- By default a linked device may send messages, files and sessions. Each file and each session still
  waits for the operator's yes on this machine's terminal; with no terminal the answer is no.
  Delegating, observing and driving stay off unless `transports.mesh.options.capabilities` lists
  them.
- A message from a linked device arrives like one from a session on this host: a peer turn with no
  authority, attributed to the device the handshake proved, under the same rate limit and
  conversation limits.
- `/peers` lists linked devices beside the sessions on this host; `/peers send` and
  `/peers send-file` take a device id. `/handoff` lists linked devices and pushes the session to one.
  Files arrive in the usual place aside, and sessions are saved without starting.
- `/devices` shows whether the mesh is on, how this device finds the others, and which are linked.
- The mesh uses the relay at `transports.webrtc.options.relayUrl` when one is set. Without one it
  finds devices on the local network and over the public ways in `transports.mesh.options`.
- `/peers`, `/handoff` and `/devices` stay user-only. Their descriptions tell the model they cover
  linked devices.
- `agent-framework`: the `/peers` port can list linked devices (`listDevices`, `ILinkedDeviceSummary`).
- `agent-command`: the `/devices` port can report the mesh (`meshStatus`, `IDevicesMeshStatus`).
