# @robota-sdk/agent-interface-session-mobility

## 3.0.0-beta.82

### Minor Changes

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

### Patch Changes

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-core@3.0.0-beta.82
  - @robota-sdk/agent-interface-session@3.0.0-beta.82

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
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
  - @robota-sdk/agent-core@3.0.0-beta.81
  - @robota-sdk/agent-interface-session@3.0.0-beta.81

## 3.0.0-beta.80

### Minor Changes

- 50d2c9f: Handoff offer refusal and inventory classification now live in session mobility. The Node transport
  entry no longer exports `buildHandoffManifest`, `IBuildManifestInput`, `ISourceRuntimeState`, or
  `TManifestResult`. Compose `assessHandoffReadiness` and `prepareHandoffOffer` from
  `@robota-sdk/agent-interface-session-mobility` with `sealHandoffRecord` from
  `@robota-sdk/agent-transport/node`; check readiness before sealing and send the returned serialized
  payload unchanged. The transport README contains the migration example.
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

- 1e40b5b: Move handoff source/destination orchestration and its contract from agent-framework to the session-mobility owner. Import `HandoffSource`, `HandoffDestination`, and their option types from `@robota-sdk/agent-interface-session-mobility`. Mobility now applies offer and authority decisions directly, while the CLI supplies wire effects and the session-record decoder. A successful offer no longer returns a mutable authority transaction.

### Patch Changes

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
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

- Updated dependencies [7b6234c]
- Updated dependencies [37b4bd7]
- Updated dependencies [4eea54b]
- Updated dependencies [1698be4]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [d23c848]
- Updated dependencies [fec722f]
- Updated dependencies [2d3b2c0]
- Updated dependencies [4772067]
- Updated dependencies [9fbab1b]
- Updated dependencies [a009f5b]
- Updated dependencies [4f3c075]
- Updated dependencies [475e085]
- Updated dependencies [e477440]
- Updated dependencies [9dcb5da]
- Updated dependencies [a95ca85]
- Updated dependencies [b6d14ce]
- Updated dependencies [0382a51]
- Updated dependencies [93d061d]
- Updated dependencies [39554a1]
- Updated dependencies [d28430a]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [d6b9404]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/agent-interface-session@3.0.0-beta.80
