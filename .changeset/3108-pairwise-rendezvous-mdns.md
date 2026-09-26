---
'@robota-sdk/agent-remote-pairing': minor
'@robota-sdk/agent-transport-webrtc': minor
'@robota-sdk/agent-cli': minor
---

Two of one user's devices can find each other on the local network before the relay.

- `agent-remote-pairing` — `derivePairRendezvous` derives every place a device pair meets from their
  pairwise secret, separated by direction: rotating tags (hourly epochs, looked up one epoch either
  way), the seed of each epoch's one-time signing key, sealed connection-hint records, and the relay
  inbox topics. It takes the lists in force and refuses a device they do not name with the same
  key-agreement key, or revoke, so a rotated or revoked key stops deriving.
- `agent-transport-webrtc` — `startLanMeshRelay` / `DiscoveringMeshRelay` look for a peer in the
  address cache, then with mDNS (`MeshMdns`, over `multicast-dns`), then on the self-hosted relay, and
  carry signals to the peer's direct endpoint (`startMeshLanListener`) on rotating pairwise topics,
  sent only as hashes. An endpoint must prove it holds the pair's topic before it carries signals,
  and is set aside when no admission follows. The mDNS announcement names no product, device or
  host, pads its instance count with names that hold for the epoch, and answers queries at a bounded
  rate. Discovery yields candidates only: admission is still the device handshake, and an address is
  remembered only after an admission it carried.
- `agent-cli` — the device mesh endpoint can look on the local network (`lan` option), remembering
  the addresses that worked in an owner-only `~/.robota/devices/address-cache.json`; no command starts
  it yet.
