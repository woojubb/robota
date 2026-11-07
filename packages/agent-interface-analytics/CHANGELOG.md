# @robota-sdk/agent-interface-analytics

## 3.1.2

## 3.1.1

## 3.1.0
### Minor Changes

- bc8de21: `TSessionLoadOutcome` gains a fifth status, `locked`: the record is there and sealed, and this
  process cannot open it right now (`reason: 'no-keys'` when the store keeps its records `'plain'`,
  `'changed'` when a held session's file changed since). `list()` leaves locked sessions out, since
  there is no record to describe; the optional `scan()` returns the listing together with how many it
  left out — `locked`, which an unlock would list, and an optional `noKeys` for those sealed with keys
  this process does not have — and `scanSessionStore`/`listResumableSessions` in
  `@robota-sdk/agent-framework` read it. `lockedSessionReason`, `lockedSessionMessage(id, reason)` and
  `lockedSessionsNotice(locked, noKeys)` word a sealed session by why it does not open, so only locked
  keys are ever met with "unlock"; resume, rename, hand-off, usage and the CLI's notices follow them. A
  served session listing carries how many sealed sessions the host cannot open, its keys locked or
  none that open them, as `lockedSessionCount`; the reason does not cross the wire, so the terminal
  picker and the web session list say how many are sealed and not listed, never to unlock.

  `@robota-sdk/agent-interface-analytics` adds an optional `IPersonalUsageCoverage.lockedSessions`, the
  number of sealed sessions a usage report could not open (locked keys, or none that open them).
  `@robota-sdk/agent-session-analytics` adds an optional `IPersonalUsageSnapshot.lockedSessionCount`,
  which fills it, and the formatted report then reads `locked N` in its coverage line.

  What to do: a `switch` over `outcome.status` handles `locked`; when you write, treat it like
  `corrupt` (do not save over it). A surface that lists sessions can show `scan().locked` and
  `scan().noKeys` so sealed sessions do not look deleted.
- b56b5a9: Ship one build per package. The platform-neutral entries moved from `dist/node` to `dist`, and the second
  `dist/browser` build of `@robota-sdk/agent-core`, `@robota-sdk/agent-transport`,
  `@robota-sdk/agent-ui-web` and `@robota-sdk/agent-transport-webrtc-web` is gone: a neutral entry runs
  unchanged in every runtime, so a subpath's `exports` map `import` and `require` to the same files and no
  longer a `node` or `browser` condition (a Node-only subpath keeps `"browser": null`). Import specifiers
  and the code behind them are unchanged; only a deep import of `dist/node/*` or `dist/browser/*` breaks.
  `@robota-sdk/agent-transport/client` also ships a CommonJS build now.

## 3.0.7

## 3.0.6

## 3.0.5

## 3.0.4

## 3.0.3

## 3.0.2

## 3.0.1

## 3.0.0
### Minor Changes

- 3c81769: A supervised session accepts attach connections on its control socket.

  - A terminal of the same user sends `{"command":"attach","id","generation","mode":"drive"|"observe","protocol":1}`.
    The session compares the generation with its own. It refuses another generation, an unknown mode or
    protocol, or a fifth concurrent attach. Otherwise it answers `{"status":"attached","driverId":"attach:<n>"}`
    and carries the ordinary session protocol as newline-delimited JSON on the same connection.
  - The driver id is assigned by the session and a client-sent one is ignored. Turns submitted from an
    attached terminal are attributed to it and counted under the new `attach` usage surface.
  - `drive` sends prompts and answers the session's questions under the usual co-drive rules. `observe`
    is read-only and never counts as a surface that can answer, so an unattended session still denies
    its prompts at once.
  - Detaching or crashing ends only that connection: a turn in progress keeps running, a prompt no other
    surface can answer is denied, and the session returns to its unattached posture. A reader that falls
    1 MiB behind is disconnected, and an oversize frame closes only its own connection. Stopping the
    session ends attached connections with it.
  - Commands from an attached terminal carry the remote origin, so pairing, revoking and reading the
    pairing link stay refused. An attached terminal is never an operator approver; supervised sessions
    keep refusing mesh connections that need one.
  - A client may send its first frames in the same write as the handshake; only the handshake line
    itself is held to the control endpoint's line limit.
  - `agent-framework`: the surface a turn was submitted on now reaches its usage observation. It was
    dropped before, so remote-control turns were counted as `unknown`.
  - The terminal client (`robota session attach`) and the view keys come separately.
- 4078a72: Model fallback chain. `--fallback-model a,b` (or the `fallbackModel` settings array; the flag wins) names up to three models a turn moves to when its model is overloaded, unavailable or failing on the server. An entry is a provider profile, `profile:model`, a bare model on the primary's provider, or `default`. The move happens only before any output has streamed, lasts for the current turn, and is shown as a system note; entries that cannot be built are passed over and entries outside the organization's `allowedProviders` are dropped with a notice. `FallbackProvider` in agent-framework implements it over the session's provider; `IChatOptions` gains `executionId`, `onModelFallback` and `preserveContextWindow`, `IAIProvider` gains optional `resolveModelRoute`, and the execution loop emits a `provider_fallback` event and attributes requests, call observations, committed replies, the response cache and usage to the model that answered. A turn that ran on more than one model records per-model `modelShares` on its usage observation, which personal usage reports split by model and provider. A `/provider` switch keeps the chain, read again for the new primary.
- fef3a50: New package `@robota-sdk/agent-telemetry-otel`. `projectLivePromptTrace(batch, { mode, agentName })`
  maps one live prompt trace batch onto content-free OpenTelemetry span shapes without depending on an
  OpenTelemetry SDK. `mode: 'agent'` keeps Robota's `agent.*` span and attribute names; `mode: 'gen_ai'`
  uses the OpenTelemetry GenAI semantic conventions (`invoke_agent`, `chat`, `execute_tool`, `gen_ai.*`
  attributes, `GEN_AI_SCHEMA_URL`) and keeps Robota-only facts such as timing and outcome as `agent.*`;
  `mode: 'gen_ai/dup'` emits both attribute sets under GenAI span names for a gradual migration.

  `IToolBodyTraceEntry` gains an optional live-only `toolName`, which the GenAI projection uses for the
  `execute_tool` span name and `gen_ai.tool.name`.

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
- 2c612ba: Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- 9c6a8db: A personal usage aggregate's `costStatus` no longer reads as `'unknown'` just because one observation
  in it couldn't be priced (a legacy row, an unknown model, an unpriced advisor call) — it now falls back
  to `'unknown'` only when nothing in the aggregate could be priced at all, so `costUsd` and `costStatus`
  agree with each other. The new `unpricedTurns` field counts the turns excluded from `costUsd` for this
  reason, present only when that count is above zero.

  The personal usage report also gained `sessionFirstSeen`, an ISO timestamp per session id of its
  earliest observation or activity in the report — content-free, like the rest of the report — so a GUI
  can label a session outside its own local listing by date instead of a raw id.
- 7d9cc66: Observe scheduler queue intervals separately from pre-dispatch admission, permission and tool work.
  Preserve valid duration totals when live trace detail is bounded, reporting invalid evidence explicitly
  through content-free console and OTLP traces without altering dispatch, recovery or settlement.

## 3.0.0-beta.106

## 3.0.0-beta.105

## 3.0.0-beta.104

## 3.0.0-beta.103

## 3.0.0-beta.102

## 3.0.0-beta.101

## 3.0.0-beta.100

## 3.0.0-beta.99

## 3.0.0-beta.98

## 3.0.0-beta.97

## 3.0.0-beta.96

## 3.0.0-beta.95

## 3.0.0-beta.94
### Minor Changes

- fef3a50: New package `@robota-sdk/agent-telemetry-otel`. `projectLivePromptTrace(batch, { mode, agentName })`
  maps one live prompt trace batch onto content-free OpenTelemetry span shapes without depending on an
  OpenTelemetry SDK. `mode: 'agent'` keeps Robota's `agent.*` span and attribute names; `mode: 'gen_ai'`
  uses the OpenTelemetry GenAI semantic conventions (`invoke_agent`, `chat`, `execute_tool`, `gen_ai.*`
  attributes, `GEN_AI_SCHEMA_URL`) and keeps Robota-only facts such as timing and outcome as `agent.*`;
  `mode: 'gen_ai/dup'` emits both attribute sets under GenAI span names for a gradual migration.

  `IToolBodyTraceEntry` gains an optional live-only `toolName`, which the GenAI projection uses for the
  `execute_tool` span name and `gen_ai.tool.name`.

## 3.0.0-beta.93

## 3.0.0-beta.92

## 3.0.0-beta.91

## 3.0.0-beta.90

## 3.0.0-beta.89

## 3.0.0-beta.88

## 3.0.0-beta.87

### Patch Changes

- Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- 7d9cc66: Observe scheduler queue intervals separately from pre-dispatch admission, permission and tool work.
  Preserve valid duration totals when live trace detail is bounded, reporting invalid evidence explicitly
  through content-free console and OTLP traces without altering dispatch, recovery or settlement.

## 3.0.0-beta.86

## 3.0.0-beta.85

## 3.0.0-beta.84

### Patch Changes

- 9c6a8db: A personal usage aggregate's `costStatus` no longer reads as `'unknown'` just because one observation
  in it couldn't be priced (a legacy row, an unknown model, an unpriced advisor call) — it now falls back
  to `'unknown'` only when nothing in the aggregate could be priced at all, so `costUsd` and `costStatus`
  agree with each other. The new `unpricedTurns` field counts the turns excluded from `costUsd` for this
  reason, present only when that count is above zero.

  The personal usage report also gained `sessionFirstSeen`, an ISO timestamp per session id of its
  earliest observation or activity in the report — content-free, like the rest of the report — so a GUI
  can label a session outside its own local listing by date instead of a raw id.

## 3.0.0-beta.83

### Minor Changes

- 3c81769: A supervised session accepts attach connections on its control socket.

  - A terminal of the same user sends `{"command":"attach","id","generation","mode":"drive"|"observe","protocol":1}`.
    The session compares the generation with its own. It refuses another generation, an unknown mode or
    protocol, or a fifth concurrent attach. Otherwise it answers `{"status":"attached","driverId":"attach:<n>"}`
    and carries the ordinary session protocol as newline-delimited JSON on the same connection.
  - The driver id is assigned by the session and a client-sent one is ignored. Turns submitted from an
    attached terminal are attributed to it and counted under the new `attach` usage surface.
  - `drive` sends prompts and answers the session's questions under the usual co-drive rules. `observe`
    is read-only and never counts as a surface that can answer, so an unattended session still denies
    its prompts at once.
  - Detaching or crashing ends only that connection: a turn in progress keeps running, a prompt no other
    surface can answer is denied, and the session returns to its unattached posture. A reader that falls
    1 MiB behind is disconnected, and an oversize frame closes only its own connection. Stopping the
    session ends attached connections with it.
  - Commands from an attached terminal carry the remote origin, so pairing, revoking and reading the
    pairing link stay refused. An attached terminal is never an operator approver; supervised sessions
    keep refusing mesh connections that need one.
  - A client may send its first frames in the same write as the handshake; only the handshake line
    itself is held to the control endpoint's line limit.
  - `agent-framework`: the surface a turn was submitted on now reaches its usage observation. It was
    dropped before, so remote-control turns were counted as `unknown`.
  - The terminal client (`__PRODUCT_CLI_NAME__ session attach`) and the view keys come separately.

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

## 3.0.0-beta.82

## 3.0.0-beta.81

## 3.0.0-beta.80

### Minor Changes

- 4078a72: Model fallback chain. `--fallback-model a,b` (or the `fallbackModel` settings array; the flag wins) names up to three models a turn moves to when its model is overloaded, unavailable or failing on the server. An entry is a provider profile, `profile:model`, a bare model on the primary's provider, or `default`. The move happens only before any output has streamed, lasts for the current turn, and is shown as a system note; entries that cannot be built are passed over and entries outside the organization's `allowedProviders` are dropped with a notice. `FallbackProvider` in agent-framework implements it over the session's provider; `IChatOptions` gains `executionId`, `onModelFallback` and `preserveContextWindow`, `IAIProvider` gains optional `resolveModelRoute`, and the execution loop emits a `provider_fallback` event and attributes requests, call observations, committed replies, the response cache and usage to the model that answered. A turn that ran on more than one model records per-model `modelShares` on its usage observation, which personal usage reports split by model and provider. A `/provider` switch keeps the chain, read again for the new primary.

### Patch Changes

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
