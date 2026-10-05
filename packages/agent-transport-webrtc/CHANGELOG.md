# @robota-sdk/agent-transport-webrtc

## 3.0.0-beta.90
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.90
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.90
  - @robota-sdk/agent-interface-transport@3.0.0-beta.90
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.90
  - @robota-sdk/agent-transport@3.0.0-beta.90

## 3.0.0-beta.89
### Patch Changes

- Updated dependencies [3427887]
  - @robota-sdk/agent-transport@3.0.0-beta.89
  - @robota-sdk/agent-interface-session@3.0.0-beta.89
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.89
  - @robota-sdk/agent-interface-transport@3.0.0-beta.89
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.89

## 3.0.0-beta.88

### Patch Changes

- @robota-sdk/agent-interface-session@3.0.0-beta.88
- @robota-sdk/agent-interface-session-mobility@3.0.0-beta.88
- @robota-sdk/agent-interface-transport@3.0.0-beta.88
- @robota-sdk/agent-remote-pairing@3.0.0-beta.88
- @robota-sdk/agent-transport@3.0.0-beta.88

## 3.0.0-beta.87

### Patch Changes

- Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- Updated dependencies
- Updated dependencies [7d9cc66]
  - @robota-sdk/agent-interface-session@3.0.0-beta.87
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.87
  - @robota-sdk/agent-interface-transport@3.0.0-beta.87
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.87
  - @robota-sdk/agent-transport@3.0.0-beta.87

## 3.0.0-beta.86

### Patch Changes

- @robota-sdk/agent-interface-session@3.0.0-beta.86
- @robota-sdk/agent-interface-session-mobility@3.0.0-beta.86
- @robota-sdk/agent-interface-transport@3.0.0-beta.86
- @robota-sdk/agent-remote-pairing@3.0.0-beta.86
- @robota-sdk/agent-transport@3.0.0-beta.86

## 3.0.0-beta.85

### Patch Changes

- Updated dependencies [9a01e78]
  - @robota-sdk/agent-transport@3.0.0-beta.85
  - @robota-sdk/agent-interface-session@3.0.0-beta.85
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.85
  - @robota-sdk/agent-interface-transport@3.0.0-beta.85
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.85

## 3.0.0-beta.84

### Patch Changes

- 9c6a8db: The wire protocol gained several request/reply pairs so a GUI never has to scrape command output for
  data it can read directly.

  `get-settings`/`update-settings` read and write the Settings screen; a patch applies through the same
  function its matching slash command uses, so the two paths cannot drift. `list-models` returns the
  configured models grouped by provider profile, with the current profile and model. `get-agent-definitions`
  returns the agent switcher's roster and current selection. `project-status`, `project-diff` and
  `project-memory` back the Project panel's git status, one file's diff, and project memory; a host
  without this capability answers `protocol_error` instead of hanging. `rename-session` and
  `delete-session` rename or remove a stored session from the list, current or not, each with its own
  success/failure reply.

  The `messages` frame gained an optional `display` field — the same history projected into display
  segments (text runs and finished tool calls, diffs included) — and the connection's own `driverId`, so
  a reload, reconnect or resume shows tool rows and tells a co-driver's turns from its own. The `error`
  frame gained optional `code`, `provider`, `retryAfterSeconds` and `model` fields so a renderer can say
  what kind of failure happened (`auth`, `rate_limit`, `model_unavailable`, `network`, `provider`) instead
  of showing only raw text; a session error this classification does not recognize is unchanged.

  `TCommandSurfaceLocality` names whether a `'remote'`-sourced command is provably on this machine. The
  WebRTC/device-mesh transport now forwards `'remote'` for it (it proves no locality, the same rule
  already applied to pairing), and both the WS and WebRTC transports forward it into the Settings
  read/write path, so a command that refuses a remote surface (installing a plugin) refuses identically
  regardless of which transport carried it.

- Updated dependencies [e8d70ac]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-interface-session@3.0.0-beta.84
  - @robota-sdk/agent-transport@3.0.0-beta.84
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.84
  - @robota-sdk/agent-interface-transport@3.0.0-beta.84
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.84

## 3.0.0-beta.83

### Minor Changes

- 28fa8a7: `/devices add` and `/devices join` enrol a new device into your devices.

  - On a device that holds the signing key, `/devices add` shows a one-time code on the terminal. It
    works once, for five minutes.
  - On the new device, `/devices join [name]` asks for the code on the terminal, creates the device's
    keys, and meets the other device through the signaling relay in
    `transports.webrtc.options.relayUrl`. Both devices need that setting.
  - The new device proves the code over the WebRTC connection's DTLS fingerprints before anything else
    crosses, so a relay in the middle cannot enrol anyone.
  - Both devices then show the same six digits, and both operators compare them and confirm. Someone
    who saw the code cannot choose the digits: the new device commits to its part before it sees the
    existing device's.
  - Only when both operators say yes does the existing device certify the new one and issue a new
    roster. The new device keeps its identity only once the chain it receives verifies.
  - A wrong, expired or already used code is refused. So is a code after a few failed attempts. When
    either operator declines, nothing is issued or kept.
  - The code appears only on the two terminals. It never reaches history, transcripts or the model. A
    code typed as a command argument is refused. Both commands stay user-only and refuse remote
    surfaces.
  - `agent-remote-pairing`: enrollment codes, the enrollment proof, the signed request with its
    commitment, the short authentication string and the frame decoder.
  - `agent-transport-webrtc`: `dialEnrollment` and `listenForEnrollment` provide a data channel bound to
    the negotiated fingerprints.

- 963a4e0: Where no direct path joins two of one user's devices, a TURN relay on one of the user's own devices carries the
  connection.

  - `agent-transport-webrtc` — `TurnServer`, a pure-JavaScript TURN server over UDP (Allocate, Refresh,
    CreatePermission, ChannelBind, Send/Data indications, ChannelData, long-term credentials) with quotas for
    allocations per owner and in all, relayed bytes per second per owner, and allocation lifetime, and an optional
    relayed-port range for a relay behind a NAT. Only what MESSAGE-INTEGRITY covers is read. Requests nobody has
    authenticated are answered at a limited rate (per source and in all) and never with more bytes than they
    carried, and forwarding into private ranges can be turned off (`allowPrivatePeers`). `MeshTurnRelay` runs it
    for the devices of the roster: each pair derives a short-lived credential of its own (`meshRelayCredential`), a
    device the lists drop or revoke can no longer allocate and loses its allocations. `DeviceMeshNode` takes
    `relays` (the relays paired devices advertise, then configured TURN servers, and `relayOnly`) and
    `relayServer`; a connection that needs a relay and has none is refused with `MeshRelayNeededError`, which says
    why a relay was needed and carries the direct attempt's failure. `MeshDht` publishes this device's relay
    endpoints in the sealed hints records (`relayEndpoints`) and reads the peers' (`relayAdverts`). DTLS stays end
    to end; the relay only forwards it.
  - `agent-remote-pairing` — the pair rendezvous derives a `relay-user` tag and `relayPassword`, the relay
    credential's password for one direction and username.
  - `agent-cli` — `transports.mesh.options` takes `relay` (`serve`, `port`, `host`, `publicAddress`, `relayPorts`,
    `allowPrivatePeers`), `turnServers` and `relayOnly`. When the mesh is on, the session's mesh runs the relay,
    advertises it to paired devices only, and uses the fallback order; `/devices` names the relays, and a device
    that needs a relay is reported once with why. Running a relay, or relay-only without TURN servers, needs the
    DHT or pkarr relays, which carry a relay's address to the other devices; a setting that could not work is
    refused, naming it.

### Patch Changes

- 6e4c6ee: Device mesh discovery holds up better against endpoints and peers that misbehave.

  - A direct path's admission deadline starts only from a `hello`, `offer` or `answer`, so ICE candidates
    that trail an admitted connection no longer set a working path aside.
  - An endpoint or signaling carrier that keeps failing is set aside for longer each time it fails
    again, until a connection over it is admitted.
  - An mDNS lookup keeps listening briefly after the first matching answer, so a faster answer from
    another host cannot hide the peer's own.
  - The device lists read from public records are bounded per paired device, each device's newest
    before any device's next, and the chunks of one list carry a shared version, so a read that finds
    chunks of two versions yields no list. Records written before this change are not read as lists.
  - CLI processes that share `$PRODUCT_USER_STATE_DIR/devices/address-cache.json` apply each change to the file as it
    is on disk, so one process no longer overwrites what another learned.

- 4241fc5: Device mesh follow-ups.

  - A device with no identity is pointed to `/devices add` on one of the user's devices and `/devices join`
    here, as well as to `/devices init`. The message says that `init` is for the first device only,
    because it creates a separate identity that can never link to the user's other devices. The `/devices`
    description and the `init` subcommand say the same.
  - An identity created mid-session (`/devices init`, or a successful `/devices join`) opens the mesh
    without a restart when `transports.mesh.enabled` is on.
  - If a session stalls for longer than the mesh lock's stale window (for example while the machine
    sleeps), another session can take the mesh over. The stalled session now notices this on its next
    lock refresh, closes its own mesh, and says why. Two sessions no longer run it together.
    `holdExclusiveFileLock` has a new `onLost` option for this.
  - `/peers` and `/handoff` still list and reach linked mesh devices when local same-host peer discovery
    fails. `/peers` says why sessions on this host are not listed. `ICommandLocalPeersAdapter` has a new
    optional `localDiscoveryOff` field for this.
  - `agent-transport-webrtc`: when lists become newer on a node (reissued, revoked, or adopted from a
    peer), the node sends them over every admitted connection instead of waiting for the next handshake.
    Reissues, revocations and enrolments in the CLI take effect this way at once. A receiver adopts a
    pushed list only if it is newer, issued by this user's signing key, and verifies. The push does not
    depend on the peer's capabilities, and it never reaches the application's message handlers.

- 05d5391: The embedded TURN relay says why it cannot listen — the port is taken, the host is not an address of
  this machine, or the port needs privileges — and keeps the bind error as `cause`; the CLI names the
  relay setting that cause asks you to change. Mesh options are no longer checked while
  `transports.mesh.enabled` is off, so a mistake in them does not report that the mesh could not start.
- 598b180: A WebRTC peer hands out its own ICE candidates only once it holds the remote description, so an answerer can no
  longer reach the offerer while the answer is still being applied and have its certificate refused. A data channel
  closed right after a send no longer loses that send: it reads closed at once and its stream is reset after a
  grace. A LAN probe answered with anything but a valid proof is dropped at once.
- 57280bf: Every published package now declares `"engines": { "node": ">=22.12.0" }`. Before, 27 of the 38
  packages declared no floor (`agent-core`, `agent-tools` and every provider among them),
  `agent-session` and `agent-file-authority` declared `>=20.19.0`, and the other nine declared
  `>=22.0.0`, so a consumer on Node 20 saw at most a warning from a transitive dependency.

  Why 22.12: `agent-cli` and `agent-ui-terminal` need Node 22 through `ink` 7, and the CommonJS entries
  of `agent-tools` and its dependents, `agent-transport`/`node` and its dependents, and
  `agent-ui-terminal` `require()` ESM-only dependencies (`p-limit`, `jose`, `chalk`), which Node 22
  supports unflagged only from 22.12. `engines` is advisory unless the consumer enables `engine-strict`.

  No code changes: `tsdown` now reads `node22.12.0` as its build target from the field.

- 18c0d5c: Every published package now exports `./package.json`, so `require('<package>/package.json')` and
  `import('<package>/package.json', { with: { type: 'json' } })` work instead of failing with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, and each tarball now ships the package's `CHANGELOG.md`.
- Updated dependencies [724fabb]
- Updated dependencies [d877de2]
- Updated dependencies [d61e159]
- Updated dependencies [bfe8ed5]
- Updated dependencies [28fa8a7]
- Updated dependencies [963a4e0]
- Updated dependencies [7b72344]
- Updated dependencies [6ae3f28]
- Updated dependencies [57f57f5]
- Updated dependencies [ba822c1]
- Updated dependencies [6e6b06b]
- Updated dependencies [57280bf]
- Updated dependencies [18c0d5c]
  - @robota-sdk/agent-interface-transport@3.0.0-beta.83
  - @robota-sdk/agent-transport@3.0.0-beta.83
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.83
  - @robota-sdk/agent-interface-session@3.0.0-beta.83
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.83

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
    identity under `$PRODUCT_USER_STATE_DIR/devices`, saving newer lists a peer hands over; no command starts it yet.
  - `agent-command` — `/devices add|join` still reports that enrolment is not available yet.

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

- c7f9203: Connected sessions can send each other files.

  - `/peers send-file <session-id> <path>` sends a copy of any file the operator can read to another
    live session on this host.
  - The model sends a file only through the `peer_send_file` tool. Every call asks the user, showing
    the path, size, hash and destination; no permission mode, rule or remembered consent answers it.
    The tool reaches only files inside the workspace whose path does not look like it holds secrets
    (`.env*`, `~/.ssh`, keys and credentials), and it does not exist in a turn a peer's message started.
  - The receiving operator approves every file. A received file is kept as an inert copy (mode 0600)
    under `$PRODUCT_USER_STATE_DIR/peer-files/<sender>/`. It is never run and never placed in the model's context.
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

- 004fe7f: `/handoff` moves a session over a real connection.

  - `/handoff <session-id>` pushes this conversation to another __PRODUCT_DISPLAY_NAME__ session on this machine. The
    same carrier also runs between two of the user's devices over their mesh connection; no command
    opens that connection yet.
  - A hand-off is push-only: only the operator of the session that holds it starts one. A session or
    device that asks another for its session is refused.
  - The source signs a grant for that one transfer over that one channel with its device key, so a
    hand-off needs the device identity from `/devices init`. The receiving side checks it against the
    sender's certificate, then asks its own operator; without a yes nothing is sent.
  - The session travels on the file-transfer carrier, is kept aside until it matches the manifest, and
    is saved without being started. The operator there resumes it with `__PRODUCT_CLI_NAME__ --resume <id>`.
  - The source gives the session up, and ends, only once the receiving side confirms it saved it.
    Every other outcome leaves the session where it was; if the confirmation is lost, `/handoff` to the
    same session again resends the same transfer, which the receiver settles without saving it twice.
    Peer attribution (`driverId`, `turnSource`)
    travels with it.
  - `/handoff` stays user-only. Its description tells the model to suggest the command to the user.
  - `agent-transport-webrtc`: an admitted mesh link exposes the DTLS fingerprints it is bound to, and
    `judgeHandoffGrant` is exported.
  - `agent-interface-session-mobility`: a hand-off carrier may move the sealed payload whole
    (`sendPayload`), the destination verifies it with `receivePayload`, and the source can report its
    open transfer (`status`) and abandon it for any refusal the destination names.

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
    the addresses that worked in an owner-only `$PRODUCT_USER_STATE_DIR/devices/address-cache.json`; no command starts
    it yet.

### Patch Changes

- Updated dependencies [e15e22b]
- Updated dependencies [e15e22b]
- Updated dependencies [c7f9203]
- Updated dependencies [004fe7f]
- Updated dependencies [189c21e]
- Updated dependencies [5e924ee]
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.82
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.82
  - @robota-sdk/agent-transport@3.0.0-beta.82
  - @robota-sdk/agent-interface-session@3.0.0-beta.82
  - @robota-sdk/agent-interface-transport@3.0.0-beta.82

## 3.0.0-beta.81

### Minor Changes

- 007fd90: Authority per connection: pairing stays with the local operator, and driving needs the operator's yes.

  - `agent-interface-session-mobility` — `ConnectionAuthority` decides what one connection may do.
    `presence` and `message` are allowed; `delegate` and `handoff` ask the receiving operator for every
    request; `observe` and `drive` ask once per connection. With no `IOperatorApprover` the answer is
    no. `authorizeDelegation` turns an approved task into a peer turn from where admission placed the
    peer, ignoring anything else on the request, so the receiver's policy decides what it may do.
  - `agent-transport-webrtc` — `connectionApproval` asks the operator before a connection reaches the
    session, after every proof has run. Frames the peer sends meanwhile are held (bounded) and delivered
    only after a yes. A channel that closes first withdraws the question (the approval context carries
    an `AbortSignal`), and a later answer admits nothing. A first-pairing device is pinned for
    reconnect only once it is admitted.
  - `agent-command` — `/remote-control enable` and `revoke` from a connected surface are refused, and
    `status` never shows a connected surface the pairing link.
  - `agent-framework` — the `remote-control-enable` host action runs only for the operator's own
    command, whichever command asked for it.
  - `agent-cli` — every remote-control connection, a returning trusted device included, is put to the
    operator on the host terminal; without an interactive terminal it is refused.

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [b2e0afe]
- Updated dependencies [44fc732]
- Updated dependencies [007fd90]
  - @robota-sdk/agent-interface-session@3.0.0-beta.81
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.81
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.81
  - @robota-sdk/agent-interface-transport@3.0.0-beta.81
  - @robota-sdk/agent-transport@3.0.0-beta.81

## 3.0.0-beta.80

### Major Changes

- e82215f: **ARCH-011: replace the ambiguous transport lifecycle stub with executable conformance.**

  `ITransportAdapter` now requires a frozen `service | runner` lifecycle descriptor. `start()` resolves
  at the concrete transport's documented readiness boundary; start before attach and repeated active
  start reject a stable lifecycle error, repeated stop is safe, and stopped adapters can reattach and
  restart.

  Runner adapters launch separately and expose a typed terminal outcome through
  `waitForCompletion()`. The registry accepts base adapters, rejects duplicate names, keeps
  configuration as an optional capability, returns complete ordered records whose pending slots become
  registry-owned `abandoned` outcomes on stop/rollback, and exposes a real-runner-only first-failure
  wait. It serializes startup/stop, rejects active restart before mutation, and reverses partial startup
  from the currently failing adapter with typed safe rollback details. Runtime host and serve mode
  propagate real nonzero runner results without treating normal shutdown abandonment as failure.

  HTTP, MCP, both WebSocket adapters, WebRTC, and headless invoke one shared public conformance kit.
  The former `TuiTransport` export is removed because it ignored the attached session; use `renderApp`
  or `TuiInteractionChannel`, which honestly own their session lifecycle.

### Minor Changes

- 9db63ee: Add named session capability roles and explicit capability-host queries while preserving the legacy
  `IInteractiveSession` interface shape. HTTP, MCP, protocol, WS, WebRTC, and headless transports now
  declare only the session roles they consume, and the direct aggregate-cast floor is zero.
- 2ebff01: Emit the complete persisted checkpoint and branch lifecycle, forward plan, context-refresh, and
  branch events through protocol transports, and render deterministic bounded notices in the TUI.
  Transport-owned delivery failures now enter the owning carrier cleanup lifecycle without reversing
  an already-committed session operation.
- 94cc355: REMOTE-002 Stage A: extract the transport-neutral session bridge + wire protocol into a new
  `@robota-sdk/agent-transport-protocol` package (`createWsHandler`, `TClientMessage`/`TServerMessage`); repoint
  `agent-transport-ws` and `agent-web-ui` at it (no pass-through re-export). Add a new
  `@robota-sdk/agent-transport-webrtc` package: a `WebRtcTransport` (`IConfigurableTransport`, `defaultEnabled:false`)
  that carries an `IInteractiveSession` over an `RTCDataChannel` reusing the shared handler, with a lazily-loaded
  optional `werift` peer dependency that throws an explicit "WebRTC transport unavailable" error on absence (never a
  silent no-op). No user-facing enable path and no auth in Stage A (that lands in Stage B); the transport is proven
  by an in-process loopback data-channel round-trip only.

  (Bump target corrected during REL-023 triage: `@robota-sdk/agent-web-ui` was dissolved by GUI-006 (#1141, 2026-07-12) before this work was ever published; its protocol-consumer role now lives in `@robota-sdk/agent-transport-webrtc-web`.)

- 2c69a3f: REMOTE-004 Stage B2: production WebRTC signaling + relay abuse-hardening (still no user-facing enable path).

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

- 92bf33e: Add the pairing gate to the WebRTC transport (REMOTE-008 Step 1, security milestone). When a pairing
  `secret` is configured, the data channel is phase-separated: pre-accept it carries only pairing frames
  (routed to the directional-HMAC handshake bound to the DTLS fingerprints; any non-pairing frame is
  dropped), and only after the handshake accepts is the session bridge built — fail closed on
  mismatch/timeout (channel closed, session never exposed). Without a `secret` the channel is exposed
  immediately, unchanged. Introduces a dependency on the zero-dep `@robota-sdk/agent-remote-pairing` leaf
  (the gate must live where the SDP fingerprints and channel frames are visible).
- 9f602df: Add user-supplied TURN fallback for remote control (REMOTE-010 / Stage E1) so P2P works behind symmetric
  NAT / restrictive firewalls. The host reads + validates `transports.webrtc.options.iceServers`/`forceTurn`
  at the agent-cli composition root (a fail-closed validator narrowing the untyped value → `IIceServer[]`;
  `IWebRtcTransportOptions.iceServers` widened to carry TURN `username`/`credential`), and the browser reads a
  validated `ice`/`forceTurn` pairing-URL query param (fail-closed decoder for the attacker-influenceable value;
  `forceTurn` → `iceTransportPolicy: 'relay'`) — both threaded into their `RTCPeerConnection`. `forceTurn` without
  a TURN server fails closed (else ICE gathers no candidates and silently never connects). Absent ICE config ⇒
  host-candidate-only, unchanged.

  (Bump target corrected during REL-023 triage: `@robota-sdk/agent-web-ui` was dissolved by GUI-006 (#1141, 2026-07-12) before this work was ever published; the browser-side ICE/`forceTurn` handling described here now lives in `@robota-sdk/agent-transport-webrtc-web`.)

### Patch Changes

- 235da81: **BREAKING — ARCH-030: `createWsHandler` takes the carrier's delivery boundary, not a raw `send`.**

  `createWsHandler` had two outbound semantics on one connection. The session-event fan-out went through
  a guard that reported carrier failures through `onDeliveryError`; every reply to an inbound frame got
  the raw `send`. Eleven reply families were unguarded — five resolving from a Promise continuation, so a
  reply landing after a disconnect escaped as an **unhandled rejection** while the carrier's cleanup was
  never notified, and six synchronous ones that threw into the carrier's inbound listener instead.

  `IWsHandlerOptions` now takes a single `deliver: TOutboundDeliver` in place of `send` and
  `onDeliveryError`. **The carrier builds the boundary** from its own sink and its own failure policy and
  passes it down — not the reverse, because a protocol layer handed a raw sink so it can hand a wrapper
  back leaves the raw sink reachable, which is how the twelfth reply family gets added unguarded.

  ```ts
  // before
  const { onMessage, cleanup } = createWsHandler({
    session,
    send: (msg) => ws.send(JSON.stringify(msg)),
    onDeliveryError: (error) => ws.close(1011, error.message),
  });

  // after
  const deliver = createOutboundDelivery(
    (msg) => ws.send(JSON.stringify(msg)),
    (error) => ws.close(1011, error.message),
  );
  const { onMessage, cleanup } = createWsHandler({ session, deliver });
  ```

  `TOutboundDeliver` is branded and `createOutboundDelivery` is its only producer, so a plain
  `(message: TServerMessage) => void` is refused by the compiler wherever a boundary is required.

  **The boundary latches:** it reports at most one delivery failure per connection, after which frames are
  dropped without a further report. All three carriers already treated a delivery failure as terminal and
  each had grown its own latch; it belongs upstream of all three. `SessionResumeBridge` builds a fresh
  boundary per `attach`, which is what un-latches the session after a reconnect, and buffers a frame
  before the boundary so a dropped one still replays.

  **`ISubscribeSessionEventsOptions` is no longer exported** from the package barrel. It is the options bag
  of `subscribeSessionEvents`, which is package-internal, and it was already absent from the SPEC's public
  API table. Its `onDeliveryError` member is gone regardless — carrier-failure containment is the
  boundary's job now.

  `agent-transport-ws` and `agent-transport-webrtc` are `patch`: `WsSessionDelivery` (whose raw `send` is
  now private, with `deliver` the only public sink) and `PairingGate` are not on their packages' barrels,
  and every barrel export of both packages keeps its signature.

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- 2db1b97: Remote-control pairing binds to the negotiated DTLS certificate.

  - The Node host reads the remote fingerprint from the certificate the DTLS layer verified, not from the answer's
    SDP text, and builds the pairing gate once the DTLS handshake completes.
  - An SDP must advertise exactly one DTLS fingerprint. `extractDtlsFingerprint` now throws when two different
    fingerprints are present, and `extractDtlsFingerprintAttribute` returns the algorithm with the value.
  - A start takes one answer (host) and a connection takes one offer (browser client); a later description is
    ignored.

- Updated dependencies [37b4bd7]
- Updated dependencies [50d2c9f]
- Updated dependencies [a5961c9]
- Updated dependencies [4dd45cc]
- Updated dependencies [040f31f]
- Updated dependencies [4c5148e]
- Updated dependencies [0116a29]
- Updated dependencies [e82215f]
- Updated dependencies [52b7346]
- Updated dependencies [9db63ee]
- Updated dependencies [b078afa]
- Updated dependencies [2ebff01]
- Updated dependencies [9db63ee]
- Updated dependencies [2ebff01]
- Updated dependencies [4772067]
- Updated dependencies [0f98419]
- Updated dependencies [64ba748]
- Updated dependencies [d312755]
- Updated dependencies [3244fb8]
- Updated dependencies [1e3f91a]
- Updated dependencies [4f3c075]
- Updated dependencies [1e40b5b]
- Updated dependencies [7669851]
- Updated dependencies [4b76cfa]
- Updated dependencies [2db1b97]
- Updated dependencies [07b627f]
- Updated dependencies [1f45110]
- Updated dependencies [9665c6e]
- Updated dependencies [44393be]
- Updated dependencies [c7fa299]
- Updated dependencies [5134b3b]
- Updated dependencies [833afe1]
- Updated dependencies [5c5ff23]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-interface-session@3.0.0-beta.80
  - @robota-sdk/agent-interface-transport@3.0.0-beta.80
  - @robota-sdk/agent-transport@3.0.0-beta.80
  - @robota-sdk/agent-interface-session-mobility@3.0.0-beta.80
  - @robota-sdk/agent-remote-pairing@3.0.0-beta.80
