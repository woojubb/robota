# @robota-sdk/agent-interface-analytics

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
  - The terminal client (`robota session attach`) and the view keys come separately.

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
