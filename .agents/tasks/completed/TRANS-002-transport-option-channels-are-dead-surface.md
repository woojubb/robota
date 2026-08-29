---
title: "TRANS-002: transport option channels are declared everywhere and applied nowhere — the registry never delivers persisted options to a transport, and agent-transport-http's basePath is never read"
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2480#issuecomment-5460392479
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-transport, packages/agent-transport-http, packages/agent-interface-transport
depends_on: []
---

# TRANS-002: settings-backed transport options never reach a transport

## Resolution

Returned to implementation follow-up issue #2480 on 2026-08-29. The defect is still valid and
requires source/API work; this document-only migration makes no implementation change.

## Problem

The transport contract and three adapters advertise settings-configurable `options` (schema,
defaults, validation), but no runtime path applies a persisted option to a transport — a
`settings.json` `transports.<name>.options.port` is read into the registry and then displayed to the
user while never being applied, and the validation hook can never fire. Separately,
`agent-transport-http`'s `basePath` option is declared and advertised but never read.

## Evidence (adversarially verified 2026-08-13, CONFIRMED)

- `packages/agent-transport/src/transport-registry.ts:84-94` — `startAll` calls `getEnabled()` (which
  discards config) then `attach()`+`start()`; persisted `config.options` never reach a transport.
  `resolveConfig` (`:168-175`) reads `settings.transports.<name>.options` into `getAll()`, whose only
  consumer is `TransportTUI.tsx:29` — which DISPLAYS a port hint that is never applied (WsTransport's
  port comes solely from its constructor at the composition root, `robota-plumbing.ts:68-71`, from env
  `ROBOTA_WS_PORT`/defaults).
- Repo-wide ZERO call sites of `.setOptions(` or `.validateOptions(`. The registry's `setOptions`
  (`transport-registry.ts:65`, advertised at `agent-transport/docs/SPEC.md:171`) is an inert
  write-only persistence method; the `validateOptions` impls on ws/webrtc/tui transports are dead
  code.
- The one settings-options path that DOES work — `transports.webrtc.options.*` read by bespoke readers
  in `agent-cli/src/remote-control/index.ts:24-46` → `WebRtcTransport` constructor
  (`remote-control-controller.ts:473`) — bypasses the registry entirely at the composition root (the
  sanctioned constructor path, not the registry channel).
- `packages/agent-transport-http/src/http-transport.ts:20-22` declares `basePath`; README:19,47
  advertise it; `start()` (`:57-65`) never reads it (`IAgentRoutesOptions` has no `basePath`) — routes
  always mount at root.

## Direction

Deliver `config.options` at `startAll` through a contract method (e.g. `configure(options)`,
validating via `validateOptions`) so persisted settings actually reach transports — OR delete
`optionsSchema`/`validateOptions`/`setOptions` and shrink the SPEC's claim to enable/disable only
(and stop `TransportTUI` displaying an inapplicable port). For `-http`, honor `basePath`
(`new Hono().route(basePath, routes)`) or delete the option and its README claim. Silent-ignore is the
one wrong state. (Adjacent to ARCH-011's lifecycle/contract-shape work — coordinate.)

## Test Plan

- Red-first: a persisted `transports.ws.options.port` actually changes the WS listen port through the
  registry (or, if deleted, the option no longer exists and the TUI shows no port). Fails today.
- Red-first (-http): `basePath: '/agent'` mounts routes under `/agent` (or the option is gone).
- `pnpm harness:verify -- --scope packages/agent-transport` and `--scope packages/agent-transport-http`
  green.

## User Execution Test Scenarios

**Applies** (transport settings are user-editable in settings.json / the transport picker).

- Prerequisites: built CLI; a `settings.json` setting `transports.ws.options.port` to a non-default
  value.
- Steps: start `robota --serve`; check the actual WS listen port.
- Expected (after the "apply" fix): the server listens on the configured port.
- Expected (before fix, contrast): it listens on the default/env port and the picker still shows the
  configured-but-ignored value.
- Cleanup: revert settings.json.
- Evidence (fill in after implementation): the server's actual listen port vs the configured value.
