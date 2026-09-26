---
'@robota-sdk/agent-transport-webrtc': minor
'@robota-sdk/agent-remote-pairing': minor
'@robota-sdk/agent-cli': minor
---

Where no direct path joins two of one user's devices, a TURN relay on one of the user's own devices carries the
connection.

- `agent-transport-webrtc` — `TurnServer`, a pure-JavaScript TURN server over UDP (Allocate, Refresh,
  CreatePermission, ChannelBind, Send/Data indications, ChannelData, long-term credentials) with quotas for
  allocations per owner and in all, relayed bytes per second per owner, and allocation lifetime, and an optional
  relayed-port range for a relay behind a NAT. Only what MESSAGE-INTEGRITY covers is read. Requests nobody has
  authenticated are answered at a limited rate (per source and in all) and never with more bytes than they carried,
  and forwarding into private ranges can be turned off (`allowPrivatePeers`).
  `MeshTurnRelay` runs it for the devices of the roster: each pair derives a short-lived credential of its own
  (`meshRelayCredential`), a device the lists drop or revoke can no longer allocate and loses its allocations.
  `DeviceMeshNode` takes `relays` (the relays paired devices advertise, then configured TURN servers, and
  `relayOnly`) and `relayServer`; a connection that needs a relay and has none is refused with
  `MeshRelayNeededError`, which says why a relay was needed and carries the direct attempt's failure. `MeshDht` publishes this device's relay endpoints in the sealed hints records
  (`relayEndpoints`) and reads the peers' (`relayAdverts`). DTLS stays end to end; the relay only forwards it.
- `agent-remote-pairing` — the pair rendezvous derives a `relay-user` tag and `relayPassword`, the relay
  credential's password for one direction and username.
- `agent-cli` — `transports.mesh.options` takes `relay` (`serve`, `port`, `host`, `publicAddress`, `relayPorts`,
  `allowPrivatePeers`),
  `turnServers` and `relayOnly`; the device mesh endpoint runs the relay, advertises it to paired devices only,
  and uses the fallback order.
