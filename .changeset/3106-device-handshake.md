---
'@robota-sdk/agent-remote-pairing': minor
'@robota-sdk/agent-interface-session-mobility': minor
---

Two of one user's devices can admit each other over a channel bound to its negotiated DTLS
fingerprints.

- `agent-remote-pairing` — `startDeviceHandshake` runs the transport-agnostic device handshake
  (`send` + `onFrame`): a pairwise pre-proof that discloses no identity, then hello and prove, with
  the chain verified against the pinned master key, roster, revocation lists and high-water marks,
  and possession proved by a `robota/handshake/v1` signature over the transcript. The side with the
  newer roster or revocation list hands it over and the receiver adopts it only once it verifies.
  Before a remote admission an optional lookup for newer lists runs for at most
  `FRESHNESS_LOOKUP_MS` (3 s); without a newer list a remote peer is admitted with a warning for
  `REMOTE_ADMISSION_GRACE_MS` (72 h) past expiry and then refused, while a same-host peer is still
  admitted. `derivePairwiseSecret` exports the pairwise secret `S_AB`. `decodeDeviceHandshakeFrame`
  decodes the frames. `verifyDeviceChain` accepts `listExpiryGraceMs` and reports `listsExpiredAt`.
- `agent-interface-session-mobility` — `IMeshAdmission` and `TMeshCapability`: the admission a device
  handshake produces, with trust, locality and workspace as separate fields.
