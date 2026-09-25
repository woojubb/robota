# @robota-sdk/agent-remote-client

## 3.0.0-beta.80

### Minor Changes

- 4078a72: Model fallback chain. `--fallback-model a,b` (or the `fallbackModel` settings array; the flag wins) names up to three models a turn moves to when its model is overloaded, unavailable or failing on the server. An entry is a provider profile, `profile:model`, a bare model on the primary's provider, or `default`. The move happens only before any output has streamed, lasts for the current turn, and is shown as a system note; entries that cannot be built are passed over and entries outside the organization's `allowedProviders` are dropped with a notice. `FallbackProvider` in agent-framework implements it over the session's provider; `IChatOptions` gains `executionId`, `onModelFallback` and `preserveContextWindow`, `IAIProvider` gains optional `resolveModelRoute`, and the execution loop emits a `provider_fallback` event and attributes requests, call observations, committed replies, the response cache and usage to the model that answered. A turn that ran on more than one model records per-model `modelShares` on its usage observation, which personal usage reports split by model and provider. A `/provider` switch keeps the chain, read again for the new primary.
- 6ece10a: CORE-046: remote streaming works — a served route, one spelling, and the server owns assembly

  `RemoteExecutor.executeChatStream` is back, and this time a server serves what it posts to. CORE-044
  had removed it: the client posted to `${baseUrl}/stream`, a sibling module named `/chat/stream`, and
  no server served either — so every remote streaming call was a 404 dressed as a capability, invisible
  because the client's tests drove a mocked `fetch`. It could not simply be reconnected, because it
  yielded RAW provider chunks and depended on a fragment assembler that CORE-042 deleted.

  - **Transport: SSE**, on `POST /api/v1/remote/chat/stream` — one spelling, in the route table, in
    the client, and in both SPECs. Frames are `delta`, `message`, `done` and `error`; `error` is its
    own frame so a client cannot mistake a failed stream for a finished one, and a stream that ends
    without a terminal message throws rather than returning a truncated turn as an answer.
  - **The server assembles.** It calls `provider.chat(messages, { onTextDelta })` — already every
    provider's contract — so the wire carries text deltas plus one terminal assembled message and
    tool-call fragments never cross it. The client re-implements no accumulator.
  - `executeChatStream` yields ONE assembled message and hands every delta to the caller's
    `onTextDelta`: `IExecutor.executeChatStream` yields `TUniversalMessage`, and a partial message is
    not one.
  - Cancellation is symmetric — aborting closes the socket, and the handler aborts the provider call.

  The three-spellings state survived because no single place could compare them: the server is a
  composition root forbidden from depending on a remote client. A harness scan now reads both literals
  from source and fails when they disagree.

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

### Patch Changes

- 9814afc: Type-SSOT convergence (TYPE-003; re-audit CONTRACT-002/003/011/012 + RUNTIME-47 + STRUCT-04). Behavior is unchanged — this is a type-level refactor. `ITokenUsage` (agent-core) is confirmed as the usage-triple SSOT: `ISessionUsageTotals` and `IBackgroundTaskUsage` become aliases, and every inline `{ promptTokens; completionTokens; totalTokens }` copy (service/orchestration/executor/remote-client shapes) now references the SSOT (structurally identical → patch). The subagent-job contracts derive from the background-task SSOT — `TSubagentJobStatus = Exclude<TBackgroundTaskStatus, 'paused'>`, mode alias, and a `Pick`-projection `ISubagentJobState` — with a compile-enforced parity test so a drifting hand copy can no longer exist. `@robota-sdk/agent-session` is minor because the public `ISessionRecord` type is now the typed `IInteractiveSessionRecord` alias (previously a relaxed `unknown[]` mirror): runtime behavior of `SessionStore` is identical, but downstream code that assigned loose payloads to the record's fields may need explicit casts at its own trust boundary (the framework store facade's `as unknown as` cast bridge is deleted). agent-session's duplicate `@robota-sdk/agent-core` deps/devDeps declaration is also removed (STRUCT-04).
- Updated dependencies [7b6234c]
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

## 3.0.0-beta.79

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- Updated dependencies [6f308d1]
  - @robota-sdk/agent-core@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77

## 3.0.0-beta.76

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76

## 3.0.0-beta.75

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.74

## 3.0.0-beta.73

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.73

## 3.0.0-beta.72

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.71

## 3.0.0-beta.70

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.70

## 3.0.0-beta.69

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.69

## 3.0.0-beta.68

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.67

## 3.0.0-beta.66

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.66

## 3.0.0-beta.65

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.65

## 3.0.0-beta.64

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.64

## 3.0.0-beta.63

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.63

## 3.0.0-beta.62

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.62

## 3.0.0-beta.61

### Patch Changes

- Updated dependencies [1c0d44c]
- Updated dependencies [36eb7a9]
- Updated dependencies [d97bdf2]
  - @robota-sdk/agent-core@3.0.0-beta.61

## 3.0.0-beta.60

### Patch Changes

- Updated dependencies [7439391]
  - @robota-sdk/agent-core@3.0.0-beta.60

## 3.0.0-beta.59

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.59

## 3.0.0-beta.58

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.58

## 3.0.0-beta.57

### Patch Changes

- Updated dependencies [16c3b6f]
- Updated dependencies [f61e2cb]
  - @robota-sdk/agent-core@3.0.0-beta.57

## 3.0.0-beta.56

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.56

## 3.0.0-beta.55

### Patch Changes

- 38a72bf: fix: resolve ESLint tsconfig parsing errors and improve pnpm CI reliability
  - Add tsconfig.eslint.json to all packages for per-package ESLint runs
  - Migrate typecheck from pnpm -r exec tsc to per-package typecheck scripts
  - Add --if-present to all recursive pnpm run scripts
  - Fix React type imports, dynamic imports in tests, Express.Multer types

- Updated dependencies [38a72bf]
  - @robota-sdk/agent-core@3.0.0-beta.55

## 3.0.0-beta.54

### Patch Changes

- fix: resolve all typecheck errors across packages
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.54

## 3.0.0-beta.53

### Patch Changes

- refactor: monolith decomposition — all agent-\* files under 300 lines
- Updated dependencies
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.53

## 3.0.0-beta.52

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.52

## 3.0.0-beta.51

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.51

## 3.0.0-beta.50

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.50

## 3.0.0-beta.49

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.49

## 3.0.0-beta.48

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.48

## 3.0.0-beta.47

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.47

## 3.0.0-beta.46

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.46

## 3.0.0-beta.45

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.45

## 3.0.0-beta.44

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.44
