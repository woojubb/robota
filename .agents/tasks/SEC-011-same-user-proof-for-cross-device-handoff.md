---
title: 'SEC-011: cross-device hand-off has no proof of same USER — device identity and trusted-device enrolment both describe a machine, and a successful WebRTC connection describes neither'
status: todo
created: 2026-08-17
priority: high
urgency: soon
area: packages/agent-remote-pairing, packages/agent-transport-webrtc, packages/agent-cli
depends_on: []
---

# SEC-011: what proves "the same user", across two computers

Registered as [issue #1812](https://github.com/woojubb/robota/issues/1812), the security child of
[#1808](https://github.com/woojubb/robota/issues/1808). The functional sibling is
[#1811](https://github.com/woojubb/robota/issues/1811), which consumes the authorization result this
item defines.

Sibling in shape, not in substance, to [SEC-010](completed/SEC-010-same-environment-proof-for-local-peers.md).
That item proves _same machine, same account_; this one proves _same person, different machines_.
**The trust levels must stay distinct** — the issue says so, and collapsing them would let a local
admission authorize a transfer to another computer.

## The problem, stated precisely

The destination must prove it belongs to the same authenticated user as the source. Measured against
what the repository has today, nothing does:

| Existing                                                          | What it proves                                    | Why it is not same-user                                                |
| ----------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| `IHostIdentity` (`agent-cli/src/remote-control/host-identity.ts`) | Possession of one **machine's** ECDSA private key | A key identifies a device, and a device is not a person                |
| `ITrustedDeviceRecord` (`trusted-device-store.ts`)                | This device was **enrolled** here once            | Enrolment is a local list; it says nothing a second machine can verify |
| A completed WebRTC connection                                     | Two endpoints negotiated a channel                | Connectivity is not identity — the issue says this outright            |

The issue is explicit that the first two must NOT be overloaded to mean same-user. They answer
"which machine", and the question here is "whose".

## The design question

What evidence lets machine B prove to machine A that both belong to one user, without either
machine having met the other before, and without a platform account service in the loop?

### Alternative A — an account service (OIDC / OAuth)

Both devices authenticate to an identity provider and present its token.

- **For**: the strongest notion of "same user", and revocation is centrally solved.
- **Against**: it puts a network service on the critical path of a LOCAL-first tool, and makes
  hand-off impossible offline. The issue anticipates this and says such credentials must sit behind
  an **injected port** rather than being the contract — so this cannot be the SSOT, though it may be
  one implementation of the port.

### Alternative B — reuse trusted-device enrolment transitively

If A trusts D1 and A trusts D2, treat D1 and D2 as the same user.

- **For**: no new artifact; the store already exists.
- **Against**: **it inverts the direction of the proof.** The enrolment list lives on the machine
  making the claim, so a compromised or simply mistaken source device can assert any destination is
  its user's. The destination presents nothing. It is an authorization list masquerading as an
  authentication.

### Alternative C — a user root key that signs device keys (recommended)

The user holds one **root identity keypair**. Each device's identity public key is signed by that
root, producing a device certificate. A device proves same-user by presenting its certificate and
demonstrating possession of the device private key: same root ⇒ same user.

- **For**: the proof travels WITH the destination rather than being asserted by the source, which is
  what fixes B's inversion. It is verifiable offline, and it is implementable in the existing
  isomorphic, zero-dependency boundary — WebCrypto ECDSA, the same primitives
  `agent-remote-pairing` already uses for reconnect challenges.
- **Against**: the root key becomes the thing that must be protected and, eventually, rotated. The
  revocation story is ours to build rather than inherited from a provider.

## Recommendation

**Alternative C**, with A available behind the injected port for anyone who wants an account service.

The decisive argument is B's inversion: an authorization that the _claimant_ supplies is not an
authentication. C is the only option where the destination presents evidence about itself that the
source can check without trusting the destination's word for it.

## What the authorization must bind, and why each binding exists

The issue lists these; each maps to an attack that is otherwise open. A single signed grant covers
them, and every field is inside the signature:

| Field                                     | Without it                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Authenticated user binding (root id)      | A different user's device passes                                                                  |
| Source AND destination device ids         | The grant is replayable toward a third device                                                     |
| Exact hand-off id + session id (audience) | One authorization moves a different session — the issue's "cannot be reused for another transfer" |
| Fresh nonce/challenge                     | A recorded grant replays                                                                          |
| Channel binding (DTLS fingerprint)        | The grant is presented over a substituted channel                                                 |
| Expiry                                    | A stolen grant is valid forever                                                                   |
| Revocation/rotation state                 | A retired device key keeps working                                                                |

**Signaling stays a rendezvous only.** The grant is verified end-to-end between the two devices, so a
signaling server that reads every byte still cannot authorize a transfer or read session content.

## Failure, revocation, and rotation

- **Fail closed before session data.** Every rejection happens before any transferred state is
  exposed — mismatch, unauthorized device, wrong destination, expired or replayed request, tampered
  payload, substituted channel.
- **Consent is separate from authentication.** A valid same-user proof does not imply the user wants
  THIS transfer; the endpoints ask, and a denial is a normal outcome rather than an error.
- **Revocation** is a list of retired device ids signed by the root; a certificate whose device id
  appears there fails verification even though its signature is intact.
- **Rotation** of the root re-signs the device certificates. Until a device is re-signed it fails —
  fail-closed, so a half-completed rotation cannot silently widen trust.
- **The trust level stays distinct from SEC-010's.** A `same-user-different-host` result must never
  satisfy a check that wanted `same-user-same-host`, and vice versa.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                   | Notes                                                      |
| ----- | --------- | ------------------------------------------------- | ---------------------------------------------------------- |
| TC-01 | Unit test | Two device keys signed by one root                | The positive case; real WebCrypto, not a stub              |
| TC-02 | Unit test | Device signed by a DIFFERENT root                 | The core rejection — a different user                      |
| TC-03 | Unit test | Valid certificate, wrong destination device id    | The grant must not be replayable toward a third device     |
| TC-04 | Unit test | Valid grant, different hand-off/session audience  | "Cannot be reused for another transfer", asserted          |
| TC-05 | Unit test | Replayed nonce; expired grant                     | Both refuse                                                |
| TC-06 | Unit test | Tampered payload — any signed field mutated       | Signature covers every binding, proven field by field      |
| TC-07 | Unit test | Substituted channel fingerprint                   | Channel binding actually binds                             |
| TC-08 | Unit test | Revoked device id; mid-rotation device            | Fail closed in both                                        |
| TC-09 | Unit test | Consent denied                                    | A normal refusal, distinct from an authentication failure  |
| TC-10 | Unit test | Trust level is not interchangeable with SEC-010's | A local admission cannot authorize a cross-device transfer |

## User Execution Test Scenarios

Deferred until the recommendation is accepted, for the same reason SEC-010's was: what a user can run
depends on which alternative is built. Under C the observable is two local processes acting as two
devices — a root signing both, a hand-off authorized; then a third device signed by a different root,
refused before any state moves. That is agent-executable with no network and no credentials, which is
the shape to aim for.
