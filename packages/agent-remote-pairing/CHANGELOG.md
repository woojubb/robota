# @robota-sdk/agent-remote-pairing

## 3.0.0-beta.82

### Minor Changes

- e15e22b: Two of one user's devices can connect to each other over WebRTC, admitted by the device handshake.

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

- c7f9203: Connected sessions can send each other files.

  - `/peers send-file <session-id> <path>` sends a copy of any file the operator can read to another
    live session on this host.
  - The model sends a file only through the `peer_send_file` tool. Every call asks the user, showing
    the path, size, hash and destination; no permission mode, rule or remembered consent answers it.
    The tool reaches only files inside the workspace whose path does not look like it holds secrets
    (`.env*`, `~/.ssh`, keys and credentials), and it does not exist in a turn a peer's message started.
  - The receiving operator approves every file. A received file is kept as an inert copy (mode 0600)
    under `~/.robota/peer-files/<sender>/`. It is never run and never placed in the model's context.
    The conversation is told only its name, size and sha256. A name that leaves that directory is
    refused, a symbolic link is never written through, and nothing is overwritten.
  - Transfers travel on a channel of their own (a separate connection on this host, a separate data
    channel between devices), in chunks the receiver paces, up to 32 MiB, and are kept only when the
    whole content matches the offered sha256. A transfer that ends early is discarded; there is no
    resume.

  **API**

  - `agent-interface-session-mobility`: the `file` capability, which asks the operator for every
    request; `ConnectionAuthority.authorizeFile`; `IFileOffer` and `IFileFrameChannel`.
  - `agent-transport/node`: `sendFileOverChannel` and `receiveFileOverChannel`, the carrier over any
    `IFileFrameChannel`; `DEFAULT_MAX_FILE_BYTES`.
  - `agent-transport-webrtc`: `IDeviceMeshLink.openFileChannel` and `onFileChannel`.
  - `agent-remote-pairing`: `file` joins `DEVICE_CAPABILITIES`. A device certificate that names it is
    refused as malformed by an earlier version.
  - `agent-core`: `IToolPermissionProfile.notInPeerTurn` withholds a tool from a turn a peer's message
    started.
  - `agent-framework`: `ICommandLocalPeersAdapter.prepareFile`.

- 189c21e: The device mesh can find and signal a peer device beyond the local network, through public
  infrastructure that sees only signed ciphertext.

  - **Rendezvous records (BEP 44):** each device publishes, per peer, its connection hints and the newest
    device revocation lists it holds as mutable items on the BitTorrent Mainline DHT (`bittorrent-dht`,
    directly over UDP), or through pkarr relays (`createPkarrRelayStore`, for clients that cannot reach
    the DHT). Every record is signed by a one-time key of the pair, direction, epoch and purpose, stored
    under a rotating salt, AEAD-sealed and padded to a fixed size; publish times are jittered per pair.
    Lookups read the peer's records at the current and adjacent epochs and reject anything that does not
    verify or open for the pair. Lists too large for one record are split into fixed-size chunks.
    `MeshDht` is the candidate source and publisher, and its `latestLists` feeds the freshness lookup
    before a remote admission with every list candidate found, newest first.
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
    (`hints`, the default and unchanged; `revocation`; `signal`), and two tag purposes are added. The
    device handshake's `fetchLatestLists` may return several candidates per list kind; each is verified
    and the newest that verifies counts, so a forged "newer" list cannot hide a real one.
  - `agent-cli` declares the mesh's runtime dependencies (`bittorrent-dht`, `nostr-tools`,
    `multicast-dns`), which its bundle leaves external.

  **Breaking (pre-release, hence minor):** `IDiscoveringMeshRelayOptions.advertiser` becomes
  `advertisers` (a list).

- 5e924ee: Two of one user's devices can find each other on the local network before the relay.

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

### Patch Changes

- e15e22b: The Node WebRTC transport runs on `node-datachannel` (libdatachannel, DTLS by OpenSSL). The DTLS stack
  verifies handshake signatures, so a channel binding names the party that holds the certificate's key.
  It is an optional dependency with a prebuilt binary per platform; where it cannot load, the WebRTC
  transport reports itself unavailable instead of falling back to another implementation.

  - `agent-transport-webrtc` — `RtcPeer` / `RtcChannel` wrap one connection; `loadDataChannel` replaces
    `loadWerift` (and the `loadWerift` option becomes `loadDataChannel`). Every connection has its own DTLS
    certificate, no ICE server is contacted unless configured, and `werift` is no longer a peer dependency.
    A pairing peer that finishes the handshake first and speaks at once no longer has that frame dropped: it
    is held until this side accepts, and discarded if it does not.
  - `agent-cli` — depends on `node-datachannel` (optional) instead of `werift`.

## 3.0.0-beta.81

### Minor Changes

- b2e0afe: Two of one user's devices can admit each other over a channel bound to its negotiated DTLS
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

- 44fc732: Add `/devices` for this device's identity among the user's devices: `list`, `init` (creates the identity: a recovery phrase, the master-certified signing key, this device's keys and certificate, the first roster and revocation list), `revoke <device-id>` (signing key only, no phrase; confirmed at the terminal) and `recover` (rotates the signing key from the phrase and revokes the old ones). Enrolling another device (`add` / `join`) comes with the device connection.

  The recovery phrase never enters the session: it is shown once and read with no echo on the controlling terminal (opened apart from the session's input), on the alternate screen that is cleared afterwards, and never reaches prompt history, conversation history, transcripts, traces or the model. Without an interactive terminal the phrase commands refuse. `/devices` is operator-only: never model-invocable and refused from remote surfaces. Private keys live in the host credential store; certificates, roster, revocation lists and sequence marks are kept in owner-only files under `~/.robota/devices`.

  `agent-remote-pairing` adds `isRecoveryPhraseWord`, so a phrase can be checked one word at a time.

## 3.0.0-beta.80

### Minor Changes

- 040f31f: Add the three-tier identity primitives: a master key derived from a 24-word recovery phrase (BIP39, SLIP-0010 Ed25519) and never stored, signing-key and device certificates, signed rosters and revocation lists with rollback protection, session descriptors, and `verifyDeviceChain`. Every signature carries a purpose tag and one canonical encoding, and malformed input is refused with a closed reason rather than a throw.
- 1f45110: REMOTE-005 Stage B3: add the isomorphic `@robota-sdk/agent-remote-pairing` package — pairing + DTLS-fingerprint
  channel binding for P2P remote-control (no user-facing enable path; that is B4).

  A high-entropy (256-bit) single-use pairing secret (QR / deep link) replaces the parent design's SPAKE2 — a PAKE
  is unnecessary for a machine-transferred high-entropy secret. Authentication + MITM-relay detection is a
  **directional, nonce-bound HMAC key-confirmation bound to both DTLS fingerprints** (`HMAC(HKDF(secret),
LABEL[role] ‖ nonces ‖ sortedPair(localFp, remoteFp))`): reflection-safe (distinct initiator/responder labels),
  replay-safe (fresh nonces), and MITM-detecting (a relay's substituted fingerprint makes the peers' pairs differ).
  WebCrypto only, zero workspace deps, no `node:` imports — reusable unchanged by the Stage-D browser client. Ships
  secret/nonce/URL helpers, `extractDtlsFingerprint`, a domain-separated `deriveSessionKey`, and a fail-closed
  `startPairingHandshake` (rejects on mismatch/timeout).

### Patch Changes

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- 2db1b97: Remote-control pairing binds to the negotiated DTLS certificate.

  - The Node host reads the remote fingerprint from the certificate the DTLS layer verified, not from the answer's
    SDP text, and builds the pairing gate once the DTLS handshake completes.
  - An SDP must advertise exactly one DTLS fingerprint. `extractDtlsFingerprint` now throws when two different
    fingerprints are present, and `extractDtlsFingerprintAttribute` returns the algorithm with the value.
  - A start takes one answer (host) and a connection takes one offer (browser client); a later description is
    ignored.

- 833afe1: Remove the remaining polynomial-ReDoS backtracking (SEC-003, CodeQL `js/polynomial-redos`) and stop the DTLS fingerprint binding to SDP free text.

  **`extractDtlsFingerprint` (agent-remote-pairing) — remote-reachable, pre-authentication.** Unlike the rest of this class, the SDP it parses arrives over the signaling relay, which the pairing design treats as untrusted, and it is parsed _before_ the channel-binding confirmation — on the browser peer, before `setRemoteDescription` too. Unanchored, `a=fingerprint:\S+\s+…` restarted from every offset in a non-space run: 5.0 s on a 400 KB SDP. It is now anchored to the start of an SDP line (`/^…/m`), which is linear and also stops the extractor from returning a value smuggled into another line's free text (`s=`, `i=`, an unrelated attribute) — text no DTLS stack reads, and which a relay controls. **Behaviour change:** a mid-line `a=fingerprint:` is no longer recognised. Every SDP a WebRTC stack emits puts the attribute at the start of its own line, so no real SDP is affected. A session-level line can still shadow a media-level one; that residual is recorded in the SEC-003 backlog.

  **Trailing-run trims (agent-framework, agent-cli, agent-tools).** `replace(/-+$/, '')`-shaped regexes have no start anchor, so the engine retried the run from every offset inside it and each retry rescanned to the end — 3.0 s at 100 K characters, ~50 s at 400 K. The memory topic sanitiser, the provider profile-name sanitiser, the model-command tool-name projection, the npm registry URL builder, the git-worktree path-segment sanitiser and the sandbox-root normaliser now use linear index scans (`trimEdgeChars` / `trimTrailingChars` in agent-framework, local helpers elsewhere), proven equivalent to the regexes they replace over every string of the relevant alphabet up to 12 characters.

  **Whitespace-ambiguity parsers (agent-framework).** The skill and agent-definition frontmatter list splitters used `/\s*,\s*/`, whose whitespace run overlapped nothing after it on a failed comma — 12.6 s on a 200 K run. They now split on `','`; the padding was already removed by the `.trim()` that follows, so the parsed lists are unchanged. The `.git` `gitdir:` pointer and the task-file open-item matcher used `\s*(.+)$` / `\s+(.+)$`, where `\s` and `.` both match a space; the capture is now pinned to start non-space, which accepts exactly the same inputs (verified exhaustively) and removes 14.5 s and 15.4 s worst cases.

  **`WebFetch` HTML-to-text (agent-tools) — carried no CodeQL alert.** Found by sweeping for the same shapes rather than the flagged lines, and the only quadratic here whose input is a live response body from an arbitrary URL. `<[^>]+>`, `<script[\s\S]*?</script>` and `<style…>` each restarted from every opener that had no terminator: 12.6 s on 200 KB of `<`, and the 5 MB the fetch allows would have taken hours. All three are now single-pass scans, verified character-for-character identical to the regexes over ~800 K generated inputs.

  Apart from the `extractDtlsFingerprint` anchoring noted above, no behaviour changes: every fix accepts the same inputs and produces the same values, and each ships an equivalence test pinning that.
