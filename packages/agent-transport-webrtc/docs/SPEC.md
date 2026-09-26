# agent-transport-webrtc Specification

## Scope

WebRTC P2P transport. Carries the protocol-owned `IProtocolSession` capability over an `RTCDataChannel` so an
external remote client can co-drive a live `agent-cli` session directly, peer-to-peer, without routing session
content through any server; and connects two of one user's devices to each other (the device mesh), admitted by
the device handshake. Reuses the transport-neutral session bridge + wire protocol from
`@robota-sdk/agent-transport` (the same handler the WebSocket transport uses) so the protocol is shared, not
duplicated. The public attach contract accepts that protocol role set directly: a full interactive
session is a valid host input, but unrelated session capabilities are outside the carrier's
dependency.

## Boundaries

- Does NOT own the session bridge or wire protocol — that is `@robota-sdk/agent-transport`. This package only
  carries those frames over a data channel; it has **no** `webrtc → ws` package edge.
- Owns the pairing GATE, not the pairing crypto — the directional-HMAC handshake + DTLS-fingerprint channel
  binding is `@robota-sdk/agent-remote-pairing` (a zero-dep isomorphic leaf). The gate must live here because only
  the transport can see the offer/answer DTLS fingerprints and the pre-session channel frames; this is the sole
  reason for the `webrtc → agent-remote-pairing` edge.
- Does NOT own signaling — SDP/ICE rendezvous is an injected signaling port. The transport never inspects
  signaling internals.
- Does NOT bundle the WebRTC implementation. `node-datachannel` (libdatachannel, DTLS by OpenSSL) is an
  **optional peer dependency** loaded lazily, because it ships a native binary per platform; where it cannot load
  the transport is unavailable with an explicit "WebRTC transport unavailable" throw at point-of-use — never a
  silent no-op, and never another implementation (no-fallback rule).
- **No enable path here.** The transport defaults to disabled, is not registered in `agent-cli`, and exposes no
  command to turn it on; wiring an enable path is out of scope for this package.
- **Admission is decided at construction, and there is no unstated default.** With a pairing secret, the data
  channel is phase-separated: pre-accept it carries only pairing frames (anything else is held, bounded, until
  this side's verdict and discarded if pairing fails, since the peer may finish first and speak at once), and only
  after the handshake accepts (channel-bound to the DTLS fingerprints) is the session bridge built — fail closed on
  mismatch/timeout (channel closed, session never exposed).

  Without a secret the constructor throws unless the caller explicitly opts in with a written reason. Running
  ungated is a decision someone has to make and write down; it used to be what happened when nobody said anything,
  which this construction-time check removes. A secret together with the ungated opt-in is contradictory and also
  throws. The written-reason requirement is centralized in `@robota-sdk/agent-transport/node` so sibling transports
  cannot drift apart on what counts as an answer.

- **Owns the local-peer channel GATE, not the local-peer policy.** When local-peer admission is configured, an
  accepted handshake is not enough: the peer must also present the nonce it was issued at the guarded rendezvous,
  and only then is the session exposed. This package holds the state machine and the frame; single-use, expiry and
  revocation belong to the grant ledger in `@robota-sdk/agent-remote-pairing/local`, which is injected as a port.
  That keeps the cryptographic/OS policy out of the transport and keeps `node:fs` out of this package.

  **Why both edges of the step are load-bearing.** The handshake binds the CHANNEL — after it, the channel
  provably terminates at the peer that knew the secret — and says nothing about where that peer runs. The guarded
  rendezvous binds the ENVIRONMENT and says nothing about which channel that peer later opens. Presenting the
  nonce OVER the already-bound channel joins them. Earlier than that and the nonce would be handed to an unproven
  counterpart; later than that and a peer would already be talking to the session, where refusing it is not
  refusing it.

  Every non-admitted path closes the channel: a refused nonce, a frame that is not a proof frame, and a ledger
  that throws. "Not reached" is not "allowed", and a gate that merely ignored a bad frame would park with the
  channel open — a hang, which is fail-open wearing a stall's clothes. The consumer is notified on refusals as
  well as admissions, because "no local peer connected" and "a local peer was refused" call for different operator
  responses. The result carries an explicit trust level rather than a boolean.

  Absent local-peer configuration, behaviour is exactly as before — a remote peer has no rendezvous to have
  reached, and demanding one unconditionally would refuse every legitimate remote session.

- **Owns where operator approval sits, not who approves.** When a connection approval is configured, the
  session is exposed only after the injected approver says yes, asked once every proof has bound the channel so
  the operator is asked only about a peer that is who it claims. What the peer sends while the operator decides
  is held, bounded, and reaches the session only after a yes, because the peer's side has already accepted and
  starts talking. A no, a failure to ask, or too much held input closes the channel; a channel that closes
  first withdraws the question, and a later answer admits nothing. A first-pairing device is pinned for reconnect only once it is admitted, so a
  device the operator refused is not remembered.

## Design decisions

- **The session host is the offerer; in the device mesh the pair decides.** Inbound description/ICE signals are
  applied in arrival order, and a candidate that arrives before the remote description waits for it, so trickled
  candidates are never lost to ordering. Between two devices the one with
  the lower device id offers and the other only answers, so two devices reaching for each other at once make one
  connection by rule rather than by whichever message arrives first; a repeated announcement from the peer run
  already being served is ignored, and a new run of the peer replaces the connection.
- **Device mesh admission.** A mesh connection binds the device handshake the way the session gate binds pairing,
  in both roles: the remote fingerprint comes from the certificate the DTLS layer verified, the remote description
  must advertise exactly one fingerprint, and one is taken per connection. Until admission only handshake frames
  cross; anything else ends the connection. A side counts the connection admitted only after the peer says it
  admitted it too, so a refused peer never believes it is connected. Each connection has a DTLS certificate of its
  own: a per-process certificate would be a stable identifier the relay could link across connections, and one two
  endpoints in a process would share. No ICE server is contacted unless one is configured. Every way signals travel — the relay, or a peer's
  direct endpoint on the local network — is reached only through opaque, pairwise topics and is never trusted for
  anything but delivery: nothing it says is authenticated, so a new attempt runs beside the admitted connection
  and replaces it only once admitted itself, and attempts per pair are paced — forged announcements can neither
  cut a working connection nor open connections without bound.
  Lists adopted in a handshake or handed over later apply from the next handshake, and a device they revoke loses
  its connection at once. Admission says who the peer is; what it may do on the connection is its connection
  authority's answer, so even a message is delivered only when that authority allows it.
- **Discovery yields candidates, never trust.** Whatever a discovery path answers only carries signals, so a stale
  or planted address can delay a connection but not admit one. A pair tries what reveals least first: an address
  that already carried an admitted connection needs no broadcast, the local network needs no third party, and the
  relay is the last resort. An endpoint carries a pair's signals only once it proves it holds the pair's topic,
  and is set aside when no admission follows, so no endpoint can hold a pair off the relay; an address is
  remembered only after an admission it carried. The mDNS announcement is built record by record rather than by
  a service-publishing library, because those publish the machine's host name: the service type names no
  product, every instance name is a pairwise tag that rotates by epoch, the host name is random, and the
  instance count is padded with names that hold for the epoch, so it does not tell how many devices there are.
  On the local network, topics travel only as hashes and rotate by epoch, so what an observer there sees does
  not carry the stable relay inbox topics.
- **The data channel is wired eagerly at creation, not on open.** The session message handler is built and its
  message subscription attached immediately, because the underlying implementation does not buffer inbound frames
  that arrive before a subscription, and the remote can send its first client message before the host's channel
  reports open.
- **Outbound delivery is owned by the carrier.** The transport and the pairing gate each build the connection's
  outbound-delivery boundary from their own channel sink and their own failure policy before handing it to the
  shared session handler, so replies and session events share one guard. A data-channel send failure routes
  through one idempotent channel/handler cleanup path and an optional owner observer; it never escapes back into
  the committed session operation, and the boundary reports it once. A reconnect attachment detaches its failed
  sink while retaining the frame in the resume buffer.
- **Lifecycle classification.** This transport is a frozen "service" lifecycle. Its readiness boundary is
  publication of the local offer/signaling state; it deliberately does not wait for an external answer,
  data-channel open, or pairing decision. Starting before attaching, and a repeated active start, are rejected;
  repeated stop is safe and restart requires reattaching.
- **Pairing gate as a routing switch.** When a pairing secret is configured, the eager message subscription
  becomes a routing switch into the pairing gate — never a deferred subscription — so no frame can reach the
  session before the gate has a chance to see it. The local DTLS fingerprint is captured from the offer; the
  remote fingerprint is read from the certificate the DTLS layer verified, not from the answer's text, because
  the DTLS layer accepts a certificate matching ANY fingerprint an SDP advertises. The answer must advertise
  exactly one fingerprint, and a start takes one answer only — a later answer would add fingerprints the DTLS
  layer also accepts. The gate is constructed once the DTLS handshake completes, before the data channel it
  carries can deliver a frame; a handshake that fails or closes first fails pairing. Pre-accept, the gate
  routes pairing frames to the handshake and drops everything else; on accept it builds the session handler and switches routing to the
  session; on reject or timeout it closes the channel and exposes nothing. Optional callbacks fire on gate
  accept/reject so the host can drive its own lifecycle, including tearing down the peer/signaling on failure so
  nothing leaks.
- **Reconnect vs. first-pair.** When host-reconnect is configured, the gate becomes reactive: the client's first
  frame selects either first-pair (handshake, then a mutual identity-key enrollment exchange that pins the device
  key before the session is exposed) or reconnect (a mutual challenge against the pinned device + host identity
  keys, with no re-pairing). Without reconnect configuration, the gate is first-pair-only.
- **Reporter forwarding.** Usage reporters are forwarded only after admission, on both direct and paired handlers.
  A reconnecting session retains the same reporters for its full lifetime, so resumption changes delivery state
  but not admitted-owner query authority.
- **The WebRTC implementation is `node-datachannel`, chosen, not fallen back to.** Channel binding means something
  only if the DTLS layer proves the peer holds the key of the certificate it presents, i.e. verifies the handshake
  signatures, which OpenSSL's DTLS does. It also connects quickly, notices a dead peer, and contacts no ICE server
  it was not given. The cost is a native binary per platform, which is why it is optional and why a platform
  without one has no WebRTC transport at all. The implementation sits behind one lazy loader and one peer
  wrapper, so a later change is again a recorded choice.

## Error Taxonomy

- The optional WebRTC dependency absent, or without a binary for this platform → the lazy loader throws an
  explicit "WebRTC transport unavailable" error at point-of-use (never a silent degrade).
- Starting before attaching → throws a lifecycle error naming the required order.
- An outbound send failure on a closing/closed channel — whether a session event or a reply that resolved after
  the drop — closes and detaches that carrier, reports the delivery-error observer exactly once, and leaves the
  committed session operation successful. It is never silently dropped or partially retried, and it never surfaces
  as an unhandled rejection.
