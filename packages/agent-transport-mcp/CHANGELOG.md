# @robota-sdk/agent-transport-mcp

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
  `robota_submit` tool must pass `submitTool: { name: 'robota_submit', description: '...' }` to
  `createAgentMcpServer`, `createMcpTransport`, or `createMcpHttpHost`. The Robota CLI supplies its
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
