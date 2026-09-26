---
'@robota-sdk/agent-remote-pairing': minor
'@robota-sdk/agent-transport-webrtc': minor
'@robota-sdk/agent-cli': minor
---

The device mesh can find and signal a peer device beyond the local network, through public
infrastructure that sees only signed ciphertext.

- **Rendezvous records (BEP 44):** each device publishes, per peer, its connection hints and the newest
  device revocation lists it holds as mutable items on the BitTorrent Mainline DHT (`bittorrent-dht`,
  directly over UDP), or through pkarr relays (`createPkarrRelayStore`, for clients that cannot reach
  the DHT). Every record is signed by a one-time key of the pair, direction, epoch and purpose, stored
  under a rotating salt, AEAD-sealed and padded to a fixed size; publish times are jittered per pair.
  Lookups read the peer's records at the current and adjacent epochs and reject anything that does not
  verify or open for the pair. `MeshDht` is the candidate source and publisher, and its
  `latestLists` feeds the freshness lookup before a remote admission.
- **Nostr signaling:** `NostrMeshRelay` carries live SDP/ICE as ephemeral events on several relays,
  under per-epoch, per-direction keys and kinds, with our own AEAD over the payload and no tags.
- **Order:** `DiscoveringMeshRelay` tries the address cache, mDNS, then DHT records for candidates,
  and when none answers the signaling carriers in order — Nostr, then the self-hosted relay. A
  carrier that carries no admission in time is set aside for the next one.
- **Defaults:** `DEFAULT_NOSTR_RELAYS` and `DEFAULT_PKARR_RELAYS` list well-known relays of several
  operators; `transports.mesh.options` (`dht`, `pkarrRelays`, `nostrRelays`) replaces them, parsed by
  the CLI's `parseMeshInternetSettings`, and `openDeviceMesh` takes them as `internet`. No command
  starts the mesh yet.
- `agent-remote-pairing`: `signingSeed`, `sealRecord` and `openRecord` take a record purpose
  (`hints`, the default and unchanged; `revocation`; `signal`), and two tag purposes are added.

**Breaking (pre-release, hence minor):** `IDiscoveringMeshRelayOptions.advertiser` becomes
`advertisers` (a list).
