# agent-remote-pairing Specification

## Scope

Isomorphic pairing + DTLS-fingerprint **channel binding** for P2P remote-control. Lets a peer prove that it holds
a single-use pairing secret, or that it is another of the same user's devices, AND binds that proof to the
**actual** DTLS channel each peer observes, defeating a MITM signaling relay. WebCrypto only; the same module runs on the Node host (`agent-cli`)
and a browser remote client.

## Boundaries

- Does NOT open or own the WebRTC connection or signaling — it consumes the DTLS fingerprints of the negotiated
  channel + a data channel `send`, supplied by the caller (`agent-transport-webrtc` on the host; the browser client
  elsewhere).
- Does NOT wire an enable path — no command, no session exposure. That belongs to the transport.
- **Zero workspace dependencies; no `node:` imports; no WebRTC implementation dependency** in the main entry point.
  Uses only `globalThis.crypto`, standard web APIs and pure-JS isomorphic code so it is reusable unchanged in a
  browser.

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
- **MITM-detecting:** the binding names the certificate the DTLS layer verified, so the two honest peers observe
  different fingerprint pairs when a relay sits between them → the confirmation fails → abort. A DTLS stack
  accepts a certificate matching ANY advertised fingerprint, so an SDP must carry exactly one; a carrier that can
  read the verified certificate binds that instead of SDP text.

## Same user, across two computers

Proving possession of a machine's key, recording that a machine was enrolled somewhere, and a completed WebRTC
connection each answer a different question; none says **whose** machine, and a hand-off must not move a session
to someone else's device.

**Why the proof travels with the destination.** Transitive trust — "the source has both devices in its store, so
they are one user" — inverts the direction of the proof: the list lives on the machine making the claim, so a
mistaken or compromised source can assert any destination is its user's while the destination presents nothing.
That is an authorization list wearing an authentication's clothes.

So the proof is a chain of three keys, each with one job:

- **Master key — never stored.** It is recomputed from the user's recovery phrase through the standard BIP39 and
  SLIP-0010 derivations, so the phrase (with its optional passphrase) recovers it with any conforming
  implementation and no file on any device can leak it. Its only acts are certifying, rotating and revoking
  signing keys; its public key is the anchor every device pins, and the user id is derived from it.
- **Signing key — the day-to-day issuer.** Kept on one or two trusted devices and short-lived, it certifies
  devices and issues the roster and revocation lists. Adding or retiring a device therefore never needs the
  phrase, and a lost signing key costs one master-signed revocation rather than the user's identity.
- **Device keys.** A device's certificate binds its signing key (its id is that key's hash) and a separate
  key-agreement key that never signs, with the capabilities it may be asked for. Two devices' agreement keys give
  them a secret only that pair can compute, so nothing any device holds is common to all of the user's devices.

A device proves same-user by presenting the chain AND demonstrating possession of its device private key — two
separate steps, because a certificate is a public document and proves nothing about who is holding it. Possession
is a signature over a transcript naming both negotiated fingerprints, so it cannot be relayed onto another channel.
Neither side discloses a certificate until the other has proved, with a MAC under their pairwise secret, that it is
the rostered device expected: a stranger learns nothing and costs key agreements and MACs, never a signature check
or a disclosure. That proof names its sender by nothing but the MAC itself, because any identifier sent to an
unauthenticated peer could be linked across connections by whoever answers.

**Every signature names its purpose.** Each signed structure begins with a `robota/<purpose>/v<n>` tag inside one
canonical encoding, and a verifier refuses any other tag. One key signs several kinds of statement, and without
the tag a signature made for one could be read as another whose fields line up. The encoding admits one spelling
of each statement's signed content, and no field travels beside a signature without being covered by it.

**An old list is a refusal.** Roster and revocation lists carry a monotonic sequence number and a reader refuses
one below the last it accepted, because a captured older list would roll it back to before a revocation. A list
left out once one has been seen is refused the same way, since omission is the oldest list of all. Device lists
also expire, because a withheld list and a stale one look the same to the reader; before admitting a peer on
another machine a device asks for a newer list, and when no signing-key holder answers it admits only for a bounded
grace past expiry, with a warning, and then refuses. A same-host peer is still admitted, because the OS account it
shares is already the device's trust boundary. Two peers whose lists differ hand the newer one over, and it is
adopted only once it verifies, so a peer can bring a revocation but never forge one. A device holds one signing
key's lists, so the handshake admits only devices certified by that key and refuses the rest; a rotation reaches a
device when it joins again, not through a peer. Sequence marks belong to the signing key that issued the list, so a
second or rotated signing key never makes the first one's lists look rolled back. Where the proof cannot be
established the answer is a refusal with a closed reason, never a pass.

**The grant binds one transfer.** A same-user proof reused for a second transfer is the failure this design
exists to prevent, so every binding is INSIDE the signature: user, source and destination device ids, hand-off id,
session id, nonce, channel fingerprint, and expiry. A signature over a subset would leave the omitted field
attacker-editable while still verifying.

**Signaling stays a rendezvous.** The grant is minted by the source and verified by the destination end to end, so
a signaling server that reads every byte still cannot authorize a transfer. Every place two devices meet — a relay
inbox, a local-network announcement, a published record, a live signal, a relay credential — is derived from their
pairwise secret and separated by direction and purpose, so whoever carries it can neither link it to a device nor let a third party
address the pair, the two directions never overwrite each other, and a record of one purpose never opens as
another. Every value that anyone but the user's own relay can see rotates by epoch, and a lookup also tries the
adjacent epochs so clocks that disagree a little still meet. Derivation takes
the lists in force and refuses a device they do not name with the same key-agreement key, so a rotated or revoked
key stops meeting anyone. A rendezvous only says where a peer might be; admission is still the device handshake.

**Trust levels stay distinct.** A cross-host same-user admission must never satisfy a check that wanted
same-host-same-user, or a local admission could authorize a cross-device transfer. A device certificate proves the
user and never the machine, so an admission is same-host only when the carrier's own rendezvous established it.

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
