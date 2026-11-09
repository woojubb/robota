# @robota-sdk/agent-transport — Package Specification

## Purpose

The pure transport-family substrate. It owns carrier-neutral wire messages, runtime decoders,
session-message dispatch, resumable delivery, peer-message state, handoff payload framing, file transfer, channel
framing, transport admission, and Node-only access-token verification and integrity helpers shared
by transport implementations.

It also holds the carriers, one subpath each: `ws`, `http`, `mcp`, `acp`, `webrtc` and `link`.
Everything that binds a socket, a listener or a protocol SDK lives under a carrier subpath, and the
root, `./client` and `./node` import none of it. The carriers share no code with one another; they
live in one package to save a manifest, a build and a release receipt each, and they stay separate
subpaths so that importing one never loads another.

## Contract

- **Transport admission: none.** This package defines and evaluates admission data but
  binds no listener itself — it is a substrate for admission decisions, not an admission point.
- Runtime message and frame decoders return explicit result unions rather than throwing.
- Admission, access-token and handoff integrity helpers return their declared result contracts.
  The resource-server gate every token-admitted HTTP carrier shares lives here, so the carriers
  cannot drift apart: names are checked against the public URL, refusals carry an empty body and only
  the standard challenge, and only failures count against a peer's address, which is reported only as
  a coarse class. A carrier composes it per request; the gate owns no listener.
  The access-token verifier trusts only keys no older than a bounded age; beyond that an issuer
  outage refuses rather than admits. Outbound delivery isolates carrier failures through a supplied
  error handler, and stops sending to a peer that stops reading, reporting it so the carrier can
  close that connection, instead of making the session wait for it. The session's full history,
  which only grows, crosses in bounded pages read one after another, and a turn's result leaves it
  out, so a peer that keeps reading is never taken for one that stopped. No fallback transport is
  ever selected on behalf of a caller.
- Carriers supply `TOutboundDeliver` and an `IProtocolSession`; no carrier is registered inside the
  substrate: the root, `./client` and `./node` import no carrier subpath. A connection's role is the most its carrier's host granted,
  lowered when the client asks for less and never raised: one shared decision answers that for every
  carrier, and every path that carries the protocol into a session applies the same role, so no
  carrier or bridge admits a message the role forbids. A client can ask which role it has. An
  observing connection reads only its own session's conversation and state, plus the host's list of sessions: it cannot submit, answer,
  control, invoke a tool, switch sessions, or read another session's records, and it never listens for
  prompts, so a session watched only by observers still fails its prompts closed at once. A driving
  connection may invoke one runtime tool for a hosted app view only through the session's permission
  gate and only among the tools that view's own source declared, with any prompt attributed to that
  connection's driver and withdrawn when the connection goes. It reads a view's document on demand:
  a tool event names the view by reference, so the document reaches only the surface that asked, and
  no answer is sent that the carrier's channel cannot carry. A connection that
  answers prompts can ask for the ones already open; they are kept only from what was forwarded to
  such connections, so keeping them never holds a prompt open that nobody can answer.
- A file crosses only after the receiver accepts its offer, and is kept only when the whole content
  matches the offered size and hash; anything else is discarded. The receiver paces the sender, so
  neither side holds more than a bounded window whatever the channel buffers.

## Boundaries

- The root and `./client` export graphs are platform-neutral and depend only on interface packages
  and the neutral `agent-core` entry.
- Node cryptography and network access are reachable only through `./node`, whose package export
  declares `"browser": null` — a structural guarantee that Node-only crypto never leaks into a
  browser bundle via the root or `./client` entries. Token signatures are checked by `jose`, not by
  hand-rolled crypto, and key discovery goes through the shared egress boundary rather than a
  private fetch, so one policy governs every outbound request. Transport admission needs no Node
  cryptography and no network, so it is on the root and a neutral carrier resolves it as a Node one
  does: a credential is minted from web-standard secure randomness, and minting fails rather than
  weakens where that is absent; comparison takes the same time for any two credentials of one
  length, so only the length can leak.
- The root, `./client` and `./node` own no socket, HTTP listener, WebRTC, terminal, framework-host,
  registry, or settings lifecycle; only a carrier subpath binds one. The one process-stream helper the
  substrate does own, the stdio carrier bridge, only attaches and detaches: it
  gives a protocol SDK a bridge to read instead of the process input, so stopping a carrier can never
  destroy the input, and reports either end closing. What a close means stays with each carrier.
- Session mobility owns handoff authority, offer refusal, and inventory classification; this package
  frames, seals, verifies, and assembles the payload that crosses a carrier.
- A carrier subpath imports the substrate and its own library and nothing from another carrier. Every
  carrier library, and the `agent-remote-pairing` and `agent-keyring` packages that `webrtc` and `link`
  build on, is an optional peer dependency, so a consumer installs only what the carriers it imports
  need. Every carrier subpath is Node only and maps `browser: null`.
- Does not forward another workspace package.

## ws

### Purpose

WebSocket carrier for the Robota SDK. The `ws` dependency and carrier lifecycle are isolated in
this subpath; transport-neutral wire messages and session handling belong to
`@robota-sdk/agent-transport` so browser and monitor consumers can depend on those contracts
without pulling in `ws`, React, Ink, or Hono.

### Non-goals / Boundaries

- Does not own the session bridge or the wire protocol (`TClientMessage`/`TServerMessage`) — both
  were extracted to `@robota-sdk/agent-transport` so a non-WS transport can reuse them; this
  package imports rather than redefines them.
- Does not own the channel contracts (`IPayloadChannel`, `IChannelDescriptor`, `IBinaryFrame`) —
  owned by `agent-interface/transport`.
- No other transport package may depend on this one; default transport-registry wiring that
  pre-registers the WS transport belongs to the CLI composition root, not the transport core.
- Consumers import execution-workspace contract types directly from `agent-interface/transport`
  rather than through a pass-through re-export from this subpath.

### Design decision: transport admission default

A prior state had two transports independently answering the same "auto-mint a credential, or stay
open?" question differently. The admission decision now has exactly one owner
(`resolveAdmission` in `agent-transport`), so there is one place to read and one place to change
it, rather than transports drifting apart on a shared question. Opting to stay open additionally
requires a written reason, because "no credential" and "nobody thought about it" must remain
distinguishable outcomes.

### Invariants and guarantees

- **Payload-agnostic carrier.** The transport routes by WebSocket frame opcode: the text-agent
  protocol is one profile riding on the transport, not the transport itself. A binary frame for an
  unregistered channel, an undeclared event name, or a malformed envelope always gets an explicit
  `protocol_error` reply — never a silent drop. An application adds a new event type by declaring a
  channel, never by forking the agent wire protocol.
- **Protocol-scoped session attachment.** Both WebSocket adapters require only the session roles the
  shared protocol bridge uses; a host may attach a full interactive session, but the carrier itself
  does not depend on unrelated runtime capabilities.
- **Authentication ordering is fixed.** Channel sinks attach only after the token check, so an
  unauthenticated socket never receives channel traffic even if a channel was registered before the
  connection existed.
- **Authenticated by default, constant-time comparison, closed before data.** Every connection must
  present the token or is closed before any session data is emitted; comparison is constant-time. A
  host may supply the token; otherwise a random per-launch token is minted and exposed only for delivery
  to the co-located client. Running without auth needs the explicit, discouraged `open` opt-out, and
  combining `open` with a token is rejected as a contradiction.
- **The host grants the role; a connection may only lower it.** A listener's host-set role is the
  most any of its connections may do, `drive` unless the host says otherwise. A connection may ask
  for less in its upgrade request and never for more; a request the shared decision refuses is closed
  before any session data, like a missing token. A host that needs both roles runs one listener per
  role, each with its own admission, so admission stays one credential per listener.
- **Lifecycle rejects out-of-order use.** Starting before attaching, or a repeated active start,
  is rejected rather than silently reinitializing; a repeated stop is safe but clears the session so
  restart requires reattaching.
- **Outbound delivery failures are carrier failures, not session-operation failures**, and this
  applies uniformly to every outbound frame, not only the session-event fan-out. The socket sink is
  private; the only way onto the wire is through one delivery path, so nothing can bypass its
  failure handling. A non-open socket is treated as a failed send, and both synchronous and
  asynchronous send errors route through one idempotent cleanup/close path — latched, so a burst of
  post-close frames triggers that cleanup only once.
- **The host controls capability wiring and surface identity**, not the client: usage-reporting
  capabilities are injected by the host at construction, and the driver identity persisted with a
  session comes from the host's trusted launch path rather than a client-claimed value.

## http

### Purpose

HTTP transport (Hono) for the Robota SDK, split out of the consolidated `agent-transport` package
so the `hono` dependency is an isolated unit.

### Contract

- Depends on `agent-interface/transport` for transport contracts and on `agent-transport` for the
  transport admission seam (`resolveAdmission`, `bearerCredential`, `credentialMatches`) and for the
  wire shape of a prompt answer; neither the admission decision nor what a valid answer is gets
  re-made here.
- Platform-neutral: it reaches no Node built-in or Node global and takes nothing from the host, so
  the routes run unchanged on every runtime Hono does. Whatever serves them, and binds a listener,
  is the host's.
- Contract-pure otherwise: the one side concern of where a stream-failure detail goes is injected via
  `IAgentRoutesOptions.onStreamFailure`, never imported.
- No other transport package may depend on this one.

### Invariants

- `createHttpTransport` is a frozen `service` lifecycle: readiness is construction of the
  Hono app (`getApp()`), not binding a network listener. A repeated active start rejects
  `TransportLifecycleError`; repeated stop is safe and supports a new attach/start generation.
- `/submit` refuses a second concurrent turn on a session, keyed by `getSession().getSessionId()`
  rather than object identity — a factory that returns a fresh wrapper per call (proxy, adapter,
  spread copy) is therefore safe, since only the reported session id determines the claim. Two
  sessions that report the same id are treated as one and will 409 each other; that is a contract
  violation upstream, since `getSessionId()` is supposed to name a session.
- A session that cannot name itself cannot be claimed: `/submit` refuses it (HTTP 500) rather than
  falling back to `isExecuting()`, because that fallback would start a turn this route cannot
  guarantee belongs to the caller. A session that is still starting is not unnameable: `/submit` waits
  on its `whenInitialized()` first, so the first request to a fresh `InteractiveSession` is served.
  `/executing` is the one place an unnameable session still answers, from `isExecuting()` alone —
  reporting what a session is doing is not the same act as admitting a new turn to it.

- Permission and ask prompts reach only a `/submit` stream whose client declared `receivePrompts`. The
  session parks a prompt only while someone listens for it, so a client that cannot answer must not
  listen; otherwise an unattended turn would wait on a prompt nobody settles instead of failing it
  closed. For the same reason the routes never hold prompts with a listener of their own: what
  `GET /prompts` lists is what that stream forwarded and is still open, keyed by session id like the
  turn claim, and it is forgotten when the stream's claim is released.
- `POST /prompts/:id` answers only an id that is open for the request's session, as the host's
  `attribution.driverId`; an unknown id and an already-settled one are the same 404, and `200` means
  the prompt settled — an answer the session did not take is `409`, never reported as accepted.

### Error taxonomy (design intent)

HTTP errors surface as Hono responses; no new error classes are introduced.

- The session's `error` event is relayed verbatim on the SSE `error` channel (its own client-facing
  wording); the WS transport relays it identically.
- An exception escaping the stream callback after headers were sent is not a message composed for the
  client: the client gets a generic line, and the detail goes only to the host's injected
  `onStreamFailure` (absent means the host chose to drop it) — the same withholding the `/submit` 500
  branch practices.
- The callback swallows its own failures rather than passing an `onError` to `streamSSE`, because
  Hono's runner writes an escaped exception's raw message verbatim to the stream on any `onError`,
  which would leak the withheld detail regardless of what the handler intended.

### Non-goals

- Does not bind or manage a network listener.
- Does not re-decide admission; that decision belongs to `agent-transport`.

## mcp

### Purpose

Model Context Protocol (MCP) server transport for the Robota SDK — stdio, authenticated loopback
Streamable HTTP, and OAuth-authorized remote Streamable HTTP, all served from the same exact runtime
session port. Split out of the consolidated `agent-transport` package so MCP SDK dependencies remain
isolated. Every carrier is served from one generation of the official MCP server package, so a
protocol change is carried once.

### Transport Admission

Stdio transport-admission is `none`: a peer that can write to this stdin already runs as the user.
The loopback HTTP carrier is different: it binds only `127.0.0.1`, mints a fresh 256-bit bearer with
the shared `agent-transport` admission primitive, and refuses an invalid Host, Origin, or bearer
before reading a request body. The remote HTTP carrier is an OAuth resource server: it admits only
an access token its injected verifier accepts and never mints or honours the loopback bearer, which
is only as safe as the machine boundary. Its gate is the shared resource-server gate of
`agent-transport/node`, so it answers exactly as every other token-admitted HTTP carrier does. Every name it checks — endpoint path, metadata path, Host,
Origin — comes from the public URL rather than the listener, because the public URL is all a client
ever sees; a proxy in front must forward the path unchanged and preserve Host. It verifies before it
counts and counts only failures, so a valid token is never throttled by failures sharing its address
(a NAT, a proxy), and it believes a forwarded address only from a configured proxy. All carriers
admit only the canonical runtime catalog and use the session permission wrapper; a prompt it raises
reaches the caller only when the operator enabled that (see Canonical catalog and invocation).

### Boundaries

- Owns the MCP server transport adapter, stdio carrier, authenticated loopback and remote HTTP
  carriers, and agent MCP server builders. It does not verify token signatures itself; the verifier
  is injected, so the cryptography stays in `agent-transport/node`.
- Depends on `agent-interface/session` and `agent-interface/transport` contracts, not framework
  internals.
- No other transport package depends on this one.
- MCP consumes only the turn-submission, runtime-tool, session-event, prompt-resolution and
  driver-attribution session roles. The public transport
  implements `ITransportAdapter<IMcpTransportSession>` directly, with no broader inherited signature
  or overload — a full session remains assignable structurally because it implements those roles.

### Lifecycle guarantees

- `createMcpTransport` is a frozen `service` lifecycle: `start()` validates the canonical catalog,
  connects the carrier, and resolves only when it can serve requests; a pending start is cancellable
  and bounded to 15 seconds. Start-before-attach and a repeated active start reject; repeated stop is
  safe; restart requires a new attach. The stdio carrier bounds one frame: a frame above the bound
  is a carrier failure, not a served request.
- Both HTTP hosts validate the canonical catalog and their bind before listening. They follow the
  SDK's stateless request/response model — no `Mcp-Session-Id` table, GET stream, expiry sweep, or
  resumption process — so a remote peer has no session identifier to guess or enumerate. One
  listener maps every admitted request onto the single attached `IMcpTransportSession`.
- On the loopback host, `Host` must match the listener's own loopback address and port; a present
  `Origin` must match that exact origin (absent is permitted for local non-browser clients). Invalid
  Host/Origin returns 403 and an invalid bearer returns 401, both before the request body is read.
  The bearer is minted when the host is created (`createMcpHttpHost`) and returned only to the trusted process owner, which must keep
  it out of argv, logs, URLs, and world-readable files. The loopback host refuses a non-loopback bind; only the remote
  host, which cannot be built without a verifier and an `https` public URL, binds elsewhere.
- The external wire schema and protocol errors are MCP-SDK owned, not an agent runtime REST envelope.

### Canonical catalog and invocation

`createAgentMcpServer` checks the canonical catalog before accepting calls; tools use their canonical
runtime names, descriptions, and input schemas — `exposeCommands` and `command_*`/`executeCommand`
have no compatibility route. The submission extension uses a host-selected identity or a neutral
default; a runtime-tool name collision with that identity fails startup, and a later catalog
collision fails listing/calling visibly.
Resources and prompts are not advertised. MCP tool calls delegate to `invokeRuntimeTool`; unknown
names, permission denial, busy state, and cancellation are visible tool errors, and submission
cancellation never aborts another caller's active turn. A permission or ask prompt is a tool error
too, unless the operator enabled caller elicitation and the caller declared form-mode elicitation,
because letting a remote caller answer the permission gate is a trust decision only the operator
can make. Then a prompt raised while that caller's own call drives the session (including a
background agent's request forwarded then, which names the agent), and never one raised during
another caller's call, is put to it as an MCP elicitation. A permission offers allow once or deny
only, so a caller can never add a standing permission rule; in auto mode an approval resumes a
paused classifier, as any approval does. A masked ask is never sent, since form elicitation may not
carry a secret, and an answer that names nothing offered settles the prompt closed. A call listens
for prompts only while its own work drives the session, because the session fails a prompt closed
only when nobody listens: a submission waiting in the queue must not hold another caller's prompt
it cannot answer. A call that is abandoned settles its own open prompts closed, because a question
asked without a signal would otherwise outlive it.

The HTTP hosts keep no session state, so they can ask only a 2026-07-28-era caller, through
input-required rounds: the asking call waits behind a single-use random request state that names
that call and nothing else and never becomes a session. A caller that does not return within the
time a person is given to answer one prompt, or a host that stops, abandons the call, so an absent
caller holds the session for one bounded wait rather than one per prompt; a call that ends while it
waits keeps its result for the retry. A 2025-era HTTP caller cannot be asked and keeps the tool
error.

### Error Taxonomy

MCP protocol errors surface through the MCP SDK. HTTP admission responses have empty bodies and carry
no credential, tool result, or internal runtime detail; a remote token refusal adds only the standard
Bearer challenge — an RFC 6750 error code, the required scope and the metadata location, never a
description — so a refusal tells a client how to recover and nothing more. A
refusal's audit record is likewise a closed-set reason and an address class, never token text or the
address itself. Listener/start/close failures reject visibly.

## acp

### Purpose

Agent Client Protocol (ACP) v1 agent transport for the Robota SDK. An editor that launches the
process drives one session over newline-delimited JSON-RPC: it prompts, watches streamed output and
tool calls, answers permission requests and cancels turns. The ACP SDK dependency and all
ACP-specific vocabulary stay in this subpath, so a protocol revision touches one place.

### Boundaries / Non-goals

- Does not build sessions, decide workspace trust, or run slash commands. The host attaches the
  session and injects the trust check and the command port; command execution belongs to the
  framework layer this subpath may not import.
- Depends on `agent-transport` (shared stdio carrier helper), the `agent-interface` contracts,
  `agent-core` types and the ACP SDK. It imports no sibling transport, no `agent-framework` and no
  CLI. Carrier mechanics shared with MCP live in `agent-transport/node`, not here and not copied.
- Does not delegate terminals or searches to the editor, decide which tools use its file system,
  build or find stored sessions (loading one is the host's port), or advertise MCP capability, and
  speaks no ACP version other than 1.
- Is not Robota's own surface protocol. The WebSocket wire protocol serves session listing and
  switching, history paging, background work, status frames and pairing that ACP v1 has no
  counterpart for; this adapter sits beside it over the same session.

### Contract

- **Lifecycle.** A frozen `service`. Start before attach and a repeated active start reject; stop
  is idempotent and clears the session, so restart needs a new attach. `waitForClose()` settles when
  the editor's input ends, the output closes or the transport stops, and rejects if the output fails.
- **Only protocol on the wire.** The carrier writes JSON-RPC frames and nothing else; the host
  reserves the output so no other writer can reach it.
- **Updates precede the reply.** A prompt answers only after every update for it has been written.
- **One answer per prompt.** `end_turn` when the turn completes, `cancelled` after `session/cancel`
  or when the editor goes away, otherwise a fixed error that withholds provider text.

### Invariants

- **The editor widens nothing.** `session/new` and `session/load` must name the served directory and
  carry no MCP servers or extra roots, and the host's trust check runs before either answers; a load
  reaches only a session the host's port admits, which must be rooted in the served directory. A
  permission answer grants only an option that request listed, and anything cancelled, failed or
  unrecognised denies. ACP v1's pathname-only file system cannot preserve a checked file identity
  across a rename, so contained host file tools never delegate `Read`, `Write` or `Edit` to it.
- **Questions fail closed.** ACP v1 has no free-form question, so the transport never listens for
  one and the session answers it as cancelled.
- **Every session event has a decision.** The event policy is exhaustive over the shared vocabulary
  and the subscription is derived from it, so a new event fails compilation until it is decided.
- **The process input outlives the transport.** The SDK reads a bridge, and stopping releases the
  bridge and its listeners but never destroys the real input or output.
- **A turn's outcome comes from its own handle.** Streaming uses session events; the stop reason
  uses the submission's turn handle.

### Design decisions

- **One session per connection.** The host builds one session, with its trust, working directory
  and permissions. Serving a second `session/new` would alias that session under another id or need
  a session factory whose per-session working directory is not established, so it is refused. A
  `session/load` replaces the connection's session instead of adding one: the host's port makes the
  stored session current in what the transport was attached to, and the transport keeps serving
  that object. Loading requires both the host port and the attached session's history read, since a
  host must not replace a conversation that the editor cannot replay. A load is checked exactly like
  `session/new` and refused while a prompt runs, since it
  would take the session from under that turn; the host may refuse more (work still in progress, a
  session that would run on its own). It is offered only when the host can load, and the editor sees
  the conversation it reopened before the load answers.
- **The command list follows the session.** When the session provides a catalog, the editor learns
  the commands it may offer once it holds the session id, so the list goes out after the reply that gives it. Any prompt, a command or
  a model turn, can change the catalog (a plugin reload, a preset, a skill that installs another), so
  the list is re-checked after every prompt and sent again only when it changed.
  Commands a client runs itself are not offered, because an editor cannot run them.
- **`session/new` waits for the session to start.** The host builds the session in the background
  and it cannot name itself until it is ready, while an editor sends `session/new` straight after
  `initialize`; answering early would fail the first launch at random. A session that failed to
  start is answered with a fixed message and the cause stays local.
- **`cwd` must equal the served directory.** The session is rooted when it is built; accepting
  another directory would claim a root the tools do not have. Symlinked spellings of the same
  directory are accepted.
- **Editor-supplied `mcpServers` and extra roots are refused.** They would add servers to launch or
  files to reach that the user did not configure for this agent. MCP servers are configured in the
  agent's own settings.
- **Trust is answered inside `session/new`.** The headless trust gate exits before any protocol
  traffic, which an editor shows as a crash with no explanation; answering with an error that names
  the command to run tells the user what to do. The error's code is server-defined, never ACP's
  authentication-required one, which an editor turns into a sign-in state this agent does not have.
- **Initialize always answers version 1.** The protocol has the agent answer with the version it
  supports and the client disconnect if it cannot use it, so an unknown requested version is not an
  error here.
- **Stop reason comes from the turn handle.** A session-wide `complete` or `interrupted` says that a
  turn ended, never which one; the handle names its own turn. A reply that was not streamed (a
  provider without deltas) is sent once from the result.
- **Tool-call rows are unique for the connection's lifetime.** Replayed and live calls share one
  allocator; a session execution id is preferred only when no earlier row used it, because the
  editor merges rows with the same id. A permission request and its call's start, end or refusal
  keep the allocated row for that execution, including when a repeated request reaches an already
  running call. A request that names no call gets a row of its own, since nothing could match it
  without guessing. A row whose call never came by the end of the turn is closed rather than left
  pending: as failed for this session's own call, which the ended turn will not run, and with the
  answer for a background agent's, which may still run after the prompt the editor is watching.
- **A permission request shows what the terminal shows.** The person answers in the editor's dialog
  alone, so the request carries the arguments whole, an edit's diff and the file it touches, and a
  title that is never shortened; approving a summary would approve what was not seen.
- **The editor's file system goes to the host, not to the session.** An editor that offers `fs`
  gives the host pathname access bound to the served session. Because ACP v1 cannot bind that path
  to stable rooted authority, contained file tools keep their disk capability instead of delegating
  reads or writes. It is handed over after `session/new` or `session/load` binds
  the session, because every `fs` request names the session, and withdrawn when the transport stops so the tools
  return to the disk. Terminals are not delegated: an editor terminal runs outside the agent's
  command sandbox.
- **Slash commands arrive as prompt text.** A prompt whose text starts with `/` goes to the host's
  command port. The commands an editor may offer are advertised so it can list them, but the prompt
  text stays the way a command arrives, as ACP sends a chosen command. A command that runs a model turn
  (a skill) streams, asks about permissions and is cancelled exactly like a typed message, because
  the person must be able to answer what it asks and stop what it does; the prompt's signal goes
  with the command, so a cancel that lands while the skill is still being prepared stops its turn
  from starting. Its output is shown as one message only when nothing streamed, since otherwise it
  repeats the reply.
- **Reasoning streams as thoughts, apart from the reply.** A provider's reasoning text goes to the
  editor as thought chunks while the turn runs. It never counts as the reply, so a turn that showed
  only thoughts still sends its result once; where the provider sends no reasoning text, nothing is
  sent and nothing is switched on to produce it.
- **Turn failures reply with a fixed message.** Provider errors can contain request details; the
  cause goes to the host callback instead.
- **The output is a plain sink, not a stream adapter.** Node's stream-to-Web adapter keeps
  listeners on the process output and can destroy it; the transport adds neither.
- **Usage surface is `unknown`.** The shared surface vocabulary has no editor value.

## webrtc

### Scope

WebRTC P2P transport. Carries the protocol-owned `IProtocolSession` capability over an `RTCDataChannel` so an
external remote client can co-drive a live `agent-cli` session directly, peer-to-peer, without routing session
content through any server; and connects two of one user's devices to each other (the device mesh), admitted by
the device handshake, or a new device to one of them to enrol it. Reuses the transport-neutral session bridge + wire protocol from
`@robota-sdk/agent-transport` (the same handler the WebSocket transport uses) so the protocol is shared, not
duplicated. The public attach contract accepts that protocol role set directly: a full interactive
session is a valid host input, but unrelated session capabilities are outside the carrier's
dependency.

### Boundaries

- Does NOT own the session bridge or wire protocol — that is `@robota-sdk/agent-transport`. This subpath only
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
  command to turn it on; wiring an enable path is out of scope for this subpath.
- **Admission is decided at construction, and there is no unstated default.** With a pairing secret, the data
  channel is phase-separated: pre-accept it carries only pairing frames (anything else is held, bounded, until
  this side's verdict and discarded if pairing fails, since the peer may finish first and speak at once), and only
  after the handshake accepts (channel-bound to the DTLS fingerprints) is the session bridge built — fail closed on
  mismatch/timeout (channel closed, session never exposed).

  Without a secret the constructor throws unless the caller explicitly opts in with a written reason. Running
  ungated is a decision someone has to make and write down; it used to be what happened when nobody said anything,
  which this construction-time check removes. A secret together with the ungated opt-in is contradictory and also
  throws. The written-reason requirement is centralized in `@robota-sdk/agent-transport` so sibling transports
  cannot drift apart on what counts as an answer.

- **Owns the local-peer channel GATE, not the local-peer policy.** When local-peer admission is configured, an
  accepted handshake is not enough: the peer must also present the nonce it was issued at the guarded rendezvous,
  and only then is the session exposed. This subpath holds the state machine and the frame; single-use, expiry and
  revocation belong to the grant ledger in `@robota-sdk/agent-remote-pairing/local`, which is injected as a port.
  That keeps the cryptographic/OS policy out of the transport and keeps `node:fs` out of this subpath.

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

### Design decisions

- **The session host is the offerer; in the device mesh the pair decides.** Inbound description/ICE signals are
  applied in arrival order, and a candidate that arrives before the remote description waits for it, so trickled
  candidates are never lost to ordering. A peer's own candidates go out only once it holds the remote
  description: the binding hands the remote description to ICE before the DTLS layer can check a certificate
  against it, so an answerer that could reach the offerer earlier would be refused. Between two devices the one with
  the lower device id offers and the other only answers, so two devices reaching for each other at once make one
  connection by rule rather than by whichever message arrives first; a repeated announcement from the peer run
  already being served is ignored, and a new run of the peer replaces the connection.
- **Device mesh admission.** A mesh connection binds the device handshake the way the session gate binds pairing,
  and an enrollment connection binds the enrollment proof the same way, in both roles: the remote fingerprint
  comes from the certificate the DTLS layer verified, the remote description must advertise exactly one
  fingerprint, and one is taken per connection. An enrollment listener serves one attempt at a time, and the
  proof, not this subpath, decides whether the peer is believed. Until admission only handshake frames
  cross; anything else ends the connection. A side counts the connection admitted only after the peer says it
  admitted it too, so a refused peer never believes it is connected. Each connection has a DTLS certificate of its
  own: a per-process certificate would be a stable identifier the relay could link across connections, and one two
  endpoints in a process would share. No ICE server is contacted unless one is configured or a paired device
  advertises its relay. Every way signals travel — the relay, or a peer's
  direct endpoint on the local network — is reached only through opaque, pairwise topics and is never trusted for
  anything but delivery: nothing it says is authenticated, so a new attempt runs beside the admitted connection
  and replaces it only once admitted itself, and attempts per pair are paced — forged announcements can neither
  cut a working connection nor open connections without bound.
  Lists adopted in a handshake or handed over later apply from the next handshake and are pushed over every admitted
  connection, since a revocation that waited for the next handshake would leave a revoked device linked elsewhere; a
  pushed list is taken on the handshake's terms — newer, from this user's signing key, verifying — and travels
  whatever the peer may ask, because lists are identity, not a capability. A device they revoke loses its
  connection at once. Admission says who the peer is; what it may do on the connection is its connection
  authority's answer, so even a message is delivered only when that authority allows it. A file travels on a
  channel of its own, opened only on an admitted connection, so a transfer never shares the message channel.
- **Discovery yields candidates, never trust.** Whatever a discovery path answers only carries signals, so a stale
  or planted address can delay a connection but not admit one; a device list found on the way is only a candidate
  too, verified by the handshake before it counts. A pair tries what reveals least first: an address that already
  carried an admitted connection needs no broadcast, the local network needs no third party, public records and
  public signaling relays involve strangers, and the user's own relay is the last resort. A signaling carrier that
  carries no admission in time is set aside for the next one, as a direct endpoint is, since a public relay may
  drop what it cannot read. An endpoint carries a pair's signals only once it proves it holds the pair's topic,
  and is set aside when an attempt over it is not admitted in time, and for longer each time it fails again, so no
  endpoint can hold a pair off the relay or keep drawing it back; only signals that precede an admission start that
  time, so what trails one cannot set a working endpoint aside. An address is remembered only after an admission
  it carried. The mDNS announcement is built record by record rather than by a service-publishing library,
  because those publish the machine's host name: the service type names no product, every instance name is a
  pairwise tag that rotates by epoch, the host name is random, and the instance count is padded with names that
  hold for the epoch, so it does not tell how many devices there are.
  On the local network, topics travel only as hashes and rotate by epoch, so what an observer there sees does
  not carry the stable relay inbox topics.
- **Public infrastructure sees only signed ciphertext, and nothing that names a device, a user or the product.**
  Records on the Mainline DHT (or pkarr relays in front of it) and events on Nostr relays are signed by one-time
  keys of a pair, a direction, an epoch and a purpose; salts and Nostr kinds rotate the same way, values are the
  pair's own AEAD ciphertext padded to a fixed size, and a device's records are published at jittered times so they
  do not appear together. What stays visible is what the network already shows: a relay or DHT node sees the
  publisher's address and timing, and a relay can group one device's traffic by its connection. The relays span
  several operators and are replaceable in settings; none is trusted with anything but delivery, and every record
  or event is checked against the key it must carry before it is opened. Device lists found there are returned as
  candidates, each paired device's newest before any device's next, because any paired device can publish one: the
  handshake keeps the newest that verifies, so neither a forged "newer" list nor one device's many can hide a real
  revocation. A list that spans several records is taken only when every record is of the same version. The draft
  WebRTC-signaling NIP is not used because its events would name the connection's parties; the event format is
  ours. pkarr relays carry no salt and only DNS
  packets, so a record's pkarr form is the salt-less item under the same one-time key, its value wrapped in one TXT
  record. The DHT and Nostr clients are maintained, pure JavaScript and permissively licensed, so they are ordinary
  dependencies; the DHT client is loaded only when a device turns the DHT on, so importing this subpath opens no
  socket.
- **Where no direct path works, a relay moves datagrams and nothing more.** The relay is TURN on one of the user's
  own always-on devices, then a TURN server the user configured; with neither, a connection that needs one is
  refused with an error saying a relay device is needed, never left to fail silently and never carried some other
  way. That conclusion is drawn only when a relay was in fact required — relayed connections alone are allowed, or
  a direct attempt took the peer's description and no path it tried connected — and the error carries what the
  attempt went through, so it never hides a different failure. A relay only forwards the two ends' DTLS, so it
  holds no key of the channel and a relayed connection is admitted by the same handshake on the same verified
  certificate as a direct one. Only devices the lists in force name, unrevoked, may use a device's relay: each pair
  derives its own short-lived credential in the TURN REST style, its username a rotating pairwise tag that names no
  device, so a device the lists drop can neither derive one nor keep an allocation. Where the relay listens travels
  only in the pair's sealed hints records, so it reaches paired devices and no one else. The TURN server is a small
  in-repo implementation of the part of RFC 8656 a WebRTC client uses, over UDP and in pure JavaScript: no
  maintained JavaScript TURN server offered a per-allocation authorization hook and quotas without a wide surface
  of its own, and a native server would make the relay depend on a binary per platform. A request nobody has
  authenticated may carry a forged source address, so the relay answers such requests at a limited rate, per source
  and in all, and never with more bytes than the request carried: it cannot be used to amplify traffic toward
  someone else. The limit in all is only a backstop and sits well above the per-source one, since a low one would
  let a flood from forged sources crowd out genuine clients' challenges. A client whose first request is smaller
  than the challenge it would get goes unanswered; the first requests of the mesh's WebRTC stack are large enough.
  Whether the relay forwards into private and link-local ranges is the user's choice. It does by default, because a
  relayed connection to a device on the relay host's own network needs it; turning it off keeps a paired device
  from reaching other hosts on that network through the relay, at the cost of those connections.
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
  but not admitted-owner query authority. The host grants the role of a session surface this transport
  builds; an injected resume bridge carries the role its host gave it, so passing both is refused as a
  contradiction.
- **The WebRTC implementation is `node-datachannel`, chosen, not fallen back to.** Channel binding means something
  only if the DTLS layer proves the peer holds the key of the certificate it presents, i.e. verifies the handshake
  signatures, which OpenSSL's DTLS does. It also connects quickly, notices a dead peer, and contacts no ICE server
  it was not given. The cost is a native binary per platform, which is why it is optional and why a platform
  without one has no WebRTC transport at all. The implementation sits behind one lazy loader and one peer
  wrapper, so a later change is again a recorded choice.

### Error Taxonomy

- The optional WebRTC dependency absent, or without a binary for this platform → the lazy loader throws an
  explicit "WebRTC transport unavailable" error at point-of-use (never a silent degrade).
- Starting before attaching → throws a lifecycle error naming the required order.
- An outbound send failure on a closing/closed channel — whether a session event or a reply that resolved after
  the drop — closes and detaches that carrier, reports the delivery-error observer exactly once, and leaves the
  committed session operation successful. It is never silently dropped or partially retried, and it never surfaces
  as an unhandled rejection.

## link

### Purpose

The owner link carrier: how a client reaches a served runtime on its own machine when nothing but
cryptography tells who is at either end. Programs running as the same operating-system user can
connect to a runtime's control socket, take it over, replay what they saw and start runtimes of
their own, so this subpath carries `@robota-sdk/agent-keyring`'s owner link over a local byte stream
(a supervised runtime's control socket or pipe) and owns the owner vocabulary spoken inside it. It
is a Node host package and runs unchanged on Node.js and Bun.

What each standing may do, when a runtime locks, where the read keys go and how the control
endpoint reads the request line stay with the runtime that serves the link.

### Contract

- One request line in the control endpoint's request shape opens a link, so the endpoint routes it
  like any other command. The line names no runtime and no start: the binding is proven inside the
  handshake, never taken from the request.
- A runtime admits a spawner only with the proof established over their inherited channel and an owner
  only with the attach-key proof; it closes the channel before a child can inherit it. The stream closes
  on proof failure without saying why, and the client discloses no proof before verifying the runtime.
- An admitted link reports its standing, and the runtime's desk decides what that standing may do;
  the carrier never grants a request by itself.
- Every frame is bounded by what may come next before any of it is read, and every owner message
  decodes strictly on both ends. Anything else ends the link before a port sees it; a client also
  ends its link when its outgoing stream cannot accept another frame within bounded memory.
- Wire shapes stop in this subpath: runtimes and clients deal only in domain values (trust roots,
  read keys, custody states, session questions, control commands).
- A read grant reaches the runtime only as read keys handed to its desk, and the keys of a grant the
  desk refuses are locked.
- A refusal the runtime decided reaches the client with its fixed code and text; any other failure
  reaches it as `failed`, never with its own text.

### Invariants

- The session protocol crosses unchanged: a session frame carries one serialized `agent-transport`
  message, and the client decodes it with that package's decoders.
- When a link ends, its queued answers may finish within a bounded grace while further traffic is
  refused; its frame keys are wiped and unanswered requests are rejected. This lets certification
  be acknowledged without retaining the spawner's authority.

### Non-goals

- Listeners of any kind: the carrier runs over a stream that is already connected.
- Browser use.
- Admission policy, custody and the accept decision itself; this subpath carries them.

### Design Decisions

- **Admission is a proof, never a token.** Anything bearer-shaped that a runtime accepts can be read
  or replayed by the programs this link exists to refuse; a proof tied to the passphrase, or to the
  exchange only the spawner took part in, cannot.
- **The custody notice opens the link.** The runtime sends it only after admitting the proof, so a
  client never mistakes a runtime that refused it for an open link.
- **Owner requests are their own frame kind.** Only a link endpoint's own code sends them; a renderer
  or an attached terminal speaks session frames, so no session message can be read as an owner
  decision.
- **A refused request leaves the link open; a malformed one closes it.** A refusal is the runtime's
  decision about a well-formed request. A frame that does not decode on an authenticated link means
  the peer is broken or not what it claims, and nothing it sends next can be trusted.
- **Encoders check their own output.** An end never sends what the other must refuse, so a value
  outside the vocabulary is its caller's error and not a closed link.
