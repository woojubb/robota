---
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-transport-webrtc': patch
---

Device mesh follow-ups.

- A device with no identity is pointed to `/devices add` on one of the user's devices and `/devices join`
  here, as well as to `/devices init`. The message says that `init` is for the first device only,
  because it creates a separate identity that can never link to the user's other devices. The `/devices`
  description and the `init` subcommand say the same.
- An identity created mid-session (`/devices init`, or a successful `/devices join`) opens the mesh
  without a restart when `transports.mesh.enabled` is on.
- If a session stalls for longer than the mesh lock's stale window (for example while the machine
  sleeps), another session can take the mesh over. The stalled session now notices this on its next
  lock refresh, closes its own mesh, and says why. Two sessions no longer run it together.
  `holdExclusiveFileLock` has a new `onLost` option for this.
- `/peers` and `/handoff` still list and reach linked mesh devices when local same-host peer discovery
  fails. `/peers` says why sessions on this host are not listed. `ICommandLocalPeersAdapter` has a new
  optional `localDiscoveryOff` field for this.
- `agent-transport-webrtc`: when lists become newer on a node (reissued, revoked, or adopted from a
  peer), the node sends them over every admitted connection instead of waiting for the next handshake.
  Reissues, revocations and enrolments in the CLI take effect this way at once. A receiver adopts a
  pushed list only if it is newer, issued by this user's signing key, and verifies. The push does not
  depend on the peer's capabilities, and it never reaches the application's message handlers.
