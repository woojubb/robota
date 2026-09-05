# Deployment Matrix — one agent definition → many channels / runtimes

**SELFHOST-013.** Robota already serves **one** live session over many surfaces through a single seam: a
preset-resolved definition (`TInteractiveSessionOptions`) → `buildRuntimeSession(...)` → one
`InteractiveSession`, to which every enabled `IConfigurableTransport` is `attach(session)`'d by
`TransportRegistry.startAll(session)` (`startRuntimeHost` owns the `startAll`/`stopAll` lifecycle). This registry
is the "one definition → many channels" abstraction — there is **no gateway package and no per-surface runtime
fork**. This document is the at-a-glance registry of surface × runtime × transport, mirroring the mechanically
kept [`orchestration-map.md`](./orchestration-map.md).

It is **mechanically kept current** by `scripts/harness/scan-deployment-matrix.mjs` (`pnpm harness:scan` →
`deployment-matrix`): the scan enumerates every transport `name` **from the code** and fails if a transport is
missing a row here (undocumented) or a Transport-`name` row here names a nonexistent transport (phantom).

## Matrix

The **Transport `name`** column is the drift-scanned key — the set of transport adapters that declare a `name`,
verified in code as exactly `{headless, ws, webrtc, http, mcp}`. The **Client / presentation** column is NOT
a transport (React/browser packages carry no transport `name`) and is out of scope for the drift floor.

`headless` was added by HARNESS-052, not by a new transport: the drift scan matched the package-directory prefix
`agent-transport-`, so `packages/agent-transport` — the base package, where `createHeadlessTransport` declares
`name: 'headless'` in exactly the factory form the scan parses — could never contribute a name. The set above had
been asserted as complete by a check structurally incapable of reading one of its members. STRUCT-012 S2
moves that factory into framework `src/transport-host`; discovery follows that explicit owner too.

| Surface        | Runtime                                              | Transport `name`   | Client / presentation        | Prior art in-repo                                           |
| -------------- | ---------------------------------------------------- | ------------------ | ---------------------------- | ----------------------------------------------------------- |
| CLI / terminal | local `agent-cli` process                            | —                  | `agent-transport-tui`        | `renderApp` + `TuiInteractionChannel` presentation boundary |
| CLI / one-shot | local `agent-cli` print mode (`-p`), non-interactive | `headless`         | —                            | `agent-framework` (print / JSON / stream-json runner)       |
| Desktop        | headless `robota --serve` spawned by Electron        | `ws` (nonce auth)  | `agent-transport-gui`        | GUI-002 / RUNTIME-001                                       |
| Web            | `apps/agent-server` (Express + WS) / browser peer    | `ws`               | `agent-transport-webrtc-web` | playground stack                                            |
| HTTP/WS server | headless `robota --serve` / `apps/agent-server`      | `http` / `ws`      | —                            | RUNTIME-001                                                 |
| Remote (P2P)   | local host + signaling relay                         | `webrtc` (pairing) | `agent-transport-webrtc-web` | REMOTE-001                                                  |
| MCP host       | any MCP client                                       | `mcp`              | —                            | —                                                           |

## Transport `name` declaration forms

The drift scan parses both forms (a transport declares its `name` in one of two ways):

- **Class form** — `readonly name = '…'` on an `IConfigurableTransport` class (registry-registrable, has
  `defaultEnabled`): `ws` (`agent-transport-ws/ws-transport-configurable.ts`) and `webrtc`
  (`agent-transport-webrtc`).
- **Factory form** — `name: '…'` on a factory object-literal implementing plain `ITransportAdapter` (no
  `defaultEnabled`; mounted outside `startAll`'s fan-out but still `attach(session)` over the DIP): `http`
  (`agent-transport-http`), `mcp` (`agent-transport-mcp`), `ws` (`agent-transport-ws/ws-transport.ts`),
  `headless` (`agent-framework/src/transport-host/headless/headless-transport.ts` — the framework-owned
  host directory is explicitly included in drift discovery).

**Excluded** (export no transport `name`): `agent-transport-protocol` (shared protocol lib),
`agent-transport-tui`, `agent-transport-gui`, and `agent-transport-webrtc-web` (presentation).

## Fan-out (one session → many transports)

`startAll(session)` starts every `defaultEnabled:true` transport, each `attach(session)`'d to the **same**
`IInteractiveSession` instance. A transport that is `defaultEnabled:false` is skipped until enabled; a plain
`ITransportAdapter` has no settings projection and is always lifecycle-enabled once registered. The live
simultaneous two-transport / one-session case is **REMOTE-001**: a default `WsTransport`
plus the pairing-time `WebRtcTransport`, both `attach(session)` on one instance.

## Deploying one definition over ≥2 channels

See the deploy guide (`docs/`): resolve a definition, `buildRuntimeSession(...)` once, `register` the desired
transports, `startAll(session)`. Each surface keeps its own composition root + auth posture (the CLI resolves
settings/preset/provider; `--serve` adds the loopback `WsTransport` nonce; REMOTE-001 adds the pairing-gated
`WebRtcTransport`). The registry — not a gateway — is what fans the one session out.

## Update requirements

Adding a transport (a new `name`) requires a new **Transport `name`** row here (the drift scan enforces it).
Adding a client/presentation package does **not** (it carries no transport `name`). Never add a gateway package
or a per-surface runtime fork — the registry seam is the abstraction.
