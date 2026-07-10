---
'@robota-sdk/agent-transport-webrtc': minor
---

REMOTE-004 Stage B2: production WebRTC signaling + relay abuse-hardening (still no user-facing enable path).

- Add `WsSignalingClient` — a production `ISignalingClient` over a `ws` socket to the `@robota-sdk/remote-signaling`
  relay (Node host-side): joins a rendezvous, buffers signals produced before the socket opens and flushes them,
  and surfaces relay/socket errors through an explicit `onError` (no silent degrade). An `onReady` callback fires
  once the rendezvous join is confirmed.
- Expose opt-in `forceTurn` on `IWebRtcTransportOptions` (relay-only ICE) as defense-in-depth.
- The private `@robota-sdk/remote-signaling` relay is hardened in-layer (safe by default): a per-source
  token-bucket bounds join floods, rendezvous ids are single-use (a distinct third peer is refused for the id's
  lifetime, even after one of the pair leaves), a half-open rendezvous expires after a TTL, and concurrent
  rendezvous are capped — all with injected clock/scheduler for deterministic tests.
- `CVE-2024-29415` (werift-transitive `ip` SSRF) is discharged as a reviewed re-accept: werift never calls the
  vulnerable `ip.isPublic`/`isPrivate`/`address` (verified + guarded by a regression test), so the
  `ignoreCves` entry is retained with a documented non-reachability rationale.
