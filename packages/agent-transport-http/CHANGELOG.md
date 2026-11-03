# @robota-sdk/agent-transport-http

## 3.0.5
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.5
  - @robota-sdk/agent-interface-transport@3.0.5
  - @robota-sdk/agent-transport@3.0.5

## 3.0.4
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.4
  - @robota-sdk/agent-interface-transport@3.0.4
  - @robota-sdk/agent-transport@3.0.4

## 3.0.3
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.3
  - @robota-sdk/agent-interface-transport@3.0.3
  - @robota-sdk/agent-transport@3.0.3

## 3.0.2
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.2
  - @robota-sdk/agent-interface-transport@3.0.2
  - @robota-sdk/agent-transport@3.0.2

## 3.0.1
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.1
  - @robota-sdk/agent-interface-transport@3.0.1
  - @robota-sdk/agent-transport@3.0.1

## 3.0.0
### Major Changes

- 6e6b06b: A wire client can now render the whole session the way the in-process terminal UI does: the full
  history, the context window as it changes, when the history changes, and where each turn came from.

  - `agent-interface-session` is **`major`**: `ISessionConversationRead` gains a required
    `getFullHistory()`. Any implementation of it, or of `IInteractiveSession`, must add it.
  - `agent-transport` is **`major`**:
    - It adds `get-history { fromIndex? }` → `history { startIndex, total, entries }`. The history
      crosses one bounded page at a time (at most 256 KiB of entries; a single larger entry is sent
      alone), from `fromIndex` (default 0), so no reply grows with the session. The client asks for
      the next page after the previous one arrived. Entries are `IWireHistoryEntry`: a history entry
      with an ISO 8601 `timestamp`. An observer may send it.
    - `complete` and `interrupted` carry the turn's result without the session's history
      (`TWireExecutionResult`); a client reads the history with `get-history`.
    - It adds `get-prompts`: the host sends the permission and ask prompts still open as the
      `permission_request` / `ask_request` frames that asked them, for a client that attached later.
      An observer may not send it.
    - `pending` gains an optional `pendingCount`: a host sends it when it knows how many prompts are
      queued, and a client that gets none counts the prompt it shows. The host sends `pending` in
      reply to a `submit` once it has taken the prompt, so a prompt queued behind a running turn shows
      as queued.
    - `command` takes an optional `requestId`, which the host echoes on the command's
      `command_result` or `protocol_error`.
    - The session's `context_update` is pushed as the `context` frame that `get-context` answers with.
    - `compact`, `skill_activation` and `memory_event` push the new `history_changed`; the client
      reads the history again.
    - `turn_source` is pushed as the new `turn_source` frame.
    - An exhaustive map over `TClientMessage` or `TServerMessage` types must add the new variants,
      and `IProtocolSession` now requires `getFullHistory()`.
  - `agent-transport-http` is **`major`** only because `IHttpTransportSession` includes the conversation
    read role, so a session handed to it must now provide `getFullHistory()`.
  - `agent-framework`: `SessionSlot` forwards `getFullHistory()` to the current session.
  - `agent-ui-web` receives the new frames and does not render them.
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

- ca44ac6: HTTP clients can now receive and answer permission and ask prompts. `POST /submit` with `receivePrompts: true` streams `permission_request`, `ask_request` and `prompt_resolved`. `GET /prompts` lists the prompts still open, so a client that attaches later can see them, and `POST /prompts/:id` answers one; an id that is not open returns 404, and an answer the session did not take returns 409. Clients that omit `receivePrompts` see no change. `IHttpTransportSession` now also requires `resolvePermission` and `resolveAsk`, which `InteractiveSession` already implements. The `--serve --http-port` API gains these routes as well.
- 9db63ee: Add named session capability roles and explicit capability-host queries while preserving the legacy
  `IInteractiveSession` interface shape. HTTP, MCP, protocol, WS, WebRTC, and headless transports now
  declare only the session roles they consume, and the direct aggregate-cast floor is zero.

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
- 54e2848: `POST /submit` on a session that is still starting (a fresh `InteractiveSession`) now waits for it to start and runs the turn. It used to answer 500 ("concurrent-turn tracking is unavailable") until background initialization finished. A session that fails to start is answered 500 without the reason. `IHttpTransportSession` gains an optional `whenInitialized()` for this.
- 2c612ba: Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- 5783499: Harden file, HTTP, relay, hosted-runtime, editor, and native path boundaries against resource exhaustion, short writes, path races, and integer narrowing.

  Editor integrations now carry `Read`, `Write`, and `Edit` only when their `IEditorFileAccess` adapter declares `pathAuthority: 'stable-root'`; pathname-only adapters continue to receive disk-search notices, while file operations use the tools' stable disk authority. Existing adapters that can prove stable rooted access should add the marker to retain editor-buffer reads and writes.

  `HttpDagRuntimeProvider` accepts a `token` option and applies it to every orchestration and event-stream request so it interoperates with the authenticated native DAG runtime server.
- Updated dependencies [37b4bd7]
- Updated dependencies [50d2c9f]
- Updated dependencies [724fabb]
- Updated dependencies [d877de2]
- Updated dependencies [d61e159]
- Updated dependencies [bfe8ed5]
- Updated dependencies [a5961c9]
- Updated dependencies [3038eb7]
- Updated dependencies [c7f9203]
- Updated dependencies [7b72344]
- Updated dependencies [6ae3f28]
- Updated dependencies [57f57f5]
- Updated dependencies [ba822c1]
- Updated dependencies [6e6b06b]
- Updated dependencies [57280bf]
- Updated dependencies [18c0d5c]
- Updated dependencies [9a01e78]
- Updated dependencies [e8d70ac]
- Updated dependencies [2c612ba]
- Updated dependencies [3427887]
- Updated dependencies [c967c57]
- Updated dependencies [60f3965]
- Updated dependencies [115e104]
- Updated dependencies [04719a9]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
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
- Updated dependencies [c207a31]
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
- Updated dependencies [7911a7d]
- Updated dependencies [7d9cc66]
- Updated dependencies [5c5ff23]
- Updated dependencies [9814afc]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-interface-session@3.0.0
  - @robota-sdk/agent-interface-transport@3.0.0
  - @robota-sdk/agent-transport@3.0.0

## 3.0.0-beta.106
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.106
  - @robota-sdk/agent-interface-transport@3.0.0-beta.106
  - @robota-sdk/agent-transport@3.0.0-beta.106

## 3.0.0-beta.105
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.105
  - @robota-sdk/agent-interface-transport@3.0.0-beta.105
  - @robota-sdk/agent-transport@3.0.0-beta.105

## 3.0.0-beta.104
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.104
  - @robota-sdk/agent-interface-transport@3.0.0-beta.104
  - @robota-sdk/agent-transport@3.0.0-beta.104

## 3.0.0-beta.103
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.103
  - @robota-sdk/agent-interface-transport@3.0.0-beta.103
  - @robota-sdk/agent-transport@3.0.0-beta.103

## 3.0.0-beta.102
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.102
  - @robota-sdk/agent-interface-transport@3.0.0-beta.102
  - @robota-sdk/agent-transport@3.0.0-beta.102

## 3.0.0-beta.101
### Patch Changes

- 5783499: Harden file, HTTP, relay, hosted-runtime, editor, and native path boundaries against resource exhaustion, short writes, path races, and integer narrowing.

  Editor integrations now carry `Read`, `Write`, and `Edit` only when their `IEditorFileAccess` adapter declares `pathAuthority: 'stable-root'`; pathname-only adapters continue to receive disk-search notices, while file operations use the tools' stable disk authority. Existing adapters that can prove stable rooted access should add the marker to retain editor-buffer reads and writes.

  `HttpDagRuntimeProvider` accepts a `token` option and applies it to every orchestration and event-stream request so it interoperates with the authenticated native DAG runtime server.
  - @robota-sdk/agent-interface-session@3.0.0-beta.101
  - @robota-sdk/agent-interface-transport@3.0.0-beta.101
  - @robota-sdk/agent-transport@3.0.0-beta.101

## 3.0.0-beta.100
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.100
  - @robota-sdk/agent-interface-transport@3.0.0-beta.100
  - @robota-sdk/agent-transport@3.0.0-beta.100

## 3.0.0-beta.99
### Patch Changes

  - @robota-sdk/agent-interface-session@3.0.0-beta.99
  - @robota-sdk/agent-interface-transport@3.0.0-beta.99
  - @robota-sdk/agent-transport@3.0.0-beta.99

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
### Patch Changes

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
### Minor Changes

- ca44ac6: HTTP clients can now receive and answer permission and ask prompts. `POST /submit` with `receivePrompts: true` streams `permission_request`, `ask_request` and `prompt_resolved`. `GET /prompts` lists the prompts still open, so a client that attaches later can see them, and `POST /prompts/:id` answers one; an id that is not open returns 404, and an answer the session did not take returns 409. Clients that omit `receivePrompts` see no change. `IHttpTransportSession` now also requires `resolvePermission` and `resolveAsk`, which `InteractiveSession` already implements. The `--serve --http-port` API gains these routes as well.

### Patch Changes

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

- 54e2848: `POST /submit` on a session that is still starting (a fresh `InteractiveSession`) now waits for it to start and runs the turn. It used to answer 500 ("concurrent-turn tracking is unavailable") until background initialization finished. A session that fails to start is answered 500 without the reason. `IHttpTransportSession` gains an optional `whenInitialized()` for this.
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

### Major Changes

- 6e6b06b: A wire client can now render the whole session the way the in-process terminal UI does: the full
  history, the context window as it changes, when the history changes, and where each turn came from.

  - `agent-interface-session` is **`major`**: `ISessionConversationRead` gains a required
    `getFullHistory()`. Any implementation of it, or of `IInteractiveSession`, must add it.
  - `agent-transport` is **`major`**:
    - It adds `get-history { fromIndex? }` → `history { startIndex, total, entries }`. The history
      crosses one bounded page at a time (at most 256 KiB of entries; a single larger entry is sent
      alone), from `fromIndex` (default 0), so no reply grows with the session. The client asks for
      the next page after the previous one arrived. Entries are `IWireHistoryEntry`: a history entry
      with an ISO 8601 `timestamp`. An observer may send it.
    - `complete` and `interrupted` carry the turn's result without the session's history
      (`TWireExecutionResult`); a client reads the history with `get-history`.
    - It adds `get-prompts`: the host sends the permission and ask prompts still open as the
      `permission_request` / `ask_request` frames that asked them, for a client that attached later.
      An observer may not send it.
    - `pending` gains an optional `pendingCount`: a host sends it when it knows how many prompts are
      queued, and a client that gets none counts the prompt it shows. The host sends `pending` in
      reply to a `submit` once it has taken the prompt, so a prompt queued behind a running turn shows
      as queued.
    - `command` takes an optional `requestId`, which the host echoes on the command's
      `command_result` or `protocol_error`.
    - The session's `context_update` is pushed as the `context` frame that `get-context` answers with.
    - `compact`, `skill_activation` and `memory_event` push the new `history_changed`; the client
      reads the history again.
    - `turn_source` is pushed as the new `turn_source` frame.
    - An exhaustive map over `TClientMessage` or `TServerMessage` types must add the new variants,
      and `IProtocolSession` now requires `getFullHistory()`.
  - `agent-transport-http` is **`major`** only because `IHttpTransportSession` includes the conversation
    read role, so a session handed to it must now provide `getFullHistory()`.
  - `agent-framework`: `SessionSlot` forwards `getFullHistory()` to the current session.
  - `agent-ui-web` receives the new frames and does not render them.

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

### Minor Changes

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
