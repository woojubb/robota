# agent-remote-pairing Specification

## Scope

Isomorphic pairing + DTLS-fingerprint **channel binding** for P2P remote-control. Lets a host prove that a
connecting remote holds a single-use pairing secret AND binds that proof to the **actual** DTLS channel each peer
observes — defeating a MITM signaling relay. WebCrypto only; the same module runs on the Node host (`agent-cli`)
and a browser remote client.

## Boundaries

- Does NOT open or own the WebRTC connection or signaling — it consumes DTLS fingerprints (from SDP) + a data
  channel `send`, supplied by the caller (`agent-transport-webrtc` on the host; the browser client elsewhere).
- Does NOT wire an enable path — no command, no session exposure. That belongs to the transport.
- **Zero workspace dependencies; no `node:` imports; no WebRTC implementation dependency** in the main entry point.
  Uses only `globalThis.crypto` + standard web APIs so it is reusable unchanged in a browser.

## Security model

A **high-entropy (256-bit) single-use** pairing secret is transferred machine-to-machine (QR / deep link). Because
it is high-entropy, a PAKE — which exists only to protect a LOW-entropy secret from brute-force — is unnecessary.
Authentication + MITM-relay detection is instead a **directional, nonce-bound HMAC key-confirmation** bound to
both DTLS fingerprints:

- Each peer sends a confirmation keyed by its role and both fingerprints, and expects the value under the peer
  role's label — the two labels are distinct so a peer cannot mistake its own confirmation for its counterpart's.
- **Reflection-safe:** what a peer sends differs from what it expects, so a secretless relay cannot echo a peer its
  own confirmation.
- **Replay-safe:** fresh nonces are folded into every transcript.
- **MITM-detecting:** the WebRTC layer forces a relay's advertised fingerprint to match its own certificate, so the
  two honest peers observe different fingerprint pairs when a relay sits between them → the confirmation fails →
  abort.

## Same user, across two computers

Proving possession of a machine's key, recording that a machine was enrolled somewhere, and a completed WebRTC
connection each answer a different question; none says **whose** machine, and a hand-off must not move a session
to someone else's device.

**Why the proof travels with the destination.** Transitive trust — "the source has both devices in its store, so
they are one user" — inverts the direction of the proof: the list lives on the machine making the claim, so a
mistaken or compromised source can assert any destination is its user's while the destination presents nothing.
That is an authorization list wearing an authentication's clothes.

So the user holds one root keypair that signs each device's identity key. A device proves same-user by presenting
that certificate AND demonstrating possession of the device private key — two separate calls, because a
certificate is a public document and proves nothing about who is holding it.

**The grant binds one transfer.** A same-user proof reused for a second transfer is the failure this design
exists to prevent, so every binding is INSIDE the signature: user, source and destination device ids, hand-off id,
session id, nonce, channel fingerprint, and expiry. A signature over a subset would leave the omitted field
attacker-editable while still verifying.

**Signaling stays a rendezvous.** The grant is minted by the source and verified by the destination end to end, so
a signaling server that reads every byte still cannot authorize a transfer.

**Trust levels stay distinct.** A cross-host same-user admission must never satisfy a check that wanted
same-host-same-user, or a local admission could authorize a cross-device transfer.

## `/local` subpath — local-peer admission (node-only)

A separate entry point, not part of the main surface. The main entry is isomorphic (WebCrypto, no Node built-ins)
and runs in the browser remote client; this needs the filesystem, and a browser has no local peers and no
directory permissions to judge.

**What this proves, and what it does not.** Reaching a socket inside an owner-only (mode 0700), user-owned
directory means the peer is on this machine as this user, because the kernel refuses the traversal to anyone else
— the evidence is not an artifact the peer supplies, so there is nothing to copy. It does NOT distinguish two
processes of the same user; the boundary is the account.

**Why the grant ledger is part of the proof rather than a convenience.** The directory check establishes the
environment at the rendezvous, but the session's messages travel over a different carrier. Without a binding, a
peer could pass the kernel's check at the socket and then hand the channel to somebody else, and the admission
would still read same-user-same-host — the environment proof would be true and useless. The ledger issues a nonce
at the rendezvous that the channel's pairing confirmation must present back.

Its lifetime rules are the security properties, not bookkeeping:

- **Single use.** A nonce honoured twice has become a copyable credential — the exact failure this design exists
  to prevent. A presentation spends the value even when the presentation is then refused, so probing does not
  preserve it for a later real attempt.
- **Bounded window.** Admission expires, so a value left in a log or a crashed process is not a standing
  invitation.
- **Revocation is the entry.** Revoking a rendezvous ends admissibility for everything a departing session handed
  out.
- **Deterministic under concurrency.** Two peers presenting one nonce cannot both win; the loser is refused rather
  than queued, because a race resolved by timing is a decision nobody made.

A replay is reported as `replayed` rather than folded into `unknown`. The usual argument for merging them — not
telling a prober which values once existed — does not apply at this boundary: the only party who can reach this
rendezvous already passed the kernel's check as this user, and could read the process's memory outright. An
operator who cannot distinguish a replay from a slow peer cannot act on either.

`SO_PEERCRED` would have been the more direct reading, and it is unavailable: Node exposes no peer-credential
accessor on a connected socket handle (measured). Building on it would have produced a mechanism that compiles,
passes a mocked test, and refuses every real peer.

## Pre-auth wire contract

Every pre-auth frame is decoded ONLY by this package's decoders; a carrier implements
`raw bytes → JSON.parse → owner decoder → typed frame` and drops anything the decoder refuses. Fields are
length-bounded and format-checked before any crypto work runs, and a decoder failure names the field, never its
value — so a malformed frame is a reason, never a throw, and never an oracle for the value that failed.

Every fallible async frame transition inside the handshake and reconnect controllers settles the controller's
single result on rejection (a resolver, crypto, or storage throw rejects it); no detached rejection remains.

## Extension Points

The handshake is transport-agnostic (`send` + `onFrame`); a carrier wires it to its own channel and enforces
accept-before-session-exposure. The session-key derivation output is reserved as a future TOFU/app-key seam.

## Error Taxonomy

Fail-closed: fingerprint extraction throws on a missing fingerprint; the handshake **rejects** on confirmation
mismatch (a possible MITM relay) or timeout — never a silent pass.
