# @robota-sdk/agent-transport-mcp

## 3.0.0-beta.98
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.98
  - @robota-sdk/agent-interface-transport@3.0.0-beta.98
  - @robota-sdk/agent-transport@3.0.0-beta.98

## 3.0.0-beta.97
### Patch Changes

- Updated dependencies [c207a31]
- Updated dependencies [7911a7d]
  - @robota-sdk/agent-transport@3.0.0-beta.97
  - @robota-sdk/agent-interface-session@3.0.0-beta.97
  - @robota-sdk/agent-interface-transport@3.0.0-beta.97

## 3.0.0-beta.96
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.96
  - @robota-sdk/agent-interface-transport@3.0.0-beta.96
  - @robota-sdk/agent-transport@3.0.0-beta.96

## 3.0.0-beta.95
### Minor Changes

- 60f3965: **`robota mcp serve --ask-client` puts a caller's permission and ask prompts to the calling MCP client through elicitation instead of failing them.**

  `@robota-sdk/agent-transport-mcp`: `createMcpTransport`, `createMcpHttpHost`,
  `createMcpRemoteHttpHost` and `createAgentMcpServer` take `askClient`. Off by default, every prompt
  is a tool error as before. On, and when the client declared form-mode elicitation, a permission or
  ask prompt raised by that client's own call is put to it: a permission offers allow once or deny
  only, never a remembered grant; an ask becomes a form (choice, multiple choice, free text); a masked
  ask is never sent; deny, decline, cancel, a client error or an answer naming nothing offered keeps
  today's outcome. stdio asks during the call. The HTTP hosts keep no session state, so they ask only
  a client on the 2026-07-28 revision, through input-required rounds whose `requestState` is a
  single-use random token naming one parked call; a 2025-era HTTP client keeps the tool error.
  A call listens for prompts only while its own work drives the session, so a submission waiting
  in the queue never holds another caller's prompt that it cannot answer.
  Breaking for hand-written sessions: `IMcpTransportSession` now also requires `ISessionEvents`
  (`on`/`off`), `ISessionPromptResolution` (`resolvePermission`/`resolveAsk`) and
  `ISessionDriverAttribution` (`getActiveDriverId`), which `InteractiveSession` and the published
  test double already implement.

  `@robota-sdk/agent-interface-session` / `@robota-sdk/agent-session` / `@robota-sdk/agent-framework`:
  `ISessionRuntimeTools.invokeRuntimeTool` (and `Session.invokeRuntimeTool`) accept
  `options.permissionInteraction` and `options.driverId`. A direct call still denies a decision that
  would need a person, and finds no one to ask a question, unless its caller passes
  `permissionInteraction: 'interactive'`; then it asks the session's permission handler and its
  tools get the session's ask port. `InteractiveSession` makes `driverId` the active driver while
  the direct call runs, so a prompt the call raises carries it as `requesterDriverId`. With
  `askClient` on, an MCP call runs under its own `mcp:<n>` driver id; a submission made that way is
  attributed to it rather than to the owner.

  `@robota-sdk/agent-transport`: exports `permissionSummaryArgument`, the argument a person recognises
  a tool call by (`filePath` for the built-in file tools), for every transport that puts a permission
  request to a person in its own wire form.

  `@robota-sdk/agent-cli`: `mcp serve --ask-client` turns this on for whichever carrier the run serves.
- b4c2572: **`@robota-sdk/agent-transport-mcp` serves stdio from `@modelcontextprotocol/server` 2.x, and the 1.x `@modelcontextprotocol/sdk` leaves the repository's runtime dependencies.**

  The stdio server (`createAgentMcpServer`, `createMcpTransport`) now builds on the same v2 server
  package the HTTP hosts already use, through its `/stdio` carrier; the catalog is validated with the
  SDK's own `Tool` validator, so the HTTP hosts no longer re-serialize it at the SDK boundary. Client-
  visible behavior is unchanged: the same tools, submission extension, admission, turn correlation and
  error results, negotiated through the legacy `initialize` handshake as before. `createAgentMcpServer`
  returns the v2 `Server` type; a consumer wiring its own carrier imports `StdioServerTransport` from
  `@modelcontextprotocol/server/stdio`. The stdio connection is stateful, so the server can send
  server-to-client requests such as `elicitInput` to a client that declares the capability (tested).
  Two carrier details follow the v2 stdio transport: a single frame over 10 MiB now fails the stdio
  carrier instead of being buffered without bound (the HTTP carriers already cap a body at 1 MiB), and
  a line that is not JSON is skipped instead of failing the carrier. A malformed `tools/call` request
  or result is answered with the SDK's invalid-params error, and an invalid catalog entry is reported
  as `Invalid MCP tool: <path>: <reason>` instead of the 1.x validator's own text.

  `@robota-sdk/agent-cli` drops `@modelcontextprotocol/sdk` from its external `dependencies`; nothing
  in its bundle imports it any more. The 1.x SDK remains only as a test dependency of
  `@robota-sdk/agent-mcp`, for its legacy-era fixture host.

### Patch Changes

- c967c57: `robota acp` runs the agent as an Agent Client Protocol (v1) agent over stdio, so an editor that launches it (Zed, JetBrains and other ACP clients) can create a session, send prompts, see streamed replies and tool calls, approve or reject permission requests, and cancel a turn. Workspace trust, permission rules and the sandbox behave as in the terminal: the editor answers prompts and widens nothing. A folder that is not trusted yet is refused at `session/new` with the `trust` command to run, a working directory other than the one the agent was started in and any editor-supplied MCP servers or extra roots are refused, and a prompt that starts with `/` runs that command.

  New package `@robota-sdk/agent-transport-acp` provides `createAcpTransport`, the ACP `ITransportAdapter` the command uses.

  `@robota-sdk/agent-transport/node` gains `attachStdioCarrier`, the process-input bridge and close observation a stdio protocol carrier shares. `agent-transport-mcp` now uses it for its stdio carrier; its behavior is unchanged.
- Updated dependencies [c967c57]
- Updated dependencies [60f3965]
- Updated dependencies [115e104]
- Updated dependencies [04719a9]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
  - @robota-sdk/agent-transport@3.0.0-beta.95
  - @robota-sdk/agent-interface-session@3.0.0-beta.95
  - @robota-sdk/agent-interface-transport@3.0.0-beta.95

## 3.0.0-beta.94
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.94
  - @robota-sdk/agent-transport@3.0.0-beta.94
  - @robota-sdk/agent-interface-transport@3.0.0-beta.94

## 3.0.0-beta.93
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.93
  - @robota-sdk/agent-interface-transport@3.0.0-beta.93
  - @robota-sdk/agent-transport@3.0.0-beta.93

## 3.0.0-beta.92
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.92
  - @robota-sdk/agent-interface-transport@3.0.0-beta.92
  - @robota-sdk/agent-transport@3.0.0-beta.92

## 3.0.0-beta.91
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.91
  - @robota-sdk/agent-interface-transport@3.0.0-beta.91
  - @robota-sdk/agent-transport@3.0.0-beta.91

## 3.0.0-beta.90
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.90
  - @robota-sdk/agent-interface-transport@3.0.0-beta.90
  - @robota-sdk/agent-transport@3.0.0-beta.90

## 3.0.0-beta.89
### Patch Changes

- 3427887: `--serve --http-port` can serve the agent HTTP API as an OAuth resource server: with `--http-public-url`, `--oauth-issuer`, `--oauth-scopes` and `--oauth-allowed-subjects` (plus optional `--http-host` and `--trusted-proxy`) it may bind a non-loopback address and admits access tokens through the same shared resource-server gate as `mcp serve`. Without them it stays loopback with the `PRODUCT_HTTP_TOKEN` bearer.
  
  The refusal answer shared by both resource-server carriers (503 for unavailable issuer keys, uncounted; counted challenge otherwise) is now `refuseAccessToken` in `@robota-sdk/agent-transport/node`.
- Updated dependencies [3427887]
  - @robota-sdk/agent-transport@3.0.0-beta.89
  - @robota-sdk/agent-interface-session@3.0.0-beta.89
  - @robota-sdk/agent-interface-transport@3.0.0-beta.89

## 3.0.0-beta.88

### Patch Changes

- @robota-sdk/agent-interface-session@3.0.0-beta.88
- @robota-sdk/agent-interface-transport@3.0.0-beta.88
- @robota-sdk/agent-transport@3.0.0-beta.88

## 3.0.0-beta.87

### Patch Changes

- Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- Updated dependencies
- Updated dependencies [7d9cc66]
  - @robota-sdk/agent-interface-session@3.0.0-beta.87
  - @robota-sdk/agent-interface-transport@3.0.0-beta.87
  - @robota-sdk/agent-transport@3.0.0-beta.87

## 3.0.0-beta.86

### Patch Changes

- @robota-sdk/agent-interface-session@3.0.0-beta.86
- @robota-sdk/agent-interface-transport@3.0.0-beta.86
- @robota-sdk/agent-transport@3.0.0-beta.86

## 3.0.0-beta.85

### Patch Changes

- Updated dependencies [9a01e78]
  - @robota-sdk/agent-transport@3.0.0-beta.85
  - @robota-sdk/agent-interface-session@3.0.0-beta.85
  - @robota-sdk/agent-interface-transport@3.0.0-beta.85

## 3.0.0-beta.84

### Patch Changes

- Updated dependencies [e8d70ac]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-interface-session@3.0.0-beta.84
  - @robota-sdk/agent-transport@3.0.0-beta.84
  - @robota-sdk/agent-interface-transport@3.0.0-beta.84

## 3.0.0-beta.83

### Minor Changes

- d877de2: External events arrive over HTTP: `POST <public-url>/events/<grant-id>`, on a loopback port behind the owner's own
  HTTPS proxy or tunnel.

  - `agent-transport` — `./node` exports the resource-server gate every token-admitted HTTP carrier shares:
    `createBearerResourceServer` (Host and Origin checked against the public URL, trusted-proxy `X-Forwarded-For`,
    a failure-only throttle per address, coarse address classes), `describeProtectedResource` (RFC 9728 metadata
    path and body, RFC 6750 challenges), `serveProtectedResourceMetadata`, `refuseBearerToken` and
    `parsePublicHttpsUrl`.
  - `agent-transport-mcp` — the remote MCP gate is composed from that shared gate; its answers are unchanged.
  - `agent-cli` — each grant is its own endpoint and audience (its resource is `<public-url>/events/<grant-id>`).
    An admitted event answers `202 {"turnId"}`; refusals have an empty body: 401 with the `invalid_token` or
    missing-token challenge, 403 `insufficient_scope` or a revoked grant, 400 a malformed event, 404 an unknown
    grant, 413 a body over 16 KiB, 429 over the grant's rate or the address's failure budget, 503 when the issuer
    or the session cannot take it. `--external-event-port <port>` (required with grants) and
    `--external-event-trusted-proxy <ip>` work on the TUI and on `__PRODUCT_CLI_NAME__ session start --background`. A background
    session writes an owner-only, bounded JSONL trail of refusals and settlements under its supervised directory;
    the TUI reports them on one line each.

### Patch Changes

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
- Updated dependencies [7b72344]
- Updated dependencies [6ae3f28]
- Updated dependencies [57f57f5]
- Updated dependencies [ba822c1]
- Updated dependencies [6e6b06b]
- Updated dependencies [57280bf]
- Updated dependencies [18c0d5c]
  - @robota-sdk/agent-interface-transport@3.0.0-beta.83
  - @robota-sdk/agent-transport@3.0.0-beta.83
  - @robota-sdk/agent-interface-session@3.0.0-beta.83

## 3.0.0-beta.82

### Patch Changes

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-transport@3.0.0-beta.82
  - @robota-sdk/agent-interface-session@3.0.0-beta.82
  - @robota-sdk/agent-interface-transport@3.0.0-beta.82

## 3.0.0-beta.81

### Patch Changes

- Updated dependencies [3038eb7]
  - @robota-sdk/agent-interface-session@3.0.0-beta.81
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

- e13c30c: MCP servers now publish a neutral submission tool by default. Hosts that need the previous
  `PRODUCT_submit` tool must pass `submitTool: { name: 'PRODUCT_submit', description: '...' }` to
  `createAgentMcpServer`, `createMcpTransport`, or `createMcpHttpHost`. The __PRODUCT_DISPLAY_NAME__ CLI supplies its
  existing name and description for both stdio and HTTP carriers.
- 5134b3b: **BREAKING — RUNTIME-003 P2: `submit` hands back the submission's identity, so an answer belongs to
  the caller who asked for it.**

  `submit` returned nothing, so a caller that needed to know when ITS turn ended had only the
  session-global `complete` / `interrupted` / `error` events — which say that A turn ended and never
  which one. The MCP adapter did exactly that, and the result was measurable: a session runs one turn
  at a time and queues the rest, so two concurrent `submit` calls did not run concurrently. The second
  waited and then took the RUNNING turn's response as its own answer. Both callers were told about one
  turn; neither was told which.

  `submit` now returns an `ITurnHandle` — `{ turnId, completed }`. The id is minted when the submission
  is ACCEPTED and kept if it waits in the queue, so one submission is one identity from end to end.

  `completed` always settles, and that is the part that took the work. A queued submission is not
  promised a turn: the co-drive queue coalesces a same-driver input into the one behind it, drops at
  capacity, and discards everything when cleared. A handle that settled only for submissions that ran
  would leave the rest waiting forever — a worse failure than the ambiguity it replaces — so each of
  those rejects with a typed `TurnNotRunError` naming which happened (`coalesced`, `dropped`,
  `cancelled` — shutdown clears the queue through the same path, so it reports as cancelled).

  **Migration.** A caller that ignores the return value is unaffected: `await session.submit(...)`
  still means what it did, and the direct path still resolves only when the turn is over. An
  IMPLEMENTER of `IInteractiveSession` must now return a handle:

  ```ts
  // before
  async submit(input: string): Promise<void> {
    await runTurn(input);
  }

  // after
  async submit(input: string): Promise<ITurnHandle> {
    const turnId = crypto.randomUUID();
    return { turnId, completed: runTurn(input) };
  }
  ```

  `createTestInteractiveSession` already returns a conforming handle, so a double built on it needs no
  change.

  One thing this deliberately does NOT do: DAG run advancement (P3) stays with DAG-001.

  An earlier draft of this note claimed the HTTP route's documented TOCTOU had been measured and was
  not reachable. That was wrong, and it is corrected here rather than left for a reader to trip over.
  The probe behind it used a `submit` stub with no suspension point, so it could not exhibit the race
  it was written to rule out; the real `submit` opens with `await ensureInitialized()`. The race is
  real and is fixed in its own change (#1656), where the route CLAIMS the turn instead of asking
  whether one is running.

### Minor Changes

- 3131209: `__PRODUCT_CLI_NAME__ mcp serve` can serve a remote MCP client as an OAuth resource server.

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
  `--oauth-allowed-subjects` and `--trusted-proxy` to `__PRODUCT_CLI_NAME__ mcp serve`. It binds an address other than
  `127.0.0.1` only with the public URL and the OAuth settings, and never with `--http-token-file`.
  Refusals are logged on stderr without token text.

- 9db63ee: Add named session capability roles and explicit capability-host queries while preserving the legacy
  `IInteractiveSession` interface shape. HTTP, MCP, protocol, WS, WebRTC, and headless transports now
  declare only the session roles they consume, and the direct aggregate-cast floor is zero.

### Patch Changes

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- Updated dependencies [37b4bd7]
- Updated dependencies [50d2c9f]
- Updated dependencies [a5961c9]
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
- Updated dependencies [7669851]
- Updated dependencies [4b76cfa]
- Updated dependencies [07b627f]
- Updated dependencies [9665c6e]
- Updated dependencies [44393be]
- Updated dependencies [c7fa299]
- Updated dependencies [5134b3b]
- Updated dependencies [5c5ff23]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-interface-session@3.0.0-beta.80
  - @robota-sdk/agent-interface-transport@3.0.0-beta.80
  - @robota-sdk/agent-transport@3.0.0-beta.80

## 3.0.0-beta.79

### Patch Changes

- @robota-sdk/agent-interface-transport@3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- @robota-sdk/agent-interface-transport@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- @robota-sdk/agent-interface-transport@3.0.0-beta.77

## 3.0.0-beta.76

### Minor Changes

- 9df3a88: Split the consolidated `@robota-sdk/agent-transport` package into per-concern transport packages (DQ-AUDIT-005) so unrelated heavy dependencies (React/Ink, ws, Hono, MCP SDK) no longer share one publishable unit and are not dragged into non-TUI consumers' graphs:

  - `@robota-sdk/agent-transport` — lean core: headless adapter + `TransportRegistry` + scripted-provider testing fixtures (no external runtime deps).
  - `@robota-sdk/agent-transport-tui` — React + Ink terminal UI.
  - `@robota-sdk/agent-transport-ws` — WebSocket transport + protocol (`agent-web-ui` now depends only on this for WS types).
  - `@robota-sdk/agent-transport-http` — Hono HTTP transport.
  - `@robota-sdk/agent-transport-mcp` — MCP server transport.

  The default transport-registry wiring (pre-registering `WsTransport`) moves to the CLI composition root, removing the core→ws edge.

### Patch Changes

- @robota-sdk/agent-interface-transport@3.0.0-beta.76
