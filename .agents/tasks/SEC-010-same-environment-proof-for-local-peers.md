---
title: 'SEC-010: local agent-cli peers have no proof of shared environment — certificate possession is copyable, and channel binding authenticates a channel rather than a machine'
status: todo
created: 2026-08-17
priority: high
urgency: soon
area: packages/agent-remote-pairing, packages/agent-transport-webrtc, packages/agent-cli
depends_on: []
---

# SEC-010: what proves "the same local environment"

Registered as [issue #1810](https://github.com/woojubb/robota/issues/1810), the security child of
[#1807](https://github.com/woojubb/robota/issues/1807). The functional sibling is
[#1809](https://github.com/woojubb/robota/issues/1809), which consumes the admission result this item
defines and can proceed against an injected double until it exists.

**The issue states the precondition this document answers**, and it is the reason nothing is
implemented yet: _"The issue must define the exact environment proof and its failure/revocation
semantics before implementation."_

## The problem, stated precisely

Two `agent-cli` sessions on one computer want to exchange messages. Admission must establish that the
peer is **in the same local environment**, not merely that it holds a credential.

The repository already has two mechanisms, and the issue is right that neither answers this:

| Mechanism                                                          | What it actually proves                                       | Why it is not enough here                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------------------------------------------- |
| Pairing secret + DTLS fingerprint binding (`agent-remote-pairing`) | This **channel** terminates at the peer that knows the secret | Says nothing about where that peer runs                  |
| Device identity keypair + signed challenge (`device-identity.ts`)  | The peer holds a **private key** enrolled earlier             | A key is a file; a file can be copied to another machine |

Both are channel/possession proofs. **Possession is copyable, and "the same computer" is not a
property any copyable artifact can carry.** A shared certificate admits whoever obtained it, from
wherever they run it — which is precisely the failure the issue names.

## The design question

What evidence distinguishes "a peer on this machine, as this user" from "a peer holding this
machine's credential"?

### Alternative A — treat loopback as the proof

Admit only connections observed on `127.0.0.1`/`::1`.

- **For**: requires no new artifact; the address is reported by the OS, not asserted by the peer.
- **Against**: it is a property of the _route_, not the peer. Containers, VMs with host networking,
  and port-forwarding all present as loopback while being a different environment in every sense a
  user cares about. It also cannot distinguish two different USERS on the same host, which matters
  on a shared machine.

### Alternative B — a shared secret in a mode-0600 file under the user's home

Both sessions read the same file; possession of its contents is the proof.

- **For**: trivially implementable; binds to the user account as long as the filesystem permissions
  hold.
- **Against**: **this is the copyable-certificate failure with a different filename.** It is exactly
  what the issue warns about, and it degrades silently — a synced home directory (Dropbox, rsync,
  a container bind-mount) exports the credential to another machine with no signal at either end.

### Alternative C — the kernel NAMES the peer (`SO_PEERCRED`) — **not available, measured**

Read the connecting process's uid/gid/pid from the operating system via `SO_PEERCRED` /
`LOCAL_PEERCRED`.

**This was the original recommendation and it is not implementable in Node.** Probed on this runtime:
a connected `net.Socket`'s handle exposes no `getpeercred` and no peer-credential accessor under any
name — the enumerated handle prototype has zero members matching `/peer|cred/i`. Reaching the syscall
needs a native addon, which this repository does not ship.

Recording it as measured rather than deleting it, because the failure mode it would have produced is
the one worth remembering: the code compiles, a mocked test passes, and **every real peer is
refused**. A security mechanism that is merely inert is worse than none, because the feature above it
looks implemented.

### Alternative C′ — the kernel ENFORCES who can reach the peer (recommended)

The other half of the same kernel guarantee. Rendezvous over a Unix socket inside a directory that is
**owned by this user and mode 0700**: no other account can traverse it, so the kernel refuses the
connection before any protocol runs.

Where `SO_PEERCRED` would say _"the peer is uid N"_, this says _"no uid but ours could have got
here"_ — for an admission decision, the same answer reached from the opposite side. It is what an SSH
agent socket and a Docker socket already rely on.

- **For**: the evidence is still not an artifact the peer supplies, so **there is nothing to copy**,
  and it answers both halves — same machine AND same user. Implementable today, with no addon.
- **Against**: the peer's uid and pid are never learned, so an audit record cannot name the process
  on the other end. Admission does not need that; a diagnostic might, and would need the addon.
- **The sharp edge**: the guarantee is entirely in the directory mode. `0755` looks harmless and
  silently destroys it — every account on the host can then reach the socket, and reaching it proves
  nothing. That is why the mode and owner are validated **before** the socket is bound, and why the
  refusal cases are the larger half of the test suite.

### Alternative D — C′ for the environment proof, then bind the existing channel to it

The recommendation. The kernel-enforced rendezvous establishes the environment and exchanges a
short-lived nonce; that nonce is then bound into the existing pairing confirmation so the WebRTC
channel admitted is provably the same peer that reached the guarded rendezvous.

## Recommendation

**Alternative D, over C′.** It is the only option where the environment claim rests on something the
peer cannot fabricate or carry to another machine, and it reuses rather than replaces the channel
binding that already exists.

The substitution of C′ for C is not a weakening — both rest on the kernel and neither is copyable.
What changed is which side of the guarantee is read, and that was forced by measurement rather than
chosen.

It also keeps the layering the issue asks for: the cryptographic and OS-level proof lives in a
security leaf, `agent-transport-webrtc` consumes a **result** and implements no policy, and
`agent-cli` composes but owns neither.

**A note on scope honesty.** If the environment proof is kernel-vouched, a local peer arguably does
not need WebRTC at all — a Unix socket carries messages perfectly well. The reason to keep the WebRTC
carrier is that #1809's message contract is meant to be transport-neutral and reused by the
cross-computer work in #1808, not because the transport is load-bearing for local peers. That is a
deliberate choice and should be revisited if it turns out to cost more than it saves.

## Failure and revocation semantics

The issue requires these to be defined, not left to implementation:

- **Fail closed before content.** Admission is decided before any session or message frame is
  exposed. A failed proof yields no handler, no pending state, and no partially-initialised channel.
- **Mismatch** (uid differs, or the kernel cannot answer) — reject. An unanswerable credential is a
  rejection, never a pass; the OS not knowing is not the OS approving.
- **Replay** — the nonce is single-use and bound to one connection attempt; a second presentation is
  a rejection, not a re-admission.
- **Timeout** — admission has a bounded window; expiry tears down the rendezvous and the channel.
- **Revocation** — the runtime directory entry IS the grant. Removing it (session exit, explicit
  revoke) ends admissibility for new attempts; existing admitted channels are closed on the owning
  session's shutdown path.
- **Trust limit, documented for the user**: this proves _same machine, same user account_. It does
  not defend against another process running AS THAT USER on that machine. That is the correct
  boundary for a local-peer feature and must be stated rather than implied.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                     | Notes                                                          |
| ----- | ----------- | --------------------------------------------------- | -------------------------------------------------------------- |
| TC-01 | Unit test   | Kernel peer credential read over a real socket pair | The proof is the OS answer; a mocked one would assert nothing  |
| TC-02 | Unit test   | Admission with a mismatched uid                     | Must reject before any handler exists                          |
| TC-03 | Unit test   | Kernel cannot answer (unsupported platform path)    | Unanswerable must reject, not pass                             |
| TC-04 | Unit test   | Nonce replayed on a second attempt                  | Single-use proven, not assumed                                 |
| TC-05 | Unit test   | Timeout during admission                            | No leaked pending state or handler                             |
| TC-06 | Unit test   | Concurrent attempts from two peers                  | Deterministic outcome, no interleaved admission                |
| TC-07 | Unit test   | Revocation: runtime entry removed                   | New attempts refused; the admitted channel closes on shutdown  |
| TC-08 | Integration | Nonce bound into the pairing confirmation           | The admitted WebRTC channel is the peer the kernel vouched for |

## User Execution Test Scenarios

Deferred until the recommendation is accepted, because what a user can run depends on which
alternative is chosen — under A there is nothing to demonstrate beyond a loopback connection, while
under D the observable is two local sessions admitting each other and a third, running as a different
user, being refused. Writing the scenario before that decision would be writing it for a design that
may not be built.

The scenario this item expects to carry, for the recommended alternative: start two `agent-cli`
sessions as the same user, observe mutual admission; start a third under a different account, observe
refusal with no session content exposed. Both halves are agent-executable on a POSIX host without
credentials or network.
