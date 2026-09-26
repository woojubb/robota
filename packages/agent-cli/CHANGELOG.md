# @robota-sdk/agent-cli

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

- 004fe7f: `/handoff` moves a session over a real connection.

  - `/handoff <session-id>` pushes this conversation to another Robota session on this machine. The
    same carrier also runs between two of the user's devices over their mesh connection; no command
    opens that connection yet.
  - A hand-off is push-only: only the operator of the session that holds it starts one. A session or
    device that asks another for its session is refused.
  - The source signs a grant for that one transfer over that one channel with its device key, so a
    hand-off needs the device identity from `/devices init`. The receiving side checks it against the
    sender's certificate, then asks its own operator; without a yes nothing is sent.
  - The session travels on the file-transfer carrier, is kept aside until it matches the manifest, and
    is saved without being started. The operator there resumes it with `robota --resume <id>`.
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
    the addresses that worked in an owner-only `~/.robota/devices/address-cache.json`; no command starts
    it yet.

## 3.0.0-beta.81

### Minor Changes

- 3038eb7: A message from another session is instant messaging: text from an untrusted third party that
  carries no authority. What the model does with it is decided by the session's ordinary permissions —
  rules, permission mode and remembered consent — exactly like the session's own work. The per-origin
  peer policy is gone.

  **BREAKING**

  - `agent-core`: `IPermissionEvaluationContext.peerTurn` is now a boolean. It decides only whether a
    `repliesToPeer` tool exists; every other call in a peer turn is decided as in any turn. Removed:
    `isToolAvailableInPeerTurn`, `isSecretPath`, `IPeerTurnAuthority`, `TPeerReach` (now exported by
    `agent-interface-session-mobility`) and `IToolPermissionProfile.workspacePaths`.
  - `agent-tools`: `Read` and `Glob` no longer declare `workspacePaths`.
  - `agent-session`: `ISessionRunOptions.peerReach` is replaced by `peerTurn?: boolean`, and
    `ISessionOptions.allowPeerChanges` is removed. An ask in a peer turn is answered like any other:
    a consent the operator remembered answers it, and an "always allow" given there is remembered.
  - `agent-interface-session`: `IPeerTurnContext` no longer has `reach`; it carries only the reply
    route.
  - `agent-interface-session-mobility`: `peerReachOf` is removed; `TPeerReach` moves here. A delegated
    turn carries no reach.
  - `agent-framework`: the `peers.allowChanges` setting is removed (an existing value is ignored). A
    peer turn is offered the ordinary tools, plus `peer_reply`.

  **Changes**

  - `agent-framework`: the per-turn statement tells the model the message is an opinion from an
    untrusted third party, not its owner's instruction, and that it decides for itself whether and how
    to act. A message still expands no `@path` and attaches no context reference, and its requests
    still carry no provider-hosted tool, since no permission step can decide one. The session takes
    at most 6 messages a minute and 30 an hour from each sender for a turn; a message over the limit
    is refused with a reason the sender receives. A prompt answer given in the name of a `peer:` or `external:`
    driver is ignored. External-event turns keep their tool-less baseline.
  - `agent-cli`: incoming peer turns carry only their reply route.

- ec5e477: Add a credential store port (`ICredentialStore` in `agent-core`) and keep the CLI's secrets behind it: the OS keychain through the optional `@napi-rs/keyring` binding (macOS Keychain, Windows Credential Manager, Linux Secret Service), else an owner-only file under `~/.robota/credentials`. The backend is chosen at first use, recorded, and named by `/remote-control status`; a recorded keychain that stops working fails closed instead of degrading to the file.

  The remote-control host identity key moves into the store. The old `~/.robota/remote-host-identity.json` may have been copied by backups or dotfile sync, so it is not carried over: on the first run after upgrading a new host key is generated, the old file is removed, and the operator is told once that trusted devices must pair again.

- 44fc732: Add `/devices` for this device's identity among the user's devices: `list`, `init` (creates the identity: a recovery phrase, the master-certified signing key, this device's keys and certificate, the first roster and revocation list), `revoke <device-id>` (signing key only, no phrase; confirmed at the terminal) and `recover` (rotates the signing key from the phrase and revokes the old ones). Enrolling another device (`add` / `join`) comes with the device connection.

  The recovery phrase never enters the session: it is shown once and read with no echo on the controlling terminal (opened apart from the session's input), on the alternate screen that is cleared afterwards, and never reaches prompt history, conversation history, transcripts, traces or the model. Without an interactive terminal the phrase commands refuse. `/devices` is operator-only: never model-invocable and refused from remote surfaces. Private keys live in the host credential store; certificates, roster, revocation lists and sequence marks are kept in owner-only files under `~/.robota/devices`.

  `agent-remote-pairing` adds `isRecoveryPhraseWord`, so a phrase can be checked one word at a time.

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

- 18b52cc: Built-in commands are offered to the model deliberately, each described for the model, and never
  with a trust, credential or permission-widening action.

  - `agent-interface-command` — `ICommand` gains `modelDescription?` (what the model is told, beside the
    short `/help` line), and `modelInvocable` on a subcommand entry now narrows what the model may run.
  - `agent-framework` — `ISystemCommand` gains `modelDescription?` and `modelRequiresPermission?`.
    Once any subcommand of a model-invocable command declares `modelInvocable`, the model may run only
    the bare command and the subcommands declared `true`; everything else, including an alias or an
    undeclared subcommand, is refused before the command runs. The model-facing descriptor lists only
    that subset. A model-requested monitor's command is now decided by the shell tool's gate (its
    Bash/Shell rules, the mode and the prompt) and a refusal rejects with the new
    `MonitorCommandRefusedError`. The `scriptedSession` test harness accepts `permissions` patterns.
  - `agent-session` — `Session.checkToolPermission(toolName, toolArgs)` decides an action that has a
    tool's effect by another route: that tool's PreToolUse hooks, then the gate's rules, mode,
    remembered consent and prompt — never the command sandbox's auto-approval, since the action does
    not run inside the sandbox.
  - `agent-framework` also: `ICommandMCPActivationAdapter.userActionSurface?` tells `/mcp` whether the
    user can type a session command, so the model's status names the terminal sign-in otherwise.
  - `agent-command` — `/context` (bare and `list`), `/cost` (the report, not `budget`) and `/mcp`
    (`status` only, without a prompt) are now model-invocable; `/memory approve` and `/memory reject`
    are now user-only; the model's `/monitor` is decided by the shell gate rather than by consent to
    the command's name. Every model-invocable command carries a model-facing description. The model's
    `/mcp status` shows only safe names, states and the command to suggest, and a caller that does not
    identify itself gets that view. `/context list` accounts only for turns still in context. New
    `mcpUserActionNotice`, `mcpUserActionCommand` and `mcpUnavailableServersNotice` build the fixed
    notices.
  - `agent-command-workflows` — `/workflows` carries a model-facing description.
  - `agent-mcp` — `createDiscoveredTool` accepts `authFailureNotice`: a call the server refuses for
    authentication returns that host text instead of the generic failure.
  - `agent-cli` — an MCP server that did not start because the user must approve it, trust the
    workspace or sign in is named to the model at the start of an interactive session with the
    command to suggest, and a
    signed-in OAuth server that refuses a call tells the model to suggest `/mcp login <server>` — or, in print and serve runs, the terminal
    `robota mcp login <server>`.

  A command whose bare form is a complete action declares `runsBare`, so choosing `/cost` or `/mcp`
  from the autocomplete menu still runs it even though they now declare subcommands.

- 9843fe6: Sign in to a remote MCP server from inside a session, and use its tools without restarting.

  - **`/mcp login <server> [--no-browser]`** runs the same per-server OAuth sign-in as
    `robota mcp login` (discovery checks, PKCE, `state`, RFC 9207 `iss`, RFC 8707 resource, the
    loopback listener, the lock-guarded store). It opens the browser through the argv opener; with
    `--no-browser`, or when no browser can be opened, it shows the authorization URL and asks for the
    redirect URL in the session's own prompt (masked), held to the same rules as a pasted redirect in
    the terminal. A failed, refused, timed-out or cancelled sign-in changes nothing and is reported by
    a fixed reason only. `/mcp login <server> --client-secret` is refused: a secret is never typed into
    a session, and `robota mcp login <server> --client-secret` is named instead (also after a failed
    token exchange for a pre-registered client). `/mcp` stays user-only (`modelInvocable: false`).
  - **Connected in the same session:** after a sign-in, a server that could not connect for want of
    one goes through the normal admission (approval, fingerprint, trust) and connects, and its tools
    are offered from the next message; a server that was already connected is admitted again and
    reconnects, and its authenticator drops what it held and reads the new credential. A tool left out
    because the session already has its name is reported, and only tools actually added get
    provenance. In browser mode the authorization URL is shown in the session prompt before the
    browser opens, where the user can also choose to paste the redirect instead or cancel.
  - **`runMCPOAuthLogin`** takes `readRedirectWhenBrowserFails`: when `openBrowser` rejects, the
    loopback listener stops and the pasted redirect is read instead, for the same redirect URI. The
    loopback listener's time limit now runs from its first `wait()` — once the authorization page is
    handed over — so time spent at a prompt before the browser opens does not count against it.
  - **`Session.addTools`** (and `ICommandSessionTools.addTools`) offers tools that became usable
    mid-session, through the same permission gate and — via `ISessionOptions.wrapAddedTools`, which
    `createSession` sets — the same edit-checkpoint and reversible-execution wraps as the assembled
    tools. A name the session already has is left out, never replaced. Calls are serialized, and tools
    added while a turn runs are applied when the next turn starts, so a turn's rounds all see one
    tool list and the prompt cache misses once, at that boundary.
  - **Breaking (`agent-framework`, major):** `addTools` is a new required member of the
    `ICommandSessionTools` role port (and so of `ICommandSessionRuntime`). A host that implements the
    port itself must add it; one that passes an `agent-session` `Session` already has it.
  - **`ICommandMCPActivationAdapter.oauthLogin`** (`ICommandMCPOAuthLoginRequest`,
    `ICommandMCPOAuthLoginResult`, `ICommandMCPOAuthRedirectPrompt`) is the port behind it.
  - The sign-in notice and `/mcp status` now suggest `/mcp login <server>` in a session and
    `robota mcp login <server>` in a terminal; the server's name is shown only when it is safe to paste
    into any shell, otherwise `<server>`.

### Patch Changes

- 02b7452: A reply to a peer session is decided by the permission system like any call that sends something
  off this machine, and it goes only to the sender that was admitted.

  - `agent-core` — a tool declaring `repliesToPeer` is still refused outside a peer turn; inside one it
    is decided by the ordinary steps: deny, ask and allow rules, then the mode. It declares no risk
    class, so it asks by default, is refused in plan mode and proceeds under bypass. `IPeerTurnAuthority`
    no longer has `toolUsed`.
  - `agent-session` — an "always allow" answer to the reply is remembered and answers later replies,
    as for any tool; other asks in a peer turn still need a fresh approval each time.
  - `agent-framework` — `peer_reply` asks the operator by default, showing the full text and the peer
    it goes to; `permissions.allow`/`deny` rules naming `peer_reply` apply. `PeerMessageIngress`
    refuses a message whose origin names a sender other than the admitted one, or whose admission names
    no sender, and submits the turn with the admitted identity.
  - `agent-cli` — a local peer message is taken as coming from the session it names only when that
    session confirms, at its own socket, that it is sending exactly that message to this receiver.
    The reply target, the driver id and the operator's notices come from the confirmed sender. A
    session on an earlier version cannot confirm, so its messages are refused; both sessions need this
    version to message each other.

## 3.0.0-beta.80

### Major Changes

- 64ba748: **BREAKING — ARCH-042: project filesystem access is now an explicit, host-issued authority instead of an ambient consequence of `cwd`.**

  `@robota-sdk/agent-framework` adds `WorkspaceTrustService` and the opaque
  `IWorkspaceProjectAuthority`, plus bounded reader, settings-writer, state-storage, and mutation
  facets. Public session, settings, context, checkpoint, memory, contribution, query, and replay
  contracts consume those facets. A caller that does not supply `projectAccess` is deliberately
  restricted to user-owned host state and receives no project filesystem capability.

  The framework removes or renames ambient Node/project exports. Migrate `checkSettingsFile` to
  `checkNodeHostSettingsFile`, `readMergedProviderSettingsFromPaths` to
  `readMergedProviderSettingsFromSources`, `resolveProviderSettingsWriteTargetPath` to
  `resolveProviderSettingsWriteTarget`, `FileSystemMemoryStore` / `createFileSystemMemoryStore` to
  `WorkspaceMemoryStore` / `createWorkspaceMemoryStore`, and `PluginSettingsStore` to
  `NodeHostPluginSettingsStore`. Host-only git helpers now carry the `FromNodeHost` suffix.
  `projectPaths`, `resolveSettingsPathForScope`, and `getProviderSettingsPaths` are removed; project
  consumers must use the authority facets rather than recover absolute paths.

  `@robota-sdk/agent-session` renames the Node filesystem implementation `SessionStore` to
  `NodeSessionStore` and adds explicit session-log/external-payload source and sink ports. Session
  replay no longer resolves external payload files from an ambient directory.

  `@robota-sdk/agent-interface-transport` changes `ISkillExecutionPort.loadCommands(cwd, home?)` to
  the authority-bound `loadCommands()` and removes the optional absolute-path leak
  `IInteractiveSessionStore.getFilePath`. `@robota-sdk/agent-command` consequently replaces the
  `cwd` option of `createSkillsCommandModule` with required `contributionSources`; default command
  composition accepts explicit contribution sources and discovers no project skills when none are
  provided.

  `@robota-sdk/agent-cli`, `@robota-sdk/agent-transport`, and
  `@robota-sdk/agent-transport-tui` thread the trusted-or-restricted project decision through every
  session surface. Embedded callers that need project settings, state, context, skills, checkpoints,
  or mutation must mint access through `WorkspaceTrustService` and pass the returned
  `projectAccess` (and a separately approved mutation/settings facet where required). Omitting it is
  still type-compatible but is behaviorally breaking: the surface now fails closed instead of
  reading or writing the current directory.

### Minor Changes

- 9c19c50: `/fork [name] [--same-dir]` copies the live conversation into a background session.

  The session writes a copy of its own record under a fresh id — messages, system prompt, tool schemas
  and full history, and deliberately not the sandbox snapshot, goal, plan or branch — then spawns a
  background job carrying only `resumeSessionId`. The child restores that record itself, so no
  conversation crosses the child-process boundary and the worker start payload's key set is unchanged.
  The background panel gains an `attach` control that switches the terminal onto the forked session; it
  is a view switch, never a merge, and a missing record or a terminal task is refused with the task's
  own status.

  **`@robota-sdk/agent-framework` is `major` for one reason: `ICommandHostSessionAccess` gains a
  required member.** `forkSession({ name? })` is not optional, so an external implementation of that
  role port stops compiling until it adds the method. Every other change in this set is additive:

  - `agent-interface-execution` — `TExecutionControl` gains `'attach'`.
  - `agent-interface-command` — `TCommandUiIntent` gains `{ type: 'switch-session'; sessionId }`.
  - `agent-subagent-runner` — `ISubagentWorkerComposition` gains the optional `openSessionStore`, and
    the worker resumes a record when the job names one. A composition that registers no store and
    receives no `resumeSessionId` behaves exactly as before.
  - `agent-framework` also gains the fork-record builder, `SessionTurnMemory`, and
    `IAgentBackgroundTaskRequest.resumeSessionId?`; `loadSessionRecord` now returns
    `restoredSystemPrompt`, which makes a record field that was written and never read take effect on
    restore.
  - `agent-executor`, `agent-command`, `agent-transport-tui`, `agent-cli` — the spawn input, the
    `/fork` module and the attach control that carry it to the surface.

- 3ac6c48: Remote MCP servers get a client authentication port. OAuth and a dynamic header helper will plug
  into it without the transport changing.

  - **`IMCPClientAuthenticator`:**
    - A host registers one for one server identity: `authenticatorFor` on the CLI's MCP client
      composition, or `authentication` on `IMCPHttpEndpoint`.
    - The Streamable HTTP transport asks it for headers on every request to that server, after
      admission. Its headers override a static header of the same name.
  - **Failures:**
    - A 401/403 is retried at most once, with fresh authorization, when the authenticator answers
      `retry`.
    - Otherwise the connection is refused with `MCPAuthenticationError`, which is classified as
      `auth`. Neither the credential nor the authenticator's text appears in it.
    - There is never an unauthenticated attempt.
  - **`oauth` and `headersHelper` in a definition** were silently ignored.
    - On a remote server they are now decoded as `unsupportedAuthentication`: the server stays
      listed, and admission refuses it by name (`unsupported-authentication`) instead of connecting
      without the credential.
    - On a stdio server they are a definition problem.

- 9368d00: Advisor escalation: the main model can consult a second model at the decision points it chooses.

  With an advisor configured (`--advisor <profile>[:<model>]`, or the `advisorModel` setting that
  `/advisor` saves; the flag wins), the session gets an `Advisor({ question? })` tool. The advisor reads
  the whole conversation — system prompt, messages, tool calls and results — serialized into one prompt
  and sent with `toolChoice: 'none'`, truncated from the front to fit its window with the system prompt
  kept, and declines when even that does not fit. Its answer comes back framed as guidance to verify;
  an empty or refusing answer reads as declined. Calls are limited to two per turn and a fixed number
  per session, parallel calls in one round share those limits, and a repeated question in the same
  turn returns the earlier answer. A request that was sent counts even when the provider failed (the
  decline is reported by class, never by its text); only a call declined before sending gives its slot
  back.

  Advisor usage, including in-process subagents', is recorded where each turn's usage is recorded —
  the persisted session history, under the advisor's own provider and model — so `/cost`, usage reports
  and resumed sessions include it. `/cost` now totals that history and prices each part on its own
  model, showing "mixed" when more than one model was priced.

  `/advisor <model>` and `/advisor off` change only where calls go, never the tool list, so the main
  model's prompt cache is not invalidated mid-session; the tool is added only when a session starts
  with an advisor. Sending history to a destination (provider type and endpoint host) the main model
  does not already use needs a one-time consent per destination, kept in the user settings file; a
  refusal is remembered for the session. The organization's `allowedProviders` applies, and
  `ROBOTA_DISABLE_ADVISOR=1` turns it off completely. In-process subagents inherit the advisor, bound
  to their own conversation; child-process subagents do not get it.

  **`@robota-sdk/agent-framework` is `major` for one reason: `ICommandHostSessionAccess` gains a
  required member,** `getSessionUsage()`, the session's persisted usage records. An external
  implementation of that role port stops compiling until it adds the method. The rest is additive.

  - `agent-session` — `formatConversationEntries`, the one text rendering of a conversation, now used
    by compaction too. It keeps tool calls and results, marks a user message a peer session sent
    (`user [from "peer:<id>"]`), and JSON-encodes every message onto one line so no content can forge
    another entry; compaction previously flattened all of this. `Session.getProvider()` returns the
    provider the session currently uses.
  - `agent-framework` — `AdvisorController`, `createAdvisorTool`, the advisor spec helpers, provider
    destinations (`describeProviderDestination`, `rememberProviderDestination`), `getSessionUsage` and
    `ISessionUsageRecord`, the `onUsageRecorded` session option, and the optional `advisor` command
    host adapter. Session assembly binds a host-supplied Advisor tool to the session holding it.
  - `agent-command` — the `/advisor` command module; `/cost` reads the session's persisted usage.
  - `agent-cli` — the `--advisor` flag, `advisorModel` setting, per-destination consent store and kill
    switch.
  - `agent-ui-terminal` — a usage line from another source (the advisor, a background task) names that
    source and leaves out the context window it does not have.
  - `agent-session-analytics` — personal usage counts an advisor call's tokens and cost toward its
    turn without counting it as a turn.

- 0d369ce: Remote MCP servers can take their request headers from a header helper.

  - **Declaring one:** `"headersHelper": { "command": "/absolute/path", "args": [...] }` on a remote
    server definition.
    - `${}` templates are refused, as they are for stdio.
    - The shell-string form other clients accept is refused, with a message showing the argv form.
    - `headersHelper` is no longer reported as unsupported authentication; only `oauth` is.
  - **Allowing one:** a helper runs only when all of these hold:
    - its exact command and arguments are listed in `mcpHeaderHelpers` in the user's own settings.
      A project, local, managed or plugin source cannot add to that list.
    - the server's activation is approved. The helper is part of the definition fingerprint, and the
      activation endpoint shows it beside the URL, with arguments quoted and control characters
      escaped.
    - for a `project` or `local` definition, the workspace is trusted.

    Otherwise the server is refused with `headers-helper-not-allowed` or `headers-helper-untrusted`.
    It is never connected with its static headers alone.

  - **Running it** (`agent-cli`):
    - No shell. It runs in the project directory for a `project`/`local` definition, and in
      `~/.robota` otherwise.
    - Its environment is the host's without runtime-loading variables (`NODE_OPTIONS`, `LD_*`,
      `BASH_ENV`, …). A `project`/`local` helper also gets no credential-shaped variables.
      `ROBOTA_MCP_SERVER_NAME` and `ROBOTA_MCP_SERVER_URL` are set. For a `project`/`local` helper
      the URL keeps its `${VAR}` references instead of what the environment expanded them to.
    - Limits: 10 s and 64 KiB of stdout. Stderr is discarded. The process tree is killed on timeout
      or cancel.
  - **Its output** (`agent-mcp`, `parseHeadersHelperOutput`):
    - Exactly one JSON object of string values.
    - Refused: invalid or duplicate names (case-insensitive), more than 32 headers, and headers the
      transport owns (`Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Content-Type`,
      `Accept`, `Mcp-Session-Id`, `Mcp-Protocol-Version`, `traceparent`).
  - **When it runs:** once per connection, one run at a time, and once more after a 401/403.
    - Requests refused together cost one new run: the reusable `MCPSingleFlightCache` tags each value
      with a generation and drops it only when the refused request used the current one.
    - `IMCPAuthorizationRejection` now carries `authorization`, the object `authorize` returned for
      the refused request, so an authenticator can tell which credential was refused.
    - A reconnect runs the helper afresh. A helper still running when the CLI exits is killed.
    - Failures are `MCPHeadersHelperError` with a fixed reason. Nothing the helper printed reaches an
      error or a diagnostic.
  - `IMCPHttpEndpoint.authenticationRequired` refuses admission (`authentication-unavailable`) when no
    authenticator is registered.

- d4189b9: The rest of the per-server MCP OAuth lifecycle: signing in to a server without a local browser,
  signing out of it with token revocation, and each server's sign-in state in `/mcp`.

  - **`robota mcp login <name> --no-browser`** prints the authorization URL and reads the redirect URL
    the user pastes back (not echoed). `runMCPOAuthLogin` takes `readRedirect` for this; nothing
    listens on the redirect URI then. The pasted URL is held to the loopback listener's rules through
    `createPastedRedirectAcceptor`: it must be the registered redirect URI (same origin and path, no
    user info), carry the sign-in's `state` (compared in constant time), and is accepted once; an
    error redirect is `authorization-denied` without its `error_description`, and the RFC 9207 `iss`
    check applies as before. `openBrowser` now also receives the redirect URI. `readRedirect` gets a
    signal that aborts on cancel or at `callbackTimeoutMs` (5 minutes by default, as for the loopback
    listener); a paste longer than the prompt accepts fails as `redirect-too-long`.
  - **Signing out** (`runMCPOAuthLogout`; `robota mcp logout <name>`; `/mcp logout <serverId>`):
    deletes the stored credential under the refresh lock, then revokes the refresh token and the
    access token (RFC 7009) when the stored issuer advertises `revocation_endpoint`. Revocation is a
    POST through the egress policy that never follows a redirect and is byte-bounded; it authenticates
    the client by `revocation_endpoint_auth_methods_supported` when advertised, otherwise the way its
    refresh does. The local delete always happens. Each token's outcome is reported in `tokens`, and
    overall as `revoked`, `partial`, `unsupported`, `failed` or `not-attempted`, with fixed reasons
    only (new: `revocation-failed`, and `token-type-not-revocable` for RFC 7009
    `unsupported_token_type`). `/mcp logout` also makes the session's authenticator drop the token it
    holds (`IMCPOAuthAuthenticator.forget`).
  - **Sign-in state:** `readMCPOAuthCredentialState` answers `signed-in`, `expired-refreshable`,
    `sign-in-required` or `signed-out` — never anything token-derived. `/mcp` shows it for every
    OAuth server; a server this session was told needs a sign-in reads `sign-in-required`.
    `ICommandMCPActivationAdapter` gains optional `oauthStatus` and `oauthLogout`
    (`ICommandMCPOAuthStatus`, `ICommandMCPOAuthLogoutResult`).
  - **No in-session sign-in:** signing in stays `robota mcp login <server>` in a terminal, since it
    needs the terminal (browser, pasted redirect, hidden secret prompt) a running session owns. `/mcp`
    names that command for a server that needs a sign-in, as does the session's sign-in notice; the
    server name is shown there only when it is safe to paste into any shell — a plain token not
    starting with `-` or `=` — and is otherwise replaced by `<server>` (`shellArgumentForDisplay` in
    `agent-core`; nothing is quoted, since quoting rules differ between shells). Server names in OAuth
    notices have control and format characters escaped.
  - **Refresh hardening:** on `invalid_grant`, the store is read again under the lock; a refresh token
    another holder rotated in meanwhile is kept (and used when still valid) instead of being deleted.
    The expiry skew is capped at half the token's lifetime, so a short-lived token is not refreshed on
    every request; credentials now record `issuedAt` for this.

- 9edae52: Remote MCP servers can authenticate with OAuth: `robota mcp login <name>` signs in, and sessions
  send the stored token.

  - **Declaring it:** `"oauth": { "clientId"?, "callbackPort"?, "authServerMetadataUrl"?, "scopes"? }`
    on a remote server definition, decoded into `IMCPOAuthConfig`.
    - `authServerMetadataUrl` must be `https`. `scopes` wins over the server's metadata and a 401's
      `scope`.
    - A `clientId` needs a `callbackPort`: a pre-registered client's redirect URI is fixed.
    - `clientSecret`, unknown keys and `${}` templates are refused; `oauth` beside `headersHelper`,
      or on a stdio server, is refused.
    - `oauth` is no longer reported as unsupported authentication, and it is part of the definition
      fingerprint.
  - **Signing in** (`runMCPOAuthLogin`; `robota mcp login <name> [--client-secret]`):
    - Discovery is done here, not by the SDK's `discoverOAuthServerInfo`: the protected-resource
      metadata `resource` must be the canonical server URL, the authorization server's `issuer` must
      be the server it was fetched for, the server, authorization, token and registration
      endpoints must be `https`, and the authorization server must advertise PKCE `S256`
      (`pkce-unsupported` otherwise). A 401's `resource_metadata` is never followed to another origin,
      and a server without resource metadata is not guessed at.
      `authServerMetadataUrl` skips resource discovery.
    - Dynamic client registration when there is no `clientId`; PKCE, a random `state` and the
      RFC 8707 resource indicator on the authorization request; the RFC 9207 `iss` checked on the
      redirect when sent, and required when the server promises it.
    - The loopback callback listens on `127.0.0.1`, checks `Host`, answers only `GET /callback` with
      the sign-in's `state` (compared in constant time), once, within 5 minutes, and serves a static
      page that never shows `error_description`.
    - The browser opens by argv (`open`, `xdg-open`, `rundll32 url.dll,FileProtocolHandler`) and only
      for an `https` URL. `--client-secret` asks for the secret without echo (or reads stdin's first
      line) and only for a pre-registered client.
  - **Network:** every OAuth request goes through the egress policy and is capped at 256 KiB.
    `agent-core` adds `postWithEgressPolicy`, which refuses a redirect (`redirect_refused`) instead
    of following it; registration, token and refresh requests use it.
  - **Storage:** `IMCPOAuthCredentialStore` (`get`/`set`/`delete`), keyed by the server's security
    identity and canonical URL together. `createFileOAuthCredentialStore` keeps 0600 files in a 0700
    `~/.robota/mcp-credentials/`. The issuer, token endpoint and client (with its secret, if any, and
    the client authentication method dynamic registration returned) are stored with the tokens. A
    sign-in stores its credential under the refresh lock, so a refresh in flight cannot overwrite it.
  - **Sessions** (`createOAuthAuthenticator`, wired for every `oauth` definition):
    - Sends the stored token as `Authorization: Bearer`, refreshing it first when expired — including
      a token cached earlier in the session — and only at the stored token endpoint.
    - One refresh at a time per credential: in a process through `MCPSingleFlightCache`, across
      processes under `createFileOAuthRefreshLock`, re-reading the store once the lock is held. A
      stale lock is taken over, and a lock released, only after it is renamed aside and proven to be
      the one judged — never another process's fresh lock.
    - A 401 rediscovers, then refreshes once and retries; an authorization server that changed clears
      the tokens — compared, under the lock, with what is stored then, so a newer sign-in is kept. `invalid_grant`, or nothing stored, asks the user to run `robota mcp login <name>`. A 403
      `insufficient_scope` fails and names the scope.
    - An `oauth` definition is never connected without the authenticator (`oauth-unavailable`).
  - Failures are `MCPOAuthError` with a fixed reason; no code, verifier, token, secret or
    authorization-server text reaches an error, a notice or a log.

- 4078a72: Model fallback chain. `--fallback-model a,b` (or the `fallbackModel` settings array; the flag wins) names up to three models a turn moves to when its model is overloaded, unavailable or failing on the server. An entry is a provider profile, `profile:model`, a bare model on the primary's provider, or `default`. The move happens only before any output has streamed, lasts for the current turn, and is shown as a system note; entries that cannot be built are passed over and entries outside the organization's `allowedProviders` are dropped with a notice. `FallbackProvider` in agent-framework implements it over the session's provider; `IChatOptions` gains `executionId`, `onModelFallback` and `preserveContextWindow`, `IAIProvider` gains optional `resolveModelRoute`, and the execution loop emits a `provider_fallback` event and attributes requests, call observations, committed replies, the response cache and usage to the model that answered. A turn that ran on more than one model records per-model `modelShares` on its usage observation, which personal usage reports split by model and provider. A `/provider` switch keeps the chain, read again for the new primary.
- 3131209: `robota mcp serve` can serve a remote MCP client as an OAuth resource server.

  `agent-transport-mcp` gains `createMcpRemoteHttpHost`, which admits requests only by an OAuth access
  token checked by an injected `IAccessTokenVerifier`. Its endpoint path and its RFC 9728
  protected-resource metadata path are derived from the `https` public URL, so a proxy prefix works,
  and Host and Origin are checked against that public origin. A refusal has an empty body: `401` with
  `WWW-Authenticate: Bearer resource_metadata="…"` (plus `error="invalid_token"` when a token was
  presented), or `403` with `error="insufficient_scope"`. The token is verified before anything is
  counted, and only failures are counted, per client address, so a valid token is never throttled;
  `X-Forwarded-For` is believed only from a configured trusted proxy. Each refusal goes to an injected
  audit sink as a reason and an address class, never token text. The host stays stateless and issues
  no `Mcp-Session-Id`. The loopback `createMcpHttpHost` is unchanged.

  `agent-cli` adds `--http-public-url`, `--http-host`, `--oauth-issuer`, `--oauth-scopes`,
  `--oauth-allowed-subjects` and `--trusted-proxy` to `robota mcp serve`. It binds an address other than
  `127.0.0.1` only with the public URL and the OAuth settings, and never with `--http-token-file`.
  Refusals are logged on stderr without token text.

- af2f2ad: `/cd <directory>` continues the conversation in another directory.

  - **A move is a new session in the target directory.** In the TUI, robota saves a copy of the
    conversation where the target's session store will find it, ends the current run through its
    normal end-of-life flow, and starts again in the target directory resuming that copy. The target's
    settings, trust decision, tools, skills and `AGENTS.md` apply, exactly as if robota had been
    launched there. The process boundary makes the move atomic, so no tool call can straddle it.
  - **The system prompt is kept as recorded**, so a provider's prompt cache survives. One appended
    `<workspace-move>` message tells the model the new directory, and which project instructions now
    apply.
  - **Refused** while a turn is running or a background task is still running, for a missing directory
    or the current one, and for a target a `Cd(...)` deny rule names.
  - **Access never widens:** a restricted session stays restricted after a move, and a trusted session
    takes the target's own trust decision.
  - New contracts: the `workspace-move` host action, `ICommandWorkspaceAdapter` /
    `IWorkspaceMoveRequest`, `InteractiveSession.moveWorkspace`, and the `workspaceMovedFrom` session
    option. The CLI's `--moved-from` and `--restricted-workspace` flags are internal.

- 267af5f: The execution containment seam states where tools run.

  - **`ISandboxClient.filesystem`** (`'shared' | 'separate'`, absent means `separate`).
    - With a **separate** filesystem (E2B, in-memory), every file tool goes through the sandbox, and
      `Glob`/`Grep`, which can only read the host, are withheld. Previously a remote sandbox still
      offered host-reading search tools beside sandbox-writing edit tools.
    - With a **shared** filesystem (OS-level confinement over the host's files), file tools stay on
      the host under the path guard, and only commands go through the sandbox.
  - **`describeExecutionContainment` / `routesFilesThroughSandbox`** name the containment (`host`,
    `sandbox-shared`, `sandbox-separate`) instead of inferring it from an absent value.
  - **`robota doctor` reports `execution.containment`.** Robota composes no sandbox today, so the
    doctor says shell commands run unconfined on the host and the permission rules are the only
    boundary. The CLI composition and the doctor read the same value.
  - **The `Agent` and `BackgroundProcess` tools no longer fall back to `process.cwd()`** when they
    were built without an execution root. They report an assembly error instead, as the file tools
    already did (ARCH-010).

- f336838: One permission evaluation order for every caller. The interactive session, background tasks and
  subagents used to run two different resolvers, so the same call could be decided differently
  depending on who made it. They now share `evaluatePermission`, and a background policy only adds a
  ceiling, an ask-everything flag and the task's own lists to it:

  deny → caller ceiling → unevaluable deny (ask) → never-auto-approve set (ask) → ask-everything →
  bypassPermissions → allow → mode.

  - **`ask` rules.** `permissions.ask` patterns always ask, in every mode including
    `bypassPermissions`. They are matched per command like a deny rule, and are validated at
    construction alongside `allow` and `deny`.
  - **Never auto-approved, bypass included:** removing a critical path with `rm`/`rmdir` (the root, a
    top-level directory, home, the working directory or a parent), and a modify-class write into
    `.git`, `.robota`, `.claude`, `.agents`, `.mcp.json`, `.gitconfig`, `.npmrc` or a shell rc file.
    Files inside an isolated worktree (`.robota/worktrees/<name>/…`) are ordinary files. With no
    approver attached, an ask is a denial.
  - **A ceiling is checked before bypass and before any ask.** A subagent's `inherit-allowlist` ceiling
    is now the parent's _effective_ rules, read live at spawn: settings, preset lists and command
    auto-allows. It used to be the raw settings file. An unevaluable deny under a policy now asks,
    like everywhere else, where it used to deny outright; with no approver it is still a denial.
  - **Settings layers union `permissions.allow`**, as they already did `deny`. A checked-in project
    file no longer silently discards the user's allow list.
  - **Print mode, `createQuery()` and headless sessions default to `default` mode**, not
    `bypassPermissions`. They have no approver, so a call that would ask is denied. Pass
    `--permission-mode` / `permissionMode: 'bypassPermissions'` explicitly for unattended runs.

  **Breaking:**
  - `@robota-sdk/agent-core` removes `resolvePermissionByPolicy` and `TPermissionPolicyDecision` in
    favour of `projectPermissionPolicy` plus `evaluatePermission`'s new `context` argument.
  - `@robota-sdk/agent-framework` changes the settings merge rule for `permissions.allow`, and the
    default permission mode of `createQuery()` and headless sessions.

- 34e50f0: A new permission mode, `auto`, lets a model classifier approve or block what would otherwise prompt.

  - **What it decides:**
    - Reads and in-workspace edits run as in `acceptEdits`.
    - Commands and other calls the mode leaves open go to the classifier, a side call to the
      session's own model. It sees the call, the working directory and the git remotes, never the
      conversation.
    - A block reaches the model with its reason, so it can take another route.
  - **What still reaches a person, or is refused:**
    - Deny rules and background ceilings apply first.
    - `ask` rules, critical removals and protected paths ask a person.
    - After 3 refusals in a row (blocks, or no usable verdict), or 20 blocks in the session, the
      mode asks a person until one approves.
      With no one to ask, the call is denied.
  - **Allow rules:** in `auto` mode, allow rules that approve any command are set aside while the
    mode is on. Examples are `Bash(*)`, an interpreter (`Bash(python *)`), a package runner
    (`Bash(npm run *)`, `Bash(pnpm exec *)`), `Agent`, `ExecuteCommand` or `Computer`. Narrow
    rules still apply.
  - **Retry:** `/permissions` lists classifier blocks. `/permissions retry <n>` lets that exact call
    run once, unjudged, when the model tries it again.
  - **Turning it on and off:**
    - `--permission-mode auto`, `/mode auto` or `/permissions auto`.
    - An organization turns it off with `disableAutoMode` in the org policy.
  - **New contracts:**
    - `TPermissionMode` gains `'auto'`.
    - `allowRulesForAutoMode` and `isBroadExecutionAllowRule`.
    - `IPermissionClassifier` and `AutoModeGate`.
    - The `permissionClassifier` session option.
    - `Session.retryPermissionDenial`, and `retryDenial` on the permission-mode adapter.
    - The `'classifier'` denial reason.
    - `createModelPermissionClassifier`.
    - The `disableAutoMode` option on `createSession` and `IOrgPolicy`.

- 722e88a: Shell commands can run in an OS-level sandbox: bubblewrap on Linux and WSL2, Seatbelt on macOS.

  - **Confinement:** covers the command and every process it starts.
    - Writes are limited to the working directory, the temporary directories and
      `sandbox.filesystem.allowWrite`.
    - Agent, git-hook, MCP and shell configuration inside the workspace stays read-only.
    - `sandbox.filesystem.denyRead` hides paths from the command.
    - The network is on or off (`sandbox.network.enabled`).
  - **Modes:** `/sandbox` switches between `auto-allow`, `regular` and `off` for the next command and
    saves the choice.
    - In `auto-allow` (`sandbox.autoAllowBashIfSandboxed`), a confined command runs without a prompt
      in `default` and `acceptEdits`.
    - Deny rules, ask rules, critical removals and plan mode still apply first.
  - **Exclusions:** `sandbox.excludedCommands` run unconfined, through the ordinary permission path.
  - **When the sandbox cannot run:** a missing or unusable backend is reported at startup, in
    `robota doctor` and in `/sandbox`, and commands then run unconfined.
    `sandbox.failIfUnavailable` refuses to start instead.
  - **New contracts:**
    - `OsSandboxClient`, `detectOsSandbox`, `bubblewrapArguments`, `seatbeltProfile`.
    - `ISandboxClient.wrapCommand` and `autoApproves`.
    - `IPermissionEvaluationContext.sandboxAutoApproved`.
    - The `commandSandbox` session option.
    - The `sandbox` settings key and the `sandbox` command host adapter.

- a5cc36e: `/permissions` shows the rules the session enforces and the calls it refused.

  - **Rules by source:** each allow, deny and ask rule the gate reads is listed under the settings file
    that declares it. Rules added by a CLI flag, a preset or a command are listed under "this session".
    A rule a settings file declares but the session does not enforce is not shown.
  - **Recent denials:** the latest refused calls, most recent first, with the reason: a rule or the
    mode, the user declining, or no one available to approve.
  - New contracts: `Session.getRecentPermissionDenials()`, `PermissionEnforcer.getRecentDenials()`,
    `IPermissionDenial`, the `permissionRules` host adapter (`createSettingsPermissionRulesAdapter`),
    and `getPermissionRules` / `listRecentDenials` on `ICommandPermissionModeAdapter`. Settings
    provenance now covers `permissions.ask`.

- b70fa3d: `robota --safe-mode` starts a session with every customization off, to rule one out in one run.

  - **Off:** project and user instruction files, skills, custom commands, agent definitions, output
    styles, external presets, plugins, hooks from every settings layer, and MCP servers.
  - **Unchanged:** provider, model, built-in tools and permissions work as usual. Nothing on disk
    changes.
  - **Project access:** the project starts Restricted whatever its trust decision, so safe mode also
    runs in print and serve mode.
  - **Notice:** a line at startup says that safe mode is on.
  - **Embedders:** `startCli({ safeMode: true })` does the same as the flag.
  - **New framework option:** `skipConfiguredHooks` on interactive and headless sessions, also
    carried by the TUI and serve session options.

- 4dd45cc: `/peers` shows how each other local session's workspace relates to this one's: `same worktree`,
  `same repo`, `different repo`, or `workspace unknown`.

  A session now publishes a workspace claim with its rendezvous entry — the root commits reachable
  from HEAD, a SHA-256 of its normalized `origin` URL (never the URL itself), and the real path of its
  worktree — and re-reads it as it runs, so a first commit or a checkout does not leave it stale. The
  reader does not take the claim as written: it reads git at the claimed path itself, and a claim whose
  contents disagree is shown as `workspace claim mismatched, not believed` and relates to nothing. Those
  git reads are local-only and asynchronous, run only for the view that shows the relation (and for
  the sender of an incoming peer message), and are cached per announcement. The relation also reaches
  the peer-turn origin, computed by the receiver; a relation the sender put on the wire is discarded,
  and the admission never carries it.

  The relation is display and routing information only and is never an authorization input.

  Additive: `agent-interface-session-mobility` exports `TWorkspaceRelation` and gains the optional
  `IPeerOrigin.workspaceRelation`; `agent-framework`'s `ILocalPeerSummary` gains the optional
  `workspaceRelation` and `workspaceClaim`, and `ICommandLocalPeersAdapter` the optional
  `listWithWorkspace()`.

- 4c5148e: ARCH-005 Stage S2 — `robota` is now expressed as an `IProductProfile` and assembled by `assembleProduct`;
  the hand-wired composition root in `agent-cli` is gone.

  - **`@robota-sdk/agent-product`** — provider construction returns IN-KERNEL. `assembleProduct` builds the
    provider from `providerDefinitions` + the shell's already-resolved `providerSettings` via agent-core's
    pure `createProviderFromConfig`; `provider` is now an OPTIONAL injected override. Both are optional, so a
    Mode A profile can carry only `providerDefinitions`. The fold stays pure and IO-free — every
    settings/env/file read still happens in the shell. Adds `IAssembledProduct.buildRuntimeOptions`, the pure
    overlay `buildRuntime` delegates through, and `IAssembledProduct.providerDefinitions`.
    **Breaking for pre-release consumers:** `IProductProfile.providerDefinitions` is now required and
    `IProductProfile.provider` / `IAssembledProduct.provider` are now optional.
  - **`@robota-sdk/agent-framework`** — a scoped, additive session seam: `agentDefinitions` on
    `TInteractiveSessionOptions` / `ICreateSessionOptions`, composed into the built-in agent tier ahead of
    `BUILT_IN_AGENTS`, so capability-pack subagents actually reach the runtime. Precedence: discovered
    project/user definitions > injected > built-in. `AgentDefinitionLoader` now dedupes within that tier
    (first wins). Absent ⇒ unchanged behavior.
  - **`@robota-sdk/agent-transport` / `@robota-sdk/agent-transport-tui`** — forward the optional
    `agentDefinitions` through the headless and TUI channels so every robota surface carries the seam.
  - **`@robota-sdk/agent-cli`** — `robota`'s identity (branding, provider surface, presets,
    `packs: [codingPack]`, base command modules, injected transports/runners/subagent factory) is declared as
    data in a product profile and folded by `assembleProduct`. The coding command modules (`/shell`,
    `/editor`) now come from `pack-coding` rather than the base set, so the pack is load-bearing. What remains
    in the CLI is product-shell only: arg parsing, settings/file IO, terminal notices, first-run/init/
    `--configure`, memory + session-resume UX, and print/serve/TUI mode dispatch.

  End-user `robota` behavior is unchanged in substance — the assembled command-module set, provider surface,
  tool set, subagent roster, and preset resolution all match the pre-change assembly — with one accepted
  cosmetic delta: `/shell` and `/editor` now appear at the END of `/help` output and of the slash-command
  autocomplete popup rather than mid-list, because they arrive from `pack-coding` and both surfaces render in
  module-insertion order. Same commands, same behavior, different position.

- 37af5dc: ARCH-006 + ARCH-007 — the capability-pack TOOL axis reaches parity with the command and subagent axes,
  and `robota` consumes the composition kernel's RUNTIME SEAM instead of only its materials.

  - **`@robota-sdk/agent-framework` (ARCH-006)** — the default tool set is no longer hard-coded.
    `createSession` accepts `defaultTools`, which REPLACES the `createDefaultTools()` tier (`[]` suppresses
    it entirely) — the tool-axis mirror of NEUT-003's `builtInAgents` seam for subagents. The assembled
    list `defaultTools ⊕ additionalTools ⊕ goalTool` is now **deduplicated by tool name, first occurrence
    wins**, the same rule `AgentDefinitionLoader` applies within the subagent built-in tier. So a
    contributed tool with a NEW name is additive, a contributed tool that mirrors a framework default is
    deduped rather than listed twice, and a product can hand its whole tool surface to its capability
    packs. A name collision keeps the framework default and drops the contribution: the default tier is
    built WITH the session context (`cwd` supplies `agent-tools`' working-directory path guard, plus the
    sandbox client and retrieval adapter) and an already-constructed contribution carries none of it, so
    replacement is expressible only through the explicit `defaultTools` seam — never as a side effect of a
    collision. The edit-checkpoint wrap now covers the assembled set, so a pack-contributed `Write`/`Edit`
    is checkpointed too. Option threaded through `ICreateSessionOptions` / `IInitOptions` /
    `IInteractiveSessionStandardOptions`. Absent `defaultTools` and absent a duplicate name, every existing
    path is byte-identical.
  - **`@robota-sdk/agent-product` (ARCH-007)** — `buildRuntimeOptions` no longer overwrites a
    caller-supplied `commandModules`. A shell that has already narrowed the merged `base ⊕ packs` superset
    (as `robota` does with its preset's enabled/disabled delta) keeps that selection; the assembled set is
    overlaid only when the caller left it unset — the same rule `permissionMode` already followed.
  - **`@robota-sdk/agent-cli` (ARCH-007)** — `startCli` now routes through
    `product.buildRuntimeOptions(...)`. The shell resolves its own session inputs and the kernel lays the
    product-owned materials on top: the packs' tools (`additionalTools`), the packs' subagents
    (`agentDefinitions`), and the default preset's permission posture when `--permission-mode` left it
    unset. The hand-threaded `product.subagents` path and the three per-surface
    `args.permissionMode ?? resolvedPreset.permissionMode` expressions are gone — every surface binds to
    the one kernel result.

  End-user `robota` behavior is unchanged: the assembled command-module set, provider surface, tool set,
  subagent roster, preset resolution, and permission posture all match the pre-change assembly.

- 0116a29: ARCH-006 completion — robota's capability packs now OWN its tool surface, and `pack-coding` is built by a
  context-bound factory.

  - **`@robota-sdk/pack-coding` (BREAKING)** — the module-level `codingPack` constant is **removed** and
    replaced by `createCodingPack({ cwd, sandboxClient })`, with `cwd` **required**. This is a safety change,
    not a style one: `agent-tools` disarms its working-directory path guard when `cwd` is `undefined`, so a
    pack whose file tools are built with no options contributes an **unsandboxed** `Read`/`Write`/`Edit`.
    That was inert while `agent-framework` always supplied its own context-bound default tier, but ARCH-006
    lets a product hand the whole tool surface to its packs (`defaultTools: []`) — and a context-free pack in
    that position is a real hole. Keeping a zero-option export beside that seam would be a loaded gun, so it
    is gone rather than deprecated. Each call returns fresh instances bound to the supplied context, so two
    products in one process get independently-scoped file tools. Migration: replace `codingPack` with
    `createCodingPack({ cwd: process.cwd() })`.
  - **`@robota-sdk/agent-cli`** — `robota`'s packs are built from the shell's resolved `cwd`
    (`createRobotaPacks({ cwd })`) before command setup, and the runtime seam passes
    `ROBOTA_PACKS_OWN_TOOL_SURFACE` (an empty `defaultTools`) so the framework's `createDefaultTools()` tier
    is REPLACED. Every tool robota runs now arrives from a capability pack: dropping a pack drops its tools,
    exactly as it already dropped its command modules and subagents.
  - **`@robota-sdk/agent-transport` / `@robota-sdk/agent-transport-tui`** — forward the optional
    `additionalTools` and `defaultTools` through the headless and TUI channels, mirroring the existing
    `agentDefinitions` pass-through, so print, serve and TUI carry an identical tool surface.

  End-user `robota` behavior is unchanged, including the security property: the real binary still answers a
  read outside the working directory with `Access denied: "…" is outside the working directory`.

- 7937c19: Split the `@robota-sdk/agent-provider` monolith into SDK-aligned leaf packages (ARCH-PROVIDER-002 Stage A). The single package that hard-bundled all three vendor SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`) is **removed** and replaced by per-vendor leaves, each depending only on `@robota-sdk/agent-core` + its one SDK: `@robota-sdk/agent-provider-anthropic`, `@robota-sdk/agent-provider-openai`, `@robota-sdk/agent-provider-openai-compatible` (DeepSeek/Qwen/Gemma over the shared OpenAI-compatible base), `@robota-sdk/agent-provider-gemini` (+ a `./google` entry), and `@robota-sdk/agent-provider-bytedance` (media/video `IVideoGenerationProvider`). The aggregated `createDefaultProviderDefinitions()` now lives in the new `@robota-sdk/agent-builtin-providers` leaf.

  Migration: replace `@robota-sdk/agent-provider/<vendor>` imports with the corresponding `@robota-sdk/agent-provider-<vendor>` package (`/deepseek`, `/qwen`, `/gemma` → `@robota-sdk/agent-provider-openai-compatible`; `/google` → `@robota-sdk/agent-provider-gemini/google`), and import `createDefaultProviderDefinitions` from `@robota-sdk/agent-builtin-providers`. Consumers now pull only the vendor SDK(s) they actually use.

- 1e3f91a: CMD-004 Phase 2 Stage E (breaking, beta line): the legacy `TCommandEffect` union and
  `ICommandResult.effects` are DELETED. Commands emit the split contract directly —
  `hostActions` (session-executed via `ICommandHostAdapters`; works headless and remote) and
  `uiIntents` (requester-routed `ui_intent` session events with UI-neutral `show-*` names).
  Final carriers for the former notification effects: `session_renamed` and the new
  `history_cleared` are BROADCAST session events (forwarded to every WS surface, folded by the
  TUI transcript/title and the GUI reducer's new `sessionName`/transcript-reset state);
  `session-execution-started` rides `result.data.sessionExecution`; the plugin-registry refresh
  rides `result.data.pluginRegistryReloaded`. A mechanical grep floor
  (`command-effect-grep-floor.test.ts`) keeps `tui-requested`/`TCommandEffect`/`effects:` out of
  every `packages/*/src` production tree.
- 44393be: Add the `/remote-control` enable path (REMOTE-008 Stage B4-2b) — turn on P2P remote control locally, get
  a QR + link, and a paired device co-drives the SAME live session over pairing-gated WebRTC. The command
  is a declarative trigger returning `remote-control-enable-requested`/`-stop-requested` effects (SSOT
  agent-interface-transport) and reads state via a new `ICommandHostAdapters.remoteControl.getStatus()`;
  the TUI dispatches the effects to injected callbacks; all transport construction lives at the agent-cli
  composition root (`WsSignalingClient` + pairing-gated `WebRtcTransport`, relay URL from
  `transports.webrtc.options.relayUrl`, QR/link rendered into history). Fail-closed: no relay configured ⇒
  does nothing; pairing mismatch/timeout ⇒ the session is never exposed. Consumes REMOTE-007 so a paired
  remote owner answers their own permission/ask prompts over the WebRTC channel.
- 9f602df: Add user-supplied TURN fallback for remote control (REMOTE-010 / Stage E1) so P2P works behind symmetric
  NAT / restrictive firewalls. The host reads + validates `transports.webrtc.options.iceServers`/`forceTurn`
  at the agent-cli composition root (a fail-closed validator narrowing the untyped value → `IIceServer[]`;
  `IWebRtcTransportOptions.iceServers` widened to carry TURN `username`/`credential`), and the browser reads a
  validated `ice`/`forceTurn` pairing-URL query param (fail-closed decoder for the attacker-influenceable value;
  `forceTurn` → `iceTransportPolicy: 'relay'`) — both threaded into their `RTCPeerConnection`. `forceTurn` without
  a TURN server fails closed (else ICE gathers no candidates and silently never connects). Absent ICE config ⇒
  host-candidate-only, unchanged.

  (Bump target corrected during REL-023 triage: `@robota-sdk/agent-web-ui` was dissolved by GUI-006 (#1141, 2026-07-12) before this work was ever published; the browser-side ICE/`forceTurn` handling described here now lives in `@robota-sdk/agent-transport-webrtc-web`.)

- cbee54e: Surface unmatched preset command-module names instead of silently dropping them (INFRA-032). A preset `enabledCommandModules`/`disabledCommandModules` entry that matches no built command module — a short form like `"editor"` instead of `agent-command-editor`, or a typo — is now reported as a non-fatal notice on both the startup `--preset` path (CLI terminal) and the in-session `/preset` path (command result). Detection lives once in agent-framework's new pure `findUnknownModuleNames`, and agent-command's duplicate module filter now delegates to the framework's `selectCommandModules`; `createDefaultCommandModules` returns `{ modules, unknownModuleNames }`.

### Patch Changes

- 1698be4: A child-process subagent can no longer send the parent's provider credential to a different
  endpoint.

  - **Before spawning a child**, the parent compares every environment variable that decides where
    the provider connects or which credential it sends. If the child's environment differs, the job
    is refused before the credential leaves the parent. The error names the variable, never its
    value. The variables compared are:
    - the proxy and TLS variables;
    - the variables the provider's SDK reads, such as `OPENAI_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and
      the Vertex settings;
    - the credential's own variable.
  - **The child** repeats the check before it builds its provider. It builds that provider from the
    parent's effective connection exactly: it no longer fills in a base URL, options or a default
    credential from its own registry, and a credential reference that resolves to nothing is refused.
  - **Where the effective connection comes from:** the parent applies its own definition defaults
    (base URL, options). `profileName` is sent only when it names the connection actually sent.
  - **New contracts:**
    - `IProviderDefinition.destinationEnvironment`, declared by every built-in provider.
    - `createProviderFromExactProfile`, `connectionEnvironmentNames`,
      `findConnectionEnvironmentDivergence`, `sealConnectionEnvironment`,
      `verifyConnectionEnvironment` and `TRANSPORT_ENVIRONMENT`.
    - The start payload's `connectionCheck`.
    - The child-process runner's `providerDefinitions` option, now required: a provider with no
      definition there is refused, because its connection cannot be checked.

- 2711ec6: One broken skill or agent file no longer stops the session.

  Skill, command and agent definitions are shared with other hosts through `.claude`, and those hosts
  define fields of their own. The frontmatter decoder now validates only the fields robota owns and
  ignores the rest (nested `metadata` entries included); a malformed value of an owned field is still
  refused. A refused file is skipped with a single warning and still claims its name, so a
  lower-priority definition cannot stand in for it. An empty `argument-hint` reads as no hint. When
  initialization does fail, the session reports the cause to readiness probes instead of "not
  initialized", so the terminal shows the reason at once rather than a 15-second timeout.

  The terminal also stops printing type names for message-less telemetry records, keeps its own notices
  in place across a history sync so the following answer is not skipped, and CLI diagnostics print
  their context instead of `[object Object]`, through the console so Ink renders them above the frame.

- d157f4b: ARCH-008 — `robota` resolves presets through the composition kernel's per-call registry, so there is one
  preset resolution path instead of two.

  - **`@robota-sdk/agent-product`** — `IProductProfile` gains two optional fields. `presetRegistry` lets a
    consumer hand in an `IPresetRegistry` it already built (`createPresetRegistry`); when present the
    assembler ADOPTS that instance instead of building a second, equivalent one, so `product.presets` is
    that very object. This is the seam for a shell that must resolve a preset BEFORE it can build its
    profile — a preset can carry the `model` and `agentName` the profile is itself constructed from, so
    "resolve, then assemble" is a real ordering constraint. `presetContext` carries the override layers
    (`cliOverrides` / `explicit`) used when resolving `defaultPresetId`, so `product.defaultPreset` is the
    caller's full resolution rather than a variant missing its overrides. R8 is unaffected: the registry is
    still instance-scoped and no module-level state is read or mutated. Both fields are optional and the
    existing `presets` + `defaultPresetId` shape behaves exactly as before.
  - **`@robota-sdk/agent-cli`** — `resolveCliPreset` is replaced by `resolveShellPreset(externalPresets,
args, settingsPreset)`, which builds the per-call registry, resolves over it, and returns
    `{ registry, presetId, context, options }` as one value. `createRobotaProfile` takes that whole value,
    so the shell cannot hand the kernel a registry, id, or override context other than the ones it actually
    resolved with. `robota`'s startup path no longer reads `agent-preset`'s module-global resolver; that
    registry remains only as the in-session `/preset` DISCOVERY surface, which is executed inside the
    session and has no handle on the assembled product. Both surfaces are fed by the one
    `loadExternalPresets()` call, so they cannot disagree.

  End-user `robota` behavior is unchanged: the same preset resolves to the same options, external presets
  in `~/.robota/presets/*.json` remain visible to both `--preset <id>` and `/preset`, and the assembled
  command-module set, provider surface, tool set, subagent roster, and permission posture are untouched.

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

- 0c07176: **BREAKING — ARCH-021: child-process subagents compose the PRODUCT's surface, not imported defaults.**

  The child-process worker built its surface from `createDefaultProviderDefinitions()` and `createDefaultTools()` — a fixed six-vendor registry and the framework's default tool tier — while the composition root had already handed the runner the fully composed surface and the runner dropped it. So a product's custom providers and pack-contributed tools reached an **in-process** subagent and not a **child-process** one, and ARCH-006's landed invariant "every tool robota runs comes from a pack" was **false in the child**: dropping a pack did not drop its tools.

  This is the second finding at that line. ARCH-010 — judged BLOCKER, a subagent `Read` returning `/etc/hostname` — patched one argument there and left the reconstruction standing.

  ```ts
  // the port: what the product composes, stated by the composition root
  export interface ISubagentWorkerComposition {
    createTools(context: { readonly cwd: string }): IToolWithEventService[];
    readonly providerDefinitions: readonly IProviderDefinition[];
  }

  export function runSubagentWorkerMain(composition: ISubagentWorkerComposition): void;
  ```

  **Why a recipe and not a broker.** A composition cannot be projected across a process boundary because it is _code_: `createProvider` is a function and a tool carries `execute`. The two sound answers are to proxy the instances or to stop expressing the contract as instances. Proxying loses on containment — a proxied tool executes in the **parent**, bound to the parent's checkout, while a worktree-isolated child's execution root is a different directory — and a prior-art sweep found **no specification that defines a per-call working root for a proxied tool invocation** (MCP roots are session-scoped and pull-based). So the recipe crosses and the child builds an equivalent surface at its own root, which is what every comparable product does.

  **Per package, classified against each barrel:**

  - **`agent-subagent-runner` (major)** — `runSubagentWorkerMain` gains a **required** parameter; `ISubagentWorkerComposition` is added to the barrel; `ISubagentWorkerReadyMessage` gains `composedToolNames?`; and the `@robota-sdk/agent-provider-defaults` **dependency edge is removed**.
  - **`agent-cli` (patch)** — composition-root wiring plus one new internal `product/` module; no barrel change.

  **The structural guarantee reaches one axis, and the document says so.** Deleting the manifest edge makes the **provider** axis a compile error, because that package solely owns `createDefaultProviderDefinitions`. The **tool** axis cannot be cut the same way: `createDefaultTools` is barrel-exported by `agent-framework`, which this package must keep for `createSubagentSession`. That axis is held by a new `harness:scan` check instead — and it is the axis with the failure history, so claiming compile-time enforcement across both would have been an overclaim exactly where it matters. The cause (no defaults-aggregator leaf for the tool surface) is tracked as ARCH-035.

  **Fail closed on what a recipe cannot reproduce.** A recipe carries anything that is a pure function of (execution root, serialized payload, ambient durable state) — not a live, unrepeatable handle. Today that is `sandboxClient`, and it is reachable with public code (`E2BSandboxClient` and `InMemorySandboxClient` are both on `agent-tools`' barrel). The composition root now **refuses** to select the child-process runner in that case, naming the capability, rather than yielding a sandboxed parent with a host-tool child. Projection is tracked as ARCH-033.

  **Verified per run, not by construction.** The child declares its composed tool names in `ready`, so the built binary can be asked what it actually composed. Measured on the real artifact: `["Shell","Bash","Read","Write","Edit","Glob","Grep","WebFetch","WebSearch","AskUserQuestion"]` — `pack-coding`'s surface, from the product's own packs.

  **Also filed rather than folded in:** ARCH-034 (in-process and child-process subagents get different tool surfaces), ARCH-036 (`deps.builtInAgents` is dropped by the child-process path), SEC-009 (`apiKey` rides in the IPC start payload; comparable products use the child's environment).

- 4772067: **BREAKING — ARCH-031: the subagent seam is derived from its transport SSOT instead of copied.**

  One field family — what a subagent job IS — was declared three times as independent shapes and carried
  between them by six hand-written object literals that nothing checked for totality. A field added to
  either side had to be hand-copied at every hop, and a miss compiled clean as a silent no-op. TYPE-003
  named this cause and derived one hop; the next two changes each dropped a field at a hop it had skipped
  (CORE-025's permission policy, and ANALYTICS-001's `usage`, dropped in the very commit that added it).

  ```ts
  // now, in @robota-sdk/agent-interface-transport
  export type ISubagentSpawnRequest = Omit<IAgentBackgroundTaskRequest, 'kind'>;
  export type ISubagentJobResult = Omit<IBackgroundTaskResult, 'kind' | 'exitCode' | 'signalCode'>;
  ```

  All four projections collapse to spreads. `parentTaskId` and `providerProfile` now reach the runner
  because they exist on the source, not because someone remembered them.

  **Per package, classified against each barrel:**

  - **`agent-executor` (major)** — the barrel loses `ISubagentSpawnRequest` and `ISubagentJobResult` (they
    moved to their owner; re-publishing them here would be a pass-through re-export). `ISubagentJobStart`
    and `ISubagentJobHandle` rename `jobId` → `taskId`, `ISubagentJobStart` gains `worktree?`, and
    `ISubagentWorktreePrepareRequest` renames `jobId` → `taskId`.
  - **`agent-framework` (major)** — the barrel loses eleven type-only re-exports of `agent-executor`-owned
    types. They carried zero runtime values, so they bought none of the assembly convenience a runtime
    facade exists for, while making one field family look like it had three owners. Separately,
    `ISpawnAgentTaskRequest.permissionPolicy` goes optional → **required**.
  - **`agent-subagent-runner` (major)** — `ISubagentWorkerStartPayload` renames `jobId` → `taskId` and gains
    `worktree?`. This package is not in the item's declared `area:`; the audit that caught it is the reason
    it is here.
  - **`agent-interface-transport` (minor)** — two new barrel exports; nothing removed or renamed.
  - **`agent-core` (minor)** — **two** new barrel exports. `DEFAULT_BACKGROUND_PERMISSION_POLICY` is the
    intended one; collapsing the hand-listed permissions block to `export *` also surfaced
    `clearRegisteredToolArgumentKeys`, which the old list had omitted. It is documented as public rather
    than re-narrowed — a barrel that cannot fall out of step with its owner is the point of the collapse.
    Nothing was removed: all nine previously-listed permission types remain on the barrel.
  - **`agent-cli` (patch)** — migrated as the only in-repo implementer of `ISubagentWorktreeAdapter`; no
    barrel change.

  **`permissionPolicy` is now required at the spawn boundary**, and its default is one exported constant
  owned by the permission SSOT. It was previously applied as `?? 'inherit-allowlist'` in the middle of a
  projection, in **two** packages independently, with nothing keeping them equal — a security-relevant value
  whose default was declared twice. Every spawn site now states its own policy.

  **The worktree identity moved to the runner envelope.** It is runner-produced — the worktree does not
  exist when a caller builds a request — so it rides on `ISubagentJobStart.worktree` and crosses the IPC
  boundary there. The runner no longer also rewrites `request.cwd`, which had given ARCH-010's execution-root
  rule two carriers that could disagree. `branchName` **relocated rather than being deleted**: it has no
  reader in this repository today, and for a library that is not a reason to drop a legitimate contract.

  **Renames are consistent across the SPI** (`type` → `agentType`, `jobId` → `taskId`) rather than applied to
  one shape, which would have left two names for one identifier in a single file. The IPC validator's
  string-literal keys are now typed against the contract, so the next rename is a compile error instead of a
  runtime rejection of every start payload.

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- 6fab98f: **BREAKING — DIST-006: the built `robota` binary could not spawn a subagent at all.**

  `/agent run` failed on every distributed build with `Subagent worker exited before result: exit code 1`. The child's real stderr was `Cannot find module '…/agent-cli/dist/node/child-process-subagent-worker.js'`. `getDefaultSubagentWorkerPath()` resolved the worker relative to its own `import.meta.url`; INFRA-028 bundles every workspace package into `agent-cli/dist/node/bin.js`, so at runtime that directory is **agent-cli's** dist, where the worker was never emitted. It worked from source, which is why nothing caught it.

  **Second occurrence of one cause.** `agent-subagent-runner/tsdown.config.ts` already carried a comment naming this exact failure: _"Without this entry the file never existed, so the child-process subagent silently failed from any dist build."_ That fix put the worker next to its OWN package's bundle; bundling then moved the resolver's notion of "next to me" one package along.

  **The defect was the function, not the missing file.** `getDefaultSubagentWorkerPath()` answered _"where is my worker file on disk?"_ from a library that cannot know — the answer is a property of the packaging step. Emitting the file where the resolver looks would have fixed **one of three shipped artifacts**: the npm bundle, but not the Bun single-file binaries published on every tag, nor the Electron desktop sidecar that embeds them. A compiled single-file executable has no sibling directory to emit into.

  ```ts
  // removed — a question no library can answer
  export function getDefaultSubagentWorkerPath(): string;

  // now: the composition root states how to start a copy of ITSELF
  export interface ISubagentWorkerEntry {
    readonly execPath: string;
    readonly args: readonly string[];
    readonly execArgv?: readonly string[];
  }
  ```

  `IChildProcessSubagentRunnerOptions.workerPath` → **`workerEntry`**, and the runner `spawn`s `execPath args… --__robota-subagent-worker` instead of forking a module path. `robota`'s own entry enters worker mode through the new `runSubagentWorkerMain()`, so **there is no second artifact and no path to get wrong**. The one seam satisfies all three shapes: a bundled Node build names the file it is executing, a `tsx` source run names the same and adds `--import tsx`, and a compiled binary names _nothing_ — `process.execPath` is the binary, and re-executing it re-enters its embedded entry.

  **Per package, classified against each barrel:**

  - **`agent-subagent-runner` (major)** — the barrel loses `getDefaultSubagentWorkerPath` (deleted, not renamed) and gains `SUBAGENT_WORKER_MODE_FLAG`, `isSubagentWorkerModeArgv`, `runSubagentWorkerMain`, `ISubagentWorkerEntry`. `IChildProcessSubagentRunnerOptions` renames `workerPath` → `workerEntry` and drops `execArgv` — it now has exactly one owner, on the entry descriptor. The separate `child-process-subagent-worker` bundle entry is gone.
  - **`agent-cli` (patch)** — composition-root wiring only; no barrel change.

  **Two things this also repairs, both found in review:**

  - **The child's stderr was discarded** (`stdio: [..., 'ignore', 'ipc']`), so a worker that died before its first IPC message reported only an exit code. That is why occurrence #2 had to be diagnosed by hand. It is now captured, bounded, and appended to the error, making the next occurrence self-reporting.
  - **A source run executed the BUILT worker, not the source worker**, because package `exports` resolve to `dist`. `resolveExecArgv`'s `--import tsx` branch was therefore dead code. Self-fork names the entry actually running, so source runs finally run source.

  **Verified against the artifacts, not from source:** the built `dist/node/bin.js` and a real `bun --compile` single-file binary each complete the worker IPC handshake (`{type:'ready'}`), each refuse a hand-typed flag with no IPC channel (exit 2, "Silence is not success" — measured on both), and the shipped bundle no longer contains the string `child-process-subagent-worker.js` — there is nothing left to look for.

- 1e40b5b: Move handoff source/destination orchestration and its contract from agent-framework to the session-mobility owner. Import `HandoffSource`, `HandoffDestination`, and their option types from `@robota-sdk/agent-interface-session-mobility`. Mobility now applies offer and authority decisions directly, while the CLI supplies wire effects and the session-record decoder. A successful offer no longer returns a mutable authority transaction.
- f3fe3db: The terminal renderer no longer reads `ROBOTA_SCREEN_READER_STARTUP_QUIET_MS` or
  `ROBOTA_SCREEN_READER_PREPARK_MS` from the process environment. SDK hosts calling `renderApp`
  directly should pass raw timing choices and diagnostic labels through the new optional
  `screenReaderPacing` render option. Without it, the renderer uses its existing 900 ms startup
  quiet period and 50 ms pre-write park when screen-reader mode is enabled. The Robota CLI still
  reads the same environment variables and preserves their validation, bounds, and warnings.
- 724d5b6: The terminal renderer no longer reads `ROBOTA_IME_CURSOR` or `ROBOTA_TURN_MARKS` from the process environment. SDK hosts calling `renderApp` directly should pass cursor and turn-mark choices through the optional `terminalCapabilities` render option. Without a host choice, the renderer keeps its terminal and TTY defaults. The Robota CLI still reads both environment variables and preserves its exact `1` and `0` overrides.
- c6c56a6: Move the concrete `GitWorktreeIsolationAdapter` (git CLI + filesystem I/O) out of the reusable
  `@robota-sdk/agent-executor` runtime-primitives package into the `@robota-sdk/agent-cli` composition
  root, restoring the executor's "creates no Git worktrees" boundary (ARL-02 / ARCH-FIX-024, INFRA-031).

  **Breaking (`@robota-sdk/agent-subagent-runner`):** `worktreeAdapter` is now a **required** option on
  `createChildProcessSubagentRunnerFactory` / `IChildProcessSubagentRunnerOptions`. The concrete git
  default (`createGitWorktreeIsolationAdapter()`) has been removed — inject the adapter at the composition
  root. `@robota-sdk/agent-executor` no longer exports `GitWorktreeIsolationAdapter`,
  `createGitWorktreeIsolationAdapter`, or `IGitWorktreeIsolationAdapterOptions` (the
  `ISubagentWorktreeAdapter` port and `WorktreeSubagentRunner` remain). CLI runtime behavior is unchanged.

- 4b76cfa: NEUT-005 (wave 2): restore an actionable context-capacity hint at the surface tier, neutrally. The zero-dependency `agent-core` layer emits a product-neutral hard-capacity notice and exposes the `IAgentConfig.contextCapacityHint` seam (wave 1). This wave wires that seam end-to-end without baking product vocabulary into a neutral library:

  - `agent-session`: `ISessionOptions.contextCapacityHint` is forwarded into the Robota agent config (`buildRobota`), making the core seam reachable from the consuming layer.
  - `agent-framework`: new `deriveContextCapacityHint(commandModules)` derives the concrete remediation wording from the surface's OWN registered command set (names a registered `compact` command → `"Run /compact and retry."`; `undefined` when none, leaving the neutral core default). It is applied automatically in interactive session assembly across the TUI, print, and `--serve` surfaces.
  - `agent-cli`: the default command set registers `/compact`, so end users regain the actionable hint.
  - `agent-interface-transport`: reworded the `'allow-project'` permission comment so it no longer hardcodes a storage path (the location is owned by the consuming layer), matching the `agent-session` twin.

- 796ddb4: Use a neutral default MCP client name and let hosts supply their own protocol identity. Robota CLI startup now explicitly supplies its prior `robota-agent-mcp` name, preserving its initialize handshake; embedders relying on that implicit name can set `clientInfo` explicitly.
- e13c30c: MCP servers now publish a neutral submission tool by default. Hosts that need the previous
  `robota_submit` tool must pass `submitTool: { name: 'robota_submit', description: '...' }` to
  `createAgentMcpServer`, `createMcpTransport`, or `createMcpHttpHost`. The Robota CLI supplies its
  existing name and description for both stdio and HTTP carriers.
- 90e7a10: The default background observer warning code and exported `OBSERVER_FAILURE_WARNING_CODE` value
  change from `ROBOTA_BACKGROUND_OBSERVER_FAILURE` to `BACKGROUND_OBSERVER_FAILURE`. Hosts matching
  the old warning code should match the new neutral code or provide `observerFailureWarningCode` in
  their background manager or session options. The Robota CLI supplies its existing code explicitly
  across print, goal, serve, MCP, and TUI sessions.
- 2db1b97: Remote-control pairing binds to the negotiated DTLS certificate.

  - The Node host reads the remote fingerprint from the certificate the DTLS layer verified, not from the answer's
    SDP text, and builds the pairing gate once the DTLS handshake completes.
  - An SDP must advertise exactly one DTLS fingerprint. `extractDtlsFingerprint` now throws when two different
    fingerprints are present, and `extractDtlsFingerprintAttribute` returns the algorithm with the value.
  - A start takes one answer (host) and a connection takes one offer (browser client); a later description is
    ignored.

- fcb0da3: PAYLOAD-2153: make external-payload replay stable across Linux, macOS, and Windows.

  - Add the domain-free `@robota-sdk/agent-file-authority` leaf with bounded, root-relative reads over retained native handles and a typed, path-safe refusal taxonomy.
  - Route session replay and framework project reads through the shared authority while preserving their existing domain-specific budgets, integrity checks, and error mappings.
  - Expose the canonical safe session-id predicate through the framework facade so CLI exact-session lookup stays within the SDK package boundary.
  - Package the pinned native bridge in clean-installed Node CLI archives and exact-host standalone Bun binaries, refusing unsupported or mismatched targets before artifact mutation.

- 07b627f: A local peer can now be answered, and what its turn may do depends on where it runs.

  - `agent-core`: the permission evaluator takes a peer turn's authority as one more input
    (`IPermissionEvaluationContext.peerTurn`), decided after the deny list and ceiling and before
    bypass and allow rules. A peer on another host uses no tool. A peer on the same host may use an
    inspect-class tool that declares `workspacePaths`, only when every named location resolves inside
    the workspace and is not a credential (`isSecretPath`); write and execute tools are refused unless
    enabled, and then every use asks. A tool declaring `repliesToPeer` exists only in a peer turn and
    asks once the turn used another tool. New: `isToolAvailableInPeerTurn`, `TPeerReach`,
    `IPeerTurnAuthority`. `IRunOptions.withholdHostedTools` leaves a provider's hosted tools out of a
    run's requests (`nativeWebTools` with `false` withholds a hosted tool for one call).
  - `agent-tools`: `Read` and `Glob` declare the arguments that say where they look. `Grep` does not:
    it reads files it was never named, so a peer turn does not get it.
  - `agent-session`: `ISessionRunOptions.peerReach` makes a run a peer turn for the permission policy;
    every ask in it needs a fresh approval, and its requests carry no provider-hosted tool. `ISessionOptions.allowPeerChanges` enables write and execute
    tools for same-host peer turns.
  - `agent-interface-session`: `ISubmitOptions.peer` (`IPeerTurnContext`) carries a peer turn's reach,
    the message it answers and the session a reply goes to.
  - `agent-interface-session-mobility`: `IPeerMessage.inReplyTo` threads a conversation;
    `peerReachOf(admission)` maps admission to a reach.
  - `agent-framework`: a peer turn is offered what its origin allows, and a new `peer_reply` tool
    answers the peer that sent the message, threaded to it. The setting `peers.allowChanges` enables
    write and execute tools for same-host peer turns.
  - `agent-ui-terminal`: a permission prompt in a peer turn names the requesting peer.
  - `agent-cli`: incoming peer turns carry their reach and reply route; a conversation is limited in
    depth and in how often this session answers it, and a reply over a limit is not sent and the
    operator is told.
  - `agent-provider-anthropic`, `agent-provider-openai-compatible` (Qwen): a request whose
    `nativeWebTools` sets a hosted tool to `false` is sent without it.

- 5ccd1e9: Add the browser remote client (REMOTE-009 Stage D) — the P2P peer that opens the pairing URL and
  co-drives a live session over WebRTC. `agent-web-ui` gains a native-`WebSocket` signaling client, a
  fail-closed responder pairing gate (session exposed only after the DTLS-fingerprint-bound handshake
  accepts), an RTC data-channel session client with the same contract as the WS client, a
  fragment-injected `spa/remote.html` static entry, and the REMOTE-007 permission/ask render+answer
  (the paired owner answers its own prompts — local == remote) shared by both the WS and RTC clients. It
  reuses the isomorphic `@robota-sdk/agent-remote-pairing` leaf and takes no node/werift dependency.
  `agent-cli` removes the fabricated `robota-remote://pair` client-URL default and fails closed when
  `transports.webrtc.options.clientUrl` is unset (no dead link).

  (Bump targets corrected during REL-023 triage: `@robota-sdk/agent-web-ui` was dissolved by GUI-006 (#1141, 2026-07-12) before this work was ever published; the browser client described here now lives in `@robota-sdk/agent-transport-webrtc-web` + `@robota-sdk/agent-remote-client`.)

- c7fa299: REMOTE-003 + REMOTE-006 (merged — net behavior; the interim deny-by-default gate never appeared in a
  published version): commands now carry an invocation source. A `'remote'` value is added to the command
  invocation source (SSOT relocated to `@robota-sdk/agent-interface-transport`, re-exported by
  `agent-framework`) and an optional `source` is threaded into
  `IInteractiveSession.executeCommand(name, args, source?)` (defaults to `'user'`, so all local callers are
  unchanged). The shared `createWsHandler` tags transport-origin commands `'remote'`. Policy: local == remote
  (owner principle) — pairing is the sole trust boundary, so a transport-origin command runs exactly as a
  locally-typed one under the universal permission system (permission modes + PermissionEnforcer + the
  ask/approval handler); `createDefaultRemoteCommandPolicy()` allows by default. The `IRemoteCommandPolicy`
  seam remains as an OPTIONAL, user-configured restriction, and the genuinely-remote WebRTC path stays
  pairing-gated.
- d19feda: Build a separate verified headless Bun artifact for the Electron desktop app. The full CLI binary and npm entry remain available; the desktop resource now copies the smaller presentation-free artifact while preserving the `--serve` wire and launch contract.
- 833afe1: Remove the remaining polynomial-ReDoS backtracking (SEC-003, CodeQL `js/polynomial-redos`) and stop the DTLS fingerprint binding to SDP free text.

  **`extractDtlsFingerprint` (agent-remote-pairing) — remote-reachable, pre-authentication.** Unlike the rest of this class, the SDP it parses arrives over the signaling relay, which the pairing design treats as untrusted, and it is parsed _before_ the channel-binding confirmation — on the browser peer, before `setRemoteDescription` too. Unanchored, `a=fingerprint:\S+\s+…` restarted from every offset in a non-space run: 5.0 s on a 400 KB SDP. It is now anchored to the start of an SDP line (`/^…/m`), which is linear and also stops the extractor from returning a value smuggled into another line's free text (`s=`, `i=`, an unrelated attribute) — text no DTLS stack reads, and which a relay controls. **Behaviour change:** a mid-line `a=fingerprint:` is no longer recognised. Every SDP a WebRTC stack emits puts the attribute at the start of its own line, so no real SDP is affected. A session-level line can still shadow a media-level one; that residual is recorded in the SEC-003 backlog.

  **Trailing-run trims (agent-framework, agent-cli, agent-tools).** `replace(/-+$/, '')`-shaped regexes have no start anchor, so the engine retried the run from every offset inside it and each retry rescanned to the end — 3.0 s at 100 K characters, ~50 s at 400 K. The memory topic sanitiser, the provider profile-name sanitiser, the model-command tool-name projection, the npm registry URL builder, the git-worktree path-segment sanitiser and the sandbox-root normaliser now use linear index scans (`trimEdgeChars` / `trimTrailingChars` in agent-framework, local helpers elsewhere), proven equivalent to the regexes they replace over every string of the relevant alphabet up to 12 characters.

  **Whitespace-ambiguity parsers (agent-framework).** The skill and agent-definition frontmatter list splitters used `/\s*,\s*/`, whose whitespace run overlapped nothing after it on a failed comma — 12.6 s on a 200 K run. They now split on `','`; the padding was already removed by the `.trim()` that follows, so the parsed lists are unchanged. The `.git` `gitdir:` pointer and the task-file open-item matcher used `\s*(.+)$` / `\s+(.+)$`, where `\s` and `.` both match a space; the capture is now pinned to start non-space, which accepts exactly the same inputs (verified exhaustively) and removes 14.5 s and 15.4 s worst cases.

  **`WebFetch` HTML-to-text (agent-tools) — carried no CodeQL alert.** Found by sweeping for the same shapes rather than the flagged lines, and the only quadratic here whose input is a live response body from an arbitrary URL. `<[^>]+>`, `<script[\s\S]*?</script>` and `<style…>` each restarted from every opener that had no terminator: 12.6 s on 200 KB of `<`, and the 5 MB the fetch allows would have taken hours. All three are now single-pass scans, verified character-for-character identical to the regexes over ~800 K generated inputs.

  Apart from the `extractDtlsFingerprint` anchoring noted above, no behaviour changes: every fix accepts the same inputs and produces the same values, and each ships an equivalence test pinning that.

- fde558e: Forward organization policy through TUI, print, and goal sessions so blocked commands are enforced consistently. Preserve print/goal preset generation, language, prompt-seed, and structured-response options through the headless channel, and guard declared session-capability projections against silent field loss.

## 3.0.0-beta.79

### Patch Changes

- Coordinated beta.79 release. Ships the natural-language workflow authoring feature and its
  follow-ups, all bundled into the published CLI:

  - **FLOW-007 `/workflows create "<description>"`** — author a workflow from natural language via the
    active provider, save it as a reusable `.workflows/<name>.json` artifact, and run it immediately;
    composes existing nodes and creates prompt-backed nodes on the fly; model-invocable so the agent can
    author + run from chat. Storage de-jargoned to a flat `.workflows/` layout with an injectable
    workspace.
  - Live-LLM hardening found by running against a real provider: the authoring call now threads the
    resolved model; the spec parser tolerates a Markdown code fence; authored prompt nodes inherit +
    persist the active provider; and the unit suite no longer makes real key-using calls (forces the
    no-key path + asserts detection), with real coverage isolated in an opt-in `test:live`.
  - **DATA-003** — the instant-node package now owns a runtime provider SSOT (`INSTANT_NODE_PROVIDERS`)
    and a symmetric persistence round-trip (`parsePersistedInstantNode` / `rehydrateInstantNode` +
    guards), removing duplicated provider lists and a hand-rolled, prompt-only reload path.

  (The DAG/workflow subsystem stays private and is bundled into the CLI; no new runtime `@robota-sdk`
  edge is added.)

## 3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77
  - @robota-sdk/agent-command@3.0.0-beta.77
  - @robota-sdk/agent-executor@3.0.0-beta.77
  - @robota-sdk/agent-framework@3.0.0-beta.77
  - @robota-sdk/agent-provider@3.0.0-beta.77
  - @robota-sdk/agent-session-analytics@3.0.0-beta.77
  - @robota-sdk/agent-subagent-runner@3.0.0-beta.77
  - @robota-sdk/agent-transport@3.0.0-beta.77
  - @robota-sdk/agent-transport-tui@3.0.0-beta.77
  - @robota-sdk/agent-transport-ws@3.0.0-beta.77
  - @robota-sdk/agent-preset@3.0.0-beta.77

## 3.0.0-beta.76

### Patch Changes

- c0a6287: Relocate session feature logic out of the CLI shell and the transport (DQ-AUDIT-004):

  - Extract session-log timing analysis into the new `@robota-sdk/agent-session-analytics` package (pure analysis over canonical session records — no duplicate types, no file I/O). `agent-cli`'s `session analyze` command shrinks to thin wiring and loads records via the new `createUserSessionStore()` / existing `createProjectSessionStore()` framework facades.
  - Move LLM-based session auto-naming (`generateSessionName`) from `agent-transport/tui` into `agent-framework` (session-lifecycle owner); the TUI transport now invokes it through the framework.

- 9df3a88: Split the consolidated `@robota-sdk/agent-transport` package into per-concern transport packages (DQ-AUDIT-005) so unrelated heavy dependencies (React/Ink, ws, Hono, MCP SDK) no longer share one publishable unit and are not dragged into non-TUI consumers' graphs:

  - `@robota-sdk/agent-transport` — lean core: headless adapter + `TransportRegistry` + scripted-provider testing fixtures (no external runtime deps).
  - `@robota-sdk/agent-transport-tui` — React + Ink terminal UI.
  - `@robota-sdk/agent-transport-ws` — WebSocket transport + protocol (`agent-web-ui` now depends only on this for WS types).
  - `@robota-sdk/agent-transport-http` — Hono HTTP transport.
  - `@robota-sdk/agent-transport-mcp` — MCP server transport.

  The default transport-registry wiring (pre-registering `WsTransport`) moves to the CLI composition root, removing the core→ws edge.

- Updated dependencies
- Updated dependencies
- Updated dependencies [c0a6287]
- Updated dependencies [9df3a88]
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76
  - @robota-sdk/agent-command@3.0.0-beta.76
  - @robota-sdk/agent-transport@3.0.0-beta.76
  - @robota-sdk/agent-transport-tui@3.0.0-beta.76
  - @robota-sdk/agent-session-analytics@3.0.0-beta.76
  - @robota-sdk/agent-framework@3.0.0-beta.76
  - @robota-sdk/agent-transport-ws@3.0.0-beta.76
  - @robota-sdk/agent-provider@3.0.0-beta.76
  - @robota-sdk/agent-subagent-runner@3.0.0-beta.76
  - @robota-sdk/agent-preset@3.0.0-beta.76

## 3.0.0-beta.75

### Patch Changes

- Agent preset system + live preset switching + context/history correctness fixes.

  - **Preset system (PRESET-001~017):** new `@robota-sdk/agent-preset` package layering framework
    assembly options into named, selectable profiles (`default`, `autonomous-builder`, `careful-reviewer`,
    `neutral-executor`) plus user-authored external presets loaded from `~/.robota/presets/*.json`.
  - **Live preset switching:** `/preset` command (list + active marker + switch) and a TUI active-preset
    display. Switching live re-applies permission posture, model/effort, persona, command-module
    selection, parallel-subagents gating, and a self-verification system-prompt section via the single
    `applyPresetToSession` engine.
  - **CTX-001:** the TUI Context display + session auto-compact now use the accurate provider-based token
    estimate (system prompt + tool schemas included) instead of a crude history-only char heuristic.
  - **HIST-001:** conversation history is now append-only — removed the silent 100-message count cap that
    could drop early context; context size is managed solely by size-based compaction.

- Updated dependencies
  - @robota-sdk/agent-preset@3.0.0-beta.75
  - @robota-sdk/agent-framework@3.0.0-beta.75
  - @robota-sdk/agent-core@3.0.0-beta.75
  - @robota-sdk/agent-command@3.0.0-beta.75
  - @robota-sdk/agent-transport@3.0.0-beta.75
  - @robota-sdk/agent-subagent-runner@3.0.0-beta.75
  - @robota-sdk/agent-provider@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.74
  - @robota-sdk/agent-command@3.0.0-beta.74
  - @robota-sdk/agent-subagent-runner@3.0.0-beta.74
  - @robota-sdk/agent-transport@3.0.0-beta.74
  - @robota-sdk/agent-core@3.0.0-beta.74
  - @robota-sdk/agent-provider@3.0.0-beta.74

## 3.0.0-beta.73

### Patch Changes

- Updated dependencies [d4fd33f]
  - @robota-sdk/agent-transport@3.0.0-beta.73
  - @robota-sdk/agent-command@3.0.0-beta.73
  - @robota-sdk/agent-core@3.0.0-beta.73
  - @robota-sdk/agent-framework@3.0.0-beta.73
  - @robota-sdk/agent-provider@3.0.0-beta.73
  - @robota-sdk/agent-subagent-runner@3.0.0-beta.73

## 3.0.0-beta.72

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.72
  - @robota-sdk/agent-transport@3.0.0-beta.72
  - @robota-sdk/agent-command@3.0.0-beta.72
  - @robota-sdk/agent-subagent-runner@3.0.0-beta.72
  - @robota-sdk/agent-core@3.0.0-beta.72
  - @robota-sdk/agent-provider@3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate
- Updated dependencies
  - @robota-sdk/agent-command@3.0.0-beta.71
  - @robota-sdk/agent-core@3.0.0-beta.71
  - @robota-sdk/agent-framework@3.0.0-beta.71
  - @robota-sdk/agent-provider@3.0.0-beta.71
  - @robota-sdk/agent-subagent-runner@3.0.0-beta.71
  - @robota-sdk/agent-transport@3.0.0-beta.71

## 3.0.0-beta.70

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-command@3.0.0-beta.70
  - @robota-sdk/agent-transport@3.0.0-beta.70
  - @robota-sdk/agent-framework@3.0.0-beta.70
  - @robota-sdk/agent-subagent-runner@3.0.0-beta.70
  - @robota-sdk/agent-core@3.0.0-beta.70
  - @robota-sdk/agent-provider@3.0.0-beta.70

## 3.0.0-beta.69

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.69
  - @robota-sdk/agent-command@3.0.0-beta.69
  - @robota-sdk/agent-subagent-runner@3.0.0-beta.69
  - @robota-sdk/agent-transport@3.0.0-beta.69
  - @robota-sdk/agent-core@3.0.0-beta.69
  - @robota-sdk/agent-provider@3.0.0-beta.69

## 3.0.0-beta.68

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-transport@3.0.0-beta.68
  - @robota-sdk/agent-command@3.0.0-beta.68
  - @robota-sdk/agent-core@3.0.0-beta.68
  - @robota-sdk/agent-framework@3.0.0-beta.68
  - @robota-sdk/agent-provider@3.0.0-beta.68
  - @robota-sdk/agent-subagent-runner@3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- CLIR: agent-cli layer separation, agent-framework interactive session improvements, subagent runner fix, TUI interface README
- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.67
  - @robota-sdk/agent-subagent-runner@3.0.0-beta.67
  - @robota-sdk/agent-command@3.0.0-beta.67
  - @robota-sdk/agent-transport@3.0.0-beta.67
  - @robota-sdk/agent-core@3.0.0-beta.67
  - @robota-sdk/agent-provider@3.0.0-beta.67

## 3.0.0-beta.66

### Patch Changes

- refactor: CLI-001/002 — agent-cli layer separation and monorepo-wide readability lint rules
  - CLI-001: Extract startup phases into focused modules; enforce agent-cli layer separation
  - CLI-002: Apply import/order, consistent-type-imports, explicit-function-return-type, prefer-const, object-shorthand across all packages
  - Fix stale child-process-subagent-worker entry in agent-cli tsdown.config.ts (build fix)

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.66
  - @robota-sdk/agent-command@3.0.0-beta.66
  - @robota-sdk/agent-transport@3.0.0-beta.66
  - @robota-sdk/agent-subagent-runner@3.0.0-beta.66
  - @robota-sdk/agent-core@3.0.0-beta.66
  - @robota-sdk/agent-executor@3.0.0-beta.66
  - @robota-sdk/agent-provider@3.0.0-beta.66

## 3.0.0-beta.65

### Minor Changes

- feat(CMD-003): TUI command interaction — picker/confirm overlay on missing args
  - Add `command-interaction.ts` with `ITuiPickerInteraction`, `ITuiConfirmInteraction`, `TAnyTuiCommandInteraction` types
  - Add `CommandPicker` and `CommandConfirm` Ink overlay components
  - Extend `TCommandSelectionResult` with `open-interaction` variant in input-area-flow
  - `resolveEnterCommandSelection` opens interaction overlay when command has `onMissingArgs` and no args typed
  - `InputArea` accepts `resolveInteraction` prop; renders picker/confirm overlay when active
  - Add `resolveInteraction` to `IRenderOptions` / `App` / `render`
  - Add `TUI_COMMAND_INTERACTIONS` registry in `agent-cli` with mode/language/provider/exit/clear interactions
  - Fix `SlashAutocomplete` to show technical command name (`cmd.name`) instead of `displayName`

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-transport@3.0.0-beta.65
  - @robota-sdk/agent-command@3.0.0-beta.65
  - @robota-sdk/agent-core@3.0.0-beta.65
  - @robota-sdk/agent-executor@3.0.0-beta.65
  - @robota-sdk/agent-framework@3.0.0-beta.65
  - @robota-sdk/agent-interface-transport@3.0.0-beta.65
  - @robota-sdk/agent-provider@3.0.0-beta.65

## 3.0.0-beta.64

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.64
  - @robota-sdk/agent-command@3.0.0-beta.64
  - @robota-sdk/agent-transport@3.0.0-beta.64
  - @robota-sdk/agent-core@3.0.0-beta.64
  - @robota-sdk/agent-executor@3.0.0-beta.64
  - @robota-sdk/agent-interface-transport@3.0.0-beta.64
  - @robota-sdk/agent-provider@3.0.0-beta.64

## 3.0.0-beta.63

### Patch Changes

- Add --help / -h CLI flag to print usage information and exit
  - @robota-sdk/agent-core@3.0.0-beta.63
  - @robota-sdk/agent-framework@3.0.0-beta.63
  - @robota-sdk/agent-command-agent@3.0.0-beta.63
  - @robota-sdk/agent-command-background@3.0.0-beta.63
  - @robota-sdk/agent-command-compact@3.0.0-beta.63
  - @robota-sdk/agent-command-context@3.0.0-beta.63
  - @robota-sdk/agent-command-exit@3.0.0-beta.63
  - @robota-sdk/agent-command-help@3.0.0-beta.63
  - @robota-sdk/agent-command-language@3.0.0-beta.63
  - @robota-sdk/agent-command-memory@3.0.0-beta.63
  - @robota-sdk/agent-command-mode@3.0.0-beta.63
  - @robota-sdk/agent-command-model@3.0.0-beta.63
  - @robota-sdk/agent-command-permissions@3.0.0-beta.63
  - @robota-sdk/agent-command-plugin@3.0.0-beta.63
  - @robota-sdk/agent-command-provider@3.0.0-beta.63
  - @robota-sdk/agent-command-reset@3.0.0-beta.63
  - @robota-sdk/agent-command-rewind@3.0.0-beta.63
  - @robota-sdk/agent-command-session@3.0.0-beta.63
  - @robota-sdk/agent-command-statusline@3.0.0-beta.63
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.63
  - @robota-sdk/agent-provider-deepseek@3.0.0-beta.63
  - @robota-sdk/agent-provider-openai@3.0.0-beta.63
  - @robota-sdk/agent-provider-gemma@3.0.0-beta.63
  - @robota-sdk/agent-provider-gemini@3.0.0-beta.63
  - @robota-sdk/agent-transport-ws@3.0.0-beta.63
  - @robota-sdk/agent-transport-headless@3.0.0-beta.63
  - @robota-sdk/agent-command-settings@3.0.0-beta.63
  - @robota-sdk/agent-command-skills@3.0.0-beta.63
  - @robota-sdk/agent-command-user-local@3.0.0-beta.63
  - @robota-sdk/agent-interface-transport@3.0.0-beta.63
  - @robota-sdk/agent-provider-qwen@3.0.0-beta.63
  - @robota-sdk/agent-transport-tui@3.0.0-beta.63

## 3.0.0-beta.62

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.62
  - @robota-sdk/agent-command-provider@3.0.0-beta.62
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.62
  - @robota-sdk/agent-provider-deepseek@3.0.0-beta.62
  - @robota-sdk/agent-provider-gemini@3.0.0-beta.62
  - @robota-sdk/agent-provider-gemma@3.0.0-beta.62
  - @robota-sdk/agent-provider-openai@3.0.0-beta.62
  - @robota-sdk/agent-provider-qwen@3.0.0-beta.62
  - @robota-sdk/agent-framework@3.0.0-beta.62
  - @robota-sdk/agent-command-agent@3.0.0-beta.62
  - @robota-sdk/agent-command-background@3.0.0-beta.62
  - @robota-sdk/agent-command-compact@3.0.0-beta.62
  - @robota-sdk/agent-command-context@3.0.0-beta.62
  - @robota-sdk/agent-command-exit@3.0.0-beta.62
  - @robota-sdk/agent-command-help@3.0.0-beta.62
  - @robota-sdk/agent-command-language@3.0.0-beta.62
  - @robota-sdk/agent-command-memory@3.0.0-beta.62
  - @robota-sdk/agent-command-model@3.0.0-beta.62
  - @robota-sdk/agent-command-permissions@3.0.0-beta.62
  - @robota-sdk/agent-command-plugin@3.0.0-beta.62
  - @robota-sdk/agent-command-reset@3.0.0-beta.62
  - @robota-sdk/agent-command-rewind@3.0.0-beta.62
  - @robota-sdk/agent-command-session@3.0.0-beta.62
  - @robota-sdk/agent-command-skills@3.0.0-beta.62
  - @robota-sdk/agent-command-statusline@3.0.0-beta.62
  - @robota-sdk/agent-command-user-local@3.0.0-beta.62
  - @robota-sdk/agent-transport-headless@3.0.0-beta.62
  - @robota-sdk/agent-transport-ws@3.0.0-beta.62

## 3.0.0-beta.61

### Minor Changes

- b7cb169: Add first-class DeepSeek API provider support and include it in the default CLI provider definitions.

### Patch Changes

- cfb8b5a: Clean up the CLI status bar by hiding the baseline default permission mode and removing the duplicate right-side thinking indicator.
- cc0223d: Add SDK-owned provider profile name suggestions, create model-derived profile keys during interactive setup, and show the active provider profile identity in the CLI status area.
- d97bdf2: Add provider-owned model catalog metadata, route `/model` suggestions through the active provider, and make `cli:dev` resolve the CLI workspace dependency closure through source export conditions.
- Updated dependencies [e243fb0]
- Updated dependencies [b7cb169]
- Updated dependencies [1c0d44c]
- Updated dependencies [36eb7a9]
- Updated dependencies [cc0223d]
- Updated dependencies [18fcc5b]
- Updated dependencies [d97bdf2]
- Updated dependencies [3bde012]
  - @robota-sdk/agent-framework@3.0.0-beta.61
  - @robota-sdk/agent-provider-deepseek@3.0.0-beta.61
  - @robota-sdk/agent-core@3.0.0-beta.61
  - @robota-sdk/agent-command-session@3.0.0-beta.61
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.61
  - @robota-sdk/agent-provider-gemini@3.0.0-beta.61
  - @robota-sdk/agent-provider-gemma@3.0.0-beta.61
  - @robota-sdk/agent-provider-openai@3.0.0-beta.61
  - @robota-sdk/agent-provider-qwen@3.0.0-beta.61
  - @robota-sdk/agent-command-provider@3.0.0-beta.61
  - @robota-sdk/agent-command-model@3.0.0-beta.61
  - @robota-sdk/agent-command-agent@3.0.0-beta.61
  - @robota-sdk/agent-command-background@3.0.0-beta.61
  - @robota-sdk/agent-command-compact@3.0.0-beta.61
  - @robota-sdk/agent-command-context@3.0.0-beta.61
  - @robota-sdk/agent-command-exit@3.0.0-beta.61
  - @robota-sdk/agent-command-help@3.0.0-beta.61
  - @robota-sdk/agent-command-language@3.0.0-beta.61
  - @robota-sdk/agent-command-memory@3.0.0-beta.61
  - @robota-sdk/agent-command-permissions@3.0.0-beta.61
  - @robota-sdk/agent-command-plugin@3.0.0-beta.61
  - @robota-sdk/agent-command-reset@3.0.0-beta.61
  - @robota-sdk/agent-command-rewind@3.0.0-beta.61
  - @robota-sdk/agent-command-statusline@3.0.0-beta.61
  - @robota-sdk/agent-transport-headless@3.0.0-beta.61
  - @robota-sdk/agent-command-skills@3.0.0-beta.61

## 3.0.0-beta.60

### Minor Changes

- 7439391: Add provider-neutral native web search/fetch capability contracts, explicit unsupported handling for OpenAI-compatible/LM Studio profiles, and local WebFetch/WebSearch permission/documentation alignment.

### Patch Changes

- 0c77089: Validate the merged active provider profile during CLI startup so higher-priority provider selections with missing API keys are not masked by unrelated valid settings files.
- 41ae788: Restore the CLI thinking indicator and add structured Agent tool batch provenance/count metadata.
- Updated dependencies [41ae788]
- Updated dependencies [3d6bdf6]
- Updated dependencies [7439391]
  - @robota-sdk/agent-framework@3.0.0-beta.60
  - @robota-sdk/agent-provider-gemini@3.0.0-beta.60
  - @robota-sdk/agent-core@3.0.0-beta.60
  - @robota-sdk/agent-session@3.0.0-beta.60
  - @robota-sdk/agent-provider-openai@3.0.0-beta.60
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.60
  - @robota-sdk/agent-provider-gemma@3.0.0-beta.60
  - @robota-sdk/agent-provider-qwen@3.0.0-beta.60
  - @robota-sdk/agent-command-agent@3.0.0-beta.60
  - @robota-sdk/agent-command-background@3.0.0-beta.60
  - @robota-sdk/agent-command-compact@3.0.0-beta.60
  - @robota-sdk/agent-command-context@3.0.0-beta.60
  - @robota-sdk/agent-command-exit@3.0.0-beta.60
  - @robota-sdk/agent-command-help@3.0.0-beta.60
  - @robota-sdk/agent-command-language@3.0.0-beta.60
  - @robota-sdk/agent-command-memory@3.0.0-beta.60
  - @robota-sdk/agent-command-mode@3.0.0-beta.60
  - @robota-sdk/agent-command-model@3.0.0-beta.60
  - @robota-sdk/agent-command-permissions@3.0.0-beta.60
  - @robota-sdk/agent-command-plugin@3.0.0-beta.60
  - @robota-sdk/agent-command-provider@3.0.0-beta.60
  - @robota-sdk/agent-command-reset@3.0.0-beta.60
  - @robota-sdk/agent-command-rewind@3.0.0-beta.60
  - @robota-sdk/agent-command-session@3.0.0-beta.60
  - @robota-sdk/agent-command-statusline@3.0.0-beta.60
  - @robota-sdk/agent-transport-headless@3.0.0-beta.60

## 3.0.0-beta.59

### Patch Changes

- @robota-sdk/agent-framework@3.0.0-beta.59
- @robota-sdk/agent-command-agent@3.0.0-beta.59
- @robota-sdk/agent-transport-headless@3.0.0-beta.59
- @robota-sdk/agent-core@3.0.0-beta.59
- @robota-sdk/agent-session@3.0.0-beta.59
- @robota-sdk/agent-provider-anthropic@3.0.0-beta.59
- @robota-sdk/agent-provider-openai@3.0.0-beta.59
- @robota-sdk/agent-provider-gemma@3.0.0-beta.59
- @robota-sdk/agent-provider-gemini@3.0.0-beta.59
- @robota-sdk/agent-provider-qwen@3.0.0-beta.59

## 3.0.0-beta.58

### Patch Changes

- Refresh package docs and robota.io content for the beta 57 feature set.
- Updated dependencies
  - @robota-sdk/agent-command-agent@3.0.0-beta.58
  - @robota-sdk/agent-core@3.0.0-beta.58
  - @robota-sdk/agent-provider-gemini@3.0.0-beta.58
  - @robota-sdk/agent-provider-gemma@3.0.0-beta.58
  - @robota-sdk/agent-provider-qwen@3.0.0-beta.58
  - @robota-sdk/agent-framework@3.0.0-beta.58
  - @robota-sdk/agent-session@3.0.0-beta.58
  - @robota-sdk/agent-transport-headless@3.0.0-beta.58
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.58
  - @robota-sdk/agent-provider-openai@3.0.0-beta.58

## 3.0.0-beta.57

### Minor Changes

- b80e51e: Add SDK-owned automatic project memory capture, approval review, bounded retrieval, and session-log provenance.
- f61e2cb: Add Qwen provider-owned Responses API support for built-in web search/fetch tools and pass provider-owned profile options through generic CLI/runtime configuration.

### Patch Changes

- 16c3b6f: Persist and render provider-neutral per-turn usage summaries with pre-send context updates in CLI sessions.
- d3bcc0e: Move the active status indicator into the primary status-bar scan path with deterministic tool, thinking, background, queued, and idle priority.
- 4eca470: Render command tool output as bounded transcript previews and persist tool result metadata in SDK tool summaries.
- 1cfdce9: Add SDK-owned edit checkpointing for Write/Edit tool mutations with `/rewind` list and code restore commands.
- 90a2802: Render Edit tool summaries as context-aware diff hunks with structured truncation metadata.
- 26a1718: Preserve and render Edit tool diff metadata in persisted CLI tool summaries.
- 3509f1d: Add canonical Gemini provider package and keep the Google provider package as a compatibility wrapper.
- 8e056b1: Adopt Ink 7 paste and window-size hooks for CJK-aware input handling.
- 7e9e81c: Render background work as compact one-level tree rows with shared formatting and bounded previews.
- Updated dependencies [16c3b6f]
- Updated dependencies [b80e51e]
- Updated dependencies [4eca470]
- Updated dependencies [1cfdce9]
- Updated dependencies [90a2802]
- Updated dependencies [26a1718]
- Updated dependencies [3509f1d]
- Updated dependencies [e504d30]
- Updated dependencies [f61e2cb]
- Updated dependencies [0e0e533]
- Updated dependencies [822a78b]
- Updated dependencies [9817f99]
  - @robota-sdk/agent-core@3.0.0-beta.57
  - @robota-sdk/agent-session@3.0.0-beta.57
  - @robota-sdk/agent-framework@3.0.0-beta.57
  - @robota-sdk/agent-provider-gemini@3.0.0-beta.57
  - @robota-sdk/agent-provider-qwen@3.0.0-beta.57
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.57
  - @robota-sdk/agent-provider-gemma@3.0.0-beta.57
  - @robota-sdk/agent-provider-openai@3.0.0-beta.57
  - @robota-sdk/agent-command-agent@3.0.0-beta.57
  - @robota-sdk/agent-transport-headless@3.0.0-beta.57

## 3.0.0-beta.56

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.56
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.56
  - @robota-sdk/agent-provider-gemma@3.0.0-beta.56
  - @robota-sdk/agent-provider-openai@3.0.0-beta.56
  - @robota-sdk/agent-framework@3.0.0-beta.56
  - @robota-sdk/agent-session@3.0.0-beta.56
  - @robota-sdk/agent-command-agent@3.0.0-beta.56
  - @robota-sdk/agent-transport-headless@3.0.0-beta.56

## 3.0.0-beta.55

### Patch Changes

- 38a72bf: fix: resolve ESLint tsconfig parsing errors and improve pnpm CI reliability
  - Add tsconfig.eslint.json to all packages for per-package ESLint runs
  - Migrate typecheck from pnpm -r exec tsc to per-package typecheck scripts
  - Add --if-present to all recursive pnpm run scripts
  - Fix React type imports, dynamic imports in tests, Express.Multer types

- Updated dependencies [38a72bf]
  - @robota-sdk/agent-core@3.0.0-beta.55
  - @robota-sdk/agent-framework@3.0.0-beta.55
  - @robota-sdk/agent-session@3.0.0-beta.55
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.55
  - @robota-sdk/agent-transport-headless@3.0.0-beta.55

## 3.0.0-beta.54

### Patch Changes

- fix: resolve all typecheck errors across packages
- Updated dependencies
  - @robota-sdk/agent-session@3.0.0-beta.54
  - @robota-sdk/agent-framework@3.0.0-beta.54
  - @robota-sdk/agent-core@3.0.0-beta.54
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.54
  - @robota-sdk/agent-transport-headless@3.0.0-beta.54

## 3.0.0-beta.53

### Patch Changes

- refactor: monolith decomposition — all agent-\* files under 300 lines
- fix: PR #69 code review — session resume tool messages, type SSOT, fork isolation, settings crash, Notification removal, chat validation
- Updated dependencies
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.53
  - @robota-sdk/agent-framework@3.0.0-beta.53
  - @robota-sdk/agent-session@3.0.0-beta.53
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.53
  - @robota-sdk/agent-transport-headless@3.0.0-beta.53

## 3.0.0-beta.52

### Patch Changes

- fix: paste at cursor position + cursor moves to end of pasted label + cursorHint prop
  - @robota-sdk/agent-core@3.0.0-beta.52
  - @robota-sdk/agent-session@3.0.0-beta.52
  - @robota-sdk/agent-framework@3.0.0-beta.52
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.52
  - @robota-sdk/agent-transport-headless@3.0.0-beta.52

## 3.0.0-beta.51

### Patch Changes

- feat: debounce streaming text rendering (300ms) to reduce CPU load
  - @robota-sdk/agent-core@3.0.0-beta.51
  - @robota-sdk/agent-session@3.0.0-beta.51
  - @robota-sdk/agent-framework@3.0.0-beta.51
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.51
  - @robota-sdk/agent-transport-headless@3.0.0-beta.51

## 3.0.0-beta.50

### Patch Changes

- fix: reinsert repository/homepage/bugs in correct field order
- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.50
  - @robota-sdk/agent-transport-headless@3.0.0-beta.50
  - @robota-sdk/agent-core@3.0.0-beta.50
  - @robota-sdk/agent-session@3.0.0-beta.50
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.50

## 3.0.0-beta.49

### Patch Changes

- fix: add repository, homepage, bugs metadata to all publishable packages
- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.49
  - @robota-sdk/agent-transport-headless@3.0.0-beta.49
  - @robota-sdk/agent-core@3.0.0-beta.49
  - @robota-sdk/agent-session@3.0.0-beta.49
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.49

## 3.0.0-beta.48

### Patch Changes

- fix: record individual tool-start/tool-end in history + fix streaming tool display
  - Individual tool-start/tool-end events recorded as IHistoryEntry for persistence
  - TuiStateManager.onToolEnd uses findIndex (first match only, not all with same name)
  - MessageList hides tool-start/tool-end entries (not rendered as System:)

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.48
  - @robota-sdk/agent-transport-headless@3.0.0-beta.48
  - @robota-sdk/agent-core@3.0.0-beta.48
  - @robota-sdk/agent-session@3.0.0-beta.48
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.48

## 3.0.0-beta.47

### Minor Changes

- feat: ITransportAdapter unified interface + headless transport + CLI adapter pattern
  - ITransportAdapter interface in agent-sdk (name, attach, start, stop)
  - InteractiveSession.attachTransport(transport) method
  - createHttpTransport, createWsTransport, createMcpTransport, createHeadlessTransport factories
  - CLI print mode uses adapter pattern: session.attachTransport(transport)
  - agent-transport-headless: text/json/stream-json output, stdin pipe, exit codes
  - --output-format, --system-prompt, --append-system-prompt CLI flags

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.47
  - @robota-sdk/agent-transport-headless@3.0.0-beta.47
  - @robota-sdk/agent-core@3.0.0-beta.47
  - @robota-sdk/agent-session@3.0.0-beta.47
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.47

## 3.0.0-beta.46

### Minor Changes

- feat: session continue/resume — persist, restore, and switch sessions
  - ISessionRecord.history field (required) for UI timeline restoration
  - Session.injectMessage() for AI context restoration on resume
  - InteractiveSession: sessionStore, resumeSessionId, forkSession, getName/setName
  - CLI: --continue, --resume, --fork-session, --name flags
  - TUI: /resume (session picker), /rename (session naming)
  - ListPicker generic component with viewport scrolling
  - Session name display: input border title, terminal title, StatusBar
  - Session picker: cwd filtering, date+time, response preview
  - React key remount for instant session switching

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-session@3.0.0-beta.46
  - @robota-sdk/agent-framework@3.0.0-beta.46
  - @robota-sdk/agent-core@3.0.0-beta.46
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.46

## 3.0.0-beta.45

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.45
  - @robota-sdk/agent-core@3.0.0-beta.45
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.45

## 3.0.0-beta.44

### Patch Changes

- feat: IHistoryEntry universal history architecture + test quality cleanup
  - IHistoryEntry as universal history type across all 4 packages (core → sessions → sdk → cli)
  - Tool summary stored as event entry in history (category: 'event', type: 'tool-summary')
  - TuiStateManager pure TypeScript class for CLI rendering state
  - MessageList renders IHistoryEntry[] with Tool:/System:/You:/Robota: labels
  - Display order fixed: Tool → Robota (both streaming and abort)
  - Remove 25 tautological, duplicate, and hardcoded tests

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.44
  - @robota-sdk/agent-framework@3.0.0-beta.44
  - @robota-sdk/agent-provider-anthropic@3.0.0-beta.44
