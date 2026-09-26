---
'@robota-sdk/agent-transport-webrtc': minor
'@robota-sdk/agent-remote-pairing': minor
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-cli': minor
---

Two of one user's devices can connect to each other over WebRTC, admitted by the device handshake.

- `agent-transport-webrtc` — `DeviceMeshNode` keeps one connection per device pair, in either role: the
  device with the lower id offers and the other answers, so concurrent attempts resolve by rule. Both
  roles bind the handshake to the certificate the DTLS layer verified and take one remote description
  with exactly one fingerprint; before admission only handshake frames cross, and a connection counts
  as admitted only once both sides admitted each other. Each connection gets its own DTLS certificate
  (`createDtlsKeys`). A new attempt never displaces an admitted connection until it is admitted
  itself, and attempts per pair are paced. Lists adopted in a handshake, or handed over through
  `refresh`, apply at once, and a device they revoke loses its connection. Signaling runs through
  `IMeshRelay`: `WsMeshRelayClient` for the self-hosted relay's `presence` / `message` frames
  (topics capped per source and relay-wide), `createInMemoryMeshRelayHub` for tests.
- `agent-remote-pairing` — the pair's two relay inbox topics, one per direction, come from their
  pairwise secret (`derivePairRendezvous(...).relayInbox()`).
- `agent-cli` — a device holding the signing key reissues its roster and revocation list before they
  expire while an interactive session runs. The host can open this device's mesh endpoint from the
  identity under `~/.robota/devices`, saving newer lists a peer hands over; no command starts it yet.
- `agent-command` — `/devices add|join` still reports that enrolment is not available yet.
