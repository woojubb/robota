---
status: approved
type: INFRA
tags: [deployment, gateway, transport, multi-surface, agent-server, selfhost]
---

# SELFHOST-013: multi-surface deployment + gateway (one agent definition → many channels/runtimes)

## Problem

Promotes backlog [SELFHOST-013](../../backlog/SELFHOST-013-multi-surface-deployment-gateway.md) toward
[VISION.md](../../../VISION.md). Concrete symptom: Robota **already** runs one agent over many surfaces —
terminal (TUI/print), desktop (Electron), web (playground), HTTP/WS server, and remote (P2P) — and every one
of them attaches to a single live session through the **same transport DIP**: `IConfigurableTransport<TSession>`
([`packages/agent-interface-transport/src/transport-config.ts`](../../../packages/agent-interface-transport/src/transport-config.ts))
started by `TransportRegistry.startAll(session)`
([`packages/agent-transport/src/transport-registry.ts`](../../../packages/agent-transport/src/transport-registry.ts))
over the one session-construction seam `buildRuntimeSession` / `startRuntimeHost`
([`packages/agent-framework/src/runtime/runtime-host.ts`](../../../packages/agent-framework/src/runtime/runtime-host.ts)).

But **that capability is entirely implicit in code** — there is no documented, first-class "one agent
definition → many channels/runtimes" deployment story, and no **deployment matrix** naming which surface maps
to which transport and which runtime. A user (or the self-hosting agent) who wants to deploy one Robota agent
config across two channels must reverse-engineer the wiring from `cli.ts`, `serve-mode.ts`, the Electron
sidecar, and `remote-control-controller.ts`. Every competitive agent framework ships a documented deploy
story; Robota has the mechanism but not the pattern. This is a **packaging + documentation** gap over an
already-correct DIP — **not** a missing runtime and **not** a re-architecture.

## Prior Art Research

From product documentation:

- **Nous Research Hermes** ([hermes-agent.nousresearch.com/docs](https://hermes-agent.nousresearch.com/docs/)) —
  a chat-platform **gateway** fanning one agent out to 20+ channels (Discord/Slack/Telegram/…) plus 6+
  terminal/deploy backends (Docker/SSH/Daytona/Modal). The deploy target is an abstraction; the agent
  definition is authored once and bound to many channels.
- **Google ADK** ([google.github.io/adk-docs](https://google.github.io/adk-docs/)) — **deployment-agnostic**
  by design: the same agent runs locally, on Vertex AI Agent Engine, or on Cloud Run without editing the agent
  definition; the runtime is a deploy-time choice, not baked into the agent.

**Common shape:** author one agent definition; a **deploy/target abstraction** binds it to many channels and
runtimes without editing the definition. **Robota constraint / delta:** Robota **already has that abstraction**
— it is the transport DIP (`IConfigurableTransport` + `TransportRegistry.startAll(session)` over the single
`buildRuntimeSession` seam). Each surface individually rides it (RUNTIME-001 `robota --serve`, GUI-002 desktop
sidecar, REMOTE-001 P2P), and **REMOTE-001 is the concrete case of two transports sharing one live session
simultaneously** — a default `WsTransport` plus the pairing-time `WebRtcTransport`, both `attach(session)` on the
same instance (the latter started out-of-band, `defaultEnabled:false`). Hermes/ADK ship a **gateway service** as a new component; Robota **must not**
— a new gateway package would re-introduce the sibling coupling the DIP exists to prevent. The delta is
therefore purely the **documented pattern + the matrix + a proof test** that one definition serves ≥2
transports unchanged — packaging/docs, plus at most thin, convention-level glue.

## Architecture Review

### Affected Scope

- **Transport DIP (unchanged, cited as the load-bearing prior art).** The seam already exists and is correct:
  - `ITransportAdapter<TSession>` / `IConfigurableTransport<TSession>` — the port every surface implements
    ([`agent-interface-transport/src/transport-adapter.ts`](../../../packages/agent-interface-transport/src/transport-adapter.ts),
    [`transport-config.ts`](../../../packages/agent-interface-transport/src/transport-config.ts)).
  - `TransportRegistry.startAll(session)` attaches **one** `IInteractiveSession` to **every** enabled transport
    ([`agent-transport/src/transport-registry.ts`](../../../packages/agent-transport/src/transport-registry.ts)).
  - `buildRuntimeSession` is the single construction seam; `startRuntimeHost({ session, transportRegistry })`
    owns the `startAll/stopAll` lifecycle
    ([`agent-framework/src/runtime/runtime-host.ts`](../../../packages/agent-framework/src/runtime/runtime-host.ts)).
    TUI, print, and headless `--serve` are three presentations over the one seam.
  - Live surfaces already prove the fan-out: `WsTransport` registered in
    [`agent-cli/src/cli.ts`](../../../packages/agent-cli/src/cli.ts) (`createDefaultTransportRegistry`),
    served headless by [`serve-mode.ts`](../../../packages/agent-cli/src/modes/serve-mode.ts) (RUNTIME-001),
    spawned by the desktop sidecar [`apps/agent-app/electron/sidecar.ts`](../../../apps/agent-app/electron/sidecar.ts)
    (GUI-002). Available implementations: `agent-transport-tui`, `-ws`, `-http`, `-mcp`, `-webrtc`,
    `-webrtc-web`, `-gui`.
  - **The concrete live SIMULTANEOUS two-transport / one-session prior art is REMOTE-001.** A default network
    transport (`WsTransport`, `defaultEnabled:true`, picked up by `startAll`) and the pairing-gated
    `WebRtcTransport` attach to the **same** `IInteractiveSession` instance at once. The `WebRtcTransport` is
    **`defaultEnabled:false`** and is started **OUT-OF-BAND** by
    [`remote-control-controller.ts`](../../../packages/agent-cli/src/remote-control/remote-control-controller.ts)
    (`registry.register(transport); transport.attach(session); void transport.start()` at :216-220, and again for
    reconnect rooms at :348-350) — it is **attached to the same session but NOT picked up by `startAll`** (there
    is no start-one method; `startAll` only starts `defaultEnabled:true` transports). This out-of-band pattern is
    the live proof that one session instance feeds two transports concurrently, and is the grounding for TC-01
    (reference-identity) and TC-04 (the runnable example). Note the important framing: the default CLI / `--serve`
    path runs a **single** network transport — the five surfaces are _individually_ proven over the one seam, but
    they do **not** all exercise the fan-out concurrently; REMOTE-001 is the one place two transports share one
    live session simultaneously today.
- **This work adds NO transport, NO package, NO sibling edge.** It adds:
  - A **deployment matrix** (registry doc): surface × runtime × `IConfigurableTransport` impl — mirroring the
    mechanically-kept [`orchestration-map.md`](../../specs/orchestration-map.md) registry precedent.
  - A **user-facing deploy guide** in `docs/` describing the one-definition→many-channels pattern over the
    registry seam.
  - A **runnable example** under `examples/` serving one definition over ≥2 transports simultaneously.
  - A **reference-identity proof test** that one `buildRuntimeSession` session, registered against ≥2
    transports, is the **same `IInteractiveSession` instance** each transport's `attach()` receives (strict
    reference identity, `t1.attached === t2.attached === session`) — the falsifiable DIP claim (TC-01).
  - **Thin glue only if the example demands it** — and only as a documented convention re-using the existing
    registry API, never a new port or package.
- **"Agent definition" clarified.** The served definition is the **preset-resolved
  `TInteractiveSessionOptions`** (agentName/persona/permissionMode/tools/provider) that `serve-mode.ts` maps
  and `buildRuntimeSession` turns into one `InteractiveSession`; `IAgentDefinition`
  ([`agent-framework/src/agents/agent-definition-types.ts`](../../../packages/agent-framework/src/agents/agent-definition-types.ts))
  is the _subagent_-definition shape. The matrix documents the resolved-session config as the deploy unit and
  does not conflate the two.

### Alternatives Considered

1. **Document the existing registry seam: a deployment-matrix registry doc + a deploy guide + a runnable
   multi-transport example + a one-def-over-≥2-transports proof test; any glue is a documented convention over
   the existing `TransportRegistry` API — no new package/transport/edge (CHOSEN).**
   - ✅ Rides the DIP exactly as it stands; the matrix/example/test formalize a capability the five live
     surfaces already exercise. Zero new coupling — `check-dependency-direction.mjs` (`deps` scan) stays green
     by construction. Mirrors the `orchestration-map.md` registry precedent. Falsifiable: the proof test fails
     loudly if any surface secretly branches instead of sharing one session.
   - ❌ Adds no new runtime capability — it is deliberately docs/packaging; value is legibility + a regression
     guard, not new function (stated, not hidden).
2. **Build a first-class "gateway" package/service (Hermes-style) that fans one definition out to channels.**
   - ✅ A single explicit entry point; matches the Hermes/ADK component shape most literally.
   - ❌ Re-implements `TransportRegistry.startAll(session)` as a new sibling that every surface would depend on
     — precisely the coupling the DIP removes; new package = new dependency edges + publish/SPEC ceremony;
     duplicates the one seam. Violates the "no new sibling coupling / no new transport" constraint. REJECTED.
3. **A `robota deploy <surface>` CLI command umbrella wrapping each transport.**
   - ✅ Discoverable single command; nice UX veneer.
   - ❌ Pulls surface-selection into the `agent-cli` product shell as new command scope, and each surface
     already has its correct entry (`--serve`, the desktop sidecar spawn, `/remote-control`); a wrapper command
     would duplicate composition-root wiring the surfaces own. Not required to close the documented-pattern gap;
     a possible thin follow-up at most, not the core. REJECTED for v1.

### Decision

Adopt (1): SELFHOST-013 is a **documentation + packaging** effort over the **existing** transport DIP. Ship (a)
a **deployment-matrix** registry doc (surface × runtime × `IConfigurableTransport`, mirroring
`orchestration-map.md`), (b) a user-facing deploy guide in `docs/`, (c) a runnable `examples/` program serving
one definition over ≥2 transports, and (d) a **reference-identity proof test** that one `buildRuntimeSession`
session is the same instance every registered transport's `attach()` receives. **No new transport, no new package, no new sibling
edge**; any glue is a documented convention over the current `TransportRegistry` API. The gateway-service and
`robota deploy` command shapes are consciously rejected as re-coupling / out-of-scope.

### Validated Recommendation

- **Reachability:** the pattern is reachable today — `buildRuntimeSession` builds one session,
  `TransportRegistry.register(...)` + `startAll(session)` serve it over N transports; the five live surfaces
  (cli/desktop/web/server/remote) already do this. Verified against `runtime-host.ts`,
  `transport-registry.ts`, `cli.ts`, `serve-mode.ts`, `sidecar.ts`, and `remote-control-controller.ts`. The
  example and matrix bind existing pieces; nothing new must be invented to reach the deployment story.
- **Capability preservation:** no capability is dropped or hidden — every surface keeps its own composition
  root and auth posture (e.g. WS nonce auth GUI-002, WebRTC pairing gate REMOTE-001). The matrix documents each
  surface's runtime + transport rather than collapsing them behind a lossy single façade (the failure mode that
  killed alternative 2).
- **Adversarial:** the risk is **scope creep into re-architecting transports or adding a gateway sibling** —
  fenced two ways: (a) the Decision forbids any new package/transport/edge; (b) TC-03 makes the `deps` scan
  (`check-dependency-direction.mjs`) a mechanical FAIL floor for any new bidirectional dep / pass-through
  re-export / new transport package this work might introduce. A second risk — the docs drifting from the real
  transports — is fenced by TC-02, a `harness:scan` drift floor with a **named enumerable source** (the
  `packages/agent-transport-*` package set excluding `-protocol`, or a static transport-name manifest): every
  transport `name` must appear as a matrix row and no row may name a nonexistent transport, per
  [enforcement-architecture.md](../../rules/enforcement-architecture.md) (a guardian needs a mechanical source,
  not a hand-maintained assertion).

### Architecture Review Checklist

- [x] 영향 패키지/레이어: NO new package/transport/edge. Adds a deployment-matrix registry doc (mirror
      `orchestration-map.md`), a `docs/` deploy guide, an `examples/` multi-transport program, and a proof test —
      all over the existing `IConfigurableTransport` + `TransportRegistry.startAll(session)` + `buildRuntimeSession`
      seam (`agent-interface-transport`, `agent-transport`, `agent-framework`).
- [x] Sibling scan 완료 — the fan-out already exists: five live surfaces (RUNTIME-001 `--serve`, GUI-002
      desktop sidecar, REMOTE-001 P2P WebRTC, playground web, MCP) attach to ONE `IInteractiveSession` via the
      registry. This spec documents/tests that, adding no sibling. A gateway-service sibling (alt 2) is REJECTED as
      re-coupling.
- [x] 대안 최소 2개 — 3 considered (document-the-seam CHOSEN; gateway-service REJECTED coupling; `robota deploy`
      command REJECTED scope), each Pro+Con, correctness-grounded.
- [x] 결정 근거 — the DIP already enables one-def→many-channels; the gap is the documented pattern + matrix +
      proof test, not new infra. No-new-coupling is enforced by the `deps` scan (TC-03), matrix↔transport
      consistency by TC-02. GATE-APPROVAL pending.

## Solution

Deliverables, all over the **existing** transport DIP (no new transport/package/edge):

1. **Deployment matrix** — a registry doc (surface × runtime × `IConfigurableTransport` impl), mirroring the
   mechanically-kept `orchestration-map.md`. Initial rows:

   The matrix separates the **transport `name`** (the value the drift scan enumerates — the set
   `{tui, ws, webrtc, http, mcp}`) from the **client / presentation** layer (React/browser packages that are NOT
   transports and carry no `name`: `-gui`, `-webrtc-web`, and the `agent-transport` print renderer), so TC-02's
   "no phantom rows" is well-defined against the transport `name` column only.

   | Surface        | Runtime                                           | Transport `name`   | Client / presentation        | Prior art in-repo     |
   | -------------- | ------------------------------------------------- | ------------------ | ---------------------------- | --------------------- |
   | CLI / terminal | local `agent-cli` process                         | `tui`              | `agent-transport` print      | —                     |
   | Desktop        | headless `robota --serve` spawned by Electron     | `ws` (nonce auth)  | `agent-transport-gui`        | GUI-002 / RUNTIME-001 |
   | Web            | `apps/agent-server` (Express + WS) / browser peer | `ws`               | `agent-transport-webrtc-web` | playground stack      |
   | HTTP/WS server | headless `robota --serve` / `apps/agent-server`   | `http` / `ws`      | —                            | RUNTIME-001           |
   | Remote (P2P)   | local host + signaling relay                      | `webrtc` (pairing) | `agent-transport-webrtc-web` | REMOTE-001            |
   | MCP host       | any MCP client                                    | `mcp`              | —                            | —                     |

   Note on declaration forms + fan-out: `tui`/`ws`/`webrtc` declare `readonly name = '…'` on an
   `IConfigurableTransport` class (registry-registrable, `defaultEnabled` present); `http`/`mcp` expose
   `name: '…'` as a factory object-literal implementing plain `ITransportAdapter` (no `defaultEnabled`, mounted
   **outside** `startAll`'s fan-out but still `attach(session)` over the DIP). The scan must parse both forms
   (or read the static manifest — see TC-02).

2. **Deploy guide** in `docs/` — the one-definition→many-channels pattern: resolve a definition
   (`TInteractiveSessionOptions`/preset), `buildRuntimeSession(...)`, `register` the desired transports,
   `startAll(session)`; each surface keeps its own composition root + auth posture.
3. **Runnable example** under `examples/` — serve one resolved definition over ≥2 transports (e.g. WS + HTTP)
   simultaneously against one session.
4. **Reference-identity proof test** — one `buildRuntimeSession` session, ≥2 registered recording-fake
   transports, asserting each transport's captured `attach()` argument is the **same `IInteractiveSession`
   instance** (`t1.attached === t2.attached === session`) — the registry fans one session to every enabled
   transport. (Scoped to the registry seam; not a claim about every surface's composition root — see TC-01.)

**Slices:** P1 (this) = matrix + proof test + deploy guide + example. Follow-ups (not this spec): a `robota
deploy` UX veneer is explicitly deferred (alt 3), only if a discoverability need is demonstrated.

## Affected Files

| File                                                                      | Change                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.agents/specs/deployment-matrix.md` (new)                                | deployment-matrix registry (surface × runtime × transport), mirror `orchestration-map.md`                                                                                                                                                                                                                                         |
| `docs/` deploy guide (new)                                                | user-facing one-definition→many-channels pattern over the registry seam                                                                                                                                                                                                                                                           |
| `examples/` multi-surface program (new)                                   | serve one resolved definition over ≥2 transports (e.g. WS + HTTP) against one session                                                                                                                                                                                                                                             |
| `packages/agent-transport/src/__tests__/` (new test)                      | reference-identity proof: two recording-fake transports both `attach()` the same session instance (TC-01)                                                                                                                                                                                                                         |
| `scripts/harness/scan-deployment-matrix.mjs` (new) + harness registration | matrix drift scan (TC-02): enumerate the transport-`name` set `{tui,ws,webrtc,http,mcp}` — packages EXPORTING an `ITransportAdapter`/`IConfigurableTransport` with a `name` (excludes `-protocol` shared lib AND `-gui`/`-webrtc-web` presentation), OR a static `transport-names.json` manifest — ↔ matrix Transport-`name` rows |
| `.agents/specs/architecture-map/agent-system.md` (edit, if needed)        | cross-link the deployment matrix from the transport ownership section                                                                                                                                                                                                                                                             |
| _(no new package, no new transport, no new dependency edge)_              | enforced by the `deps` scan — see TC-03                                                                                                                                                                                                                                                                                           |

## Completion Criteria

- [ ] TC-01: **one-def-over-≥2-transports reference-identity test** — build ONE `InteractiveSession` from a
      single resolved config via `buildRuntimeSession`; `register(t1); register(t2)` in a `TransportRegistry`
      where `t1`/`t2` are **two recording fakes** (each `defaultEnabled:true`, each captures its `attach()`
      argument into a field, e.g. `this.attached = session`); call `startAll(session)`; then assert the precise
      falsifiable claim **`t1.attached === session && t2.attached === session`** (strict reference identity — the
      _same_ `IInteractiveSession` instance reached every enabled transport, not a copy/clone/per-transport
      rebuild). What this test PROVES: the registry fans **one** session instance out to every enabled transport
      (the load-bearing DIP claim). What it does NOT prove: per-surface composition-root discipline — a single
      `agent-transport` test cannot establish the _absence_ of per-transport branching across all five surfaces'
      composition roots (`cli.ts`, `serve-mode.ts`, the sidecar, `remote-control-controller.ts`); that is the
      matrix's (TC-02) and each surface's own concern, not a claim this unit test makes.
- [ ] TC-02: **deployment-matrix drift scan (mechanical FAIL floor with a named enumerable source)** — the
      matrix enumerates every surface × runtime × transport for cli/desktop/web/HTTP-WS-server/remote/MCP, and a
      `pnpm harness:scan` check asserts **every transport is documented, with no phantom rows**. Unlike the
      `orchestration-map` scan — whose enumerable source is the static file set `.claude/agents/*.md` — transport
      names live at runtime, so there is no equivalent static set to diff against by default. This TC therefore
      names a **concrete enumerable source = the set of packages that EXPORT an object implementing
      `ITransportAdapter`/`IConfigurableTransport` with a `name`** — verified today as exactly
      `{tui, ws, webrtc, http, mcp}`. This EXCLUDES not only `agent-transport-protocol` (shared protocol lib) but
      also **`agent-transport-gui` and `agent-transport-webrtc-web`** — React/browser **presentation** packages that
      export NO `ITransportAdapter` and carry no transport `name` (so a naive "scan `agent-transport-*` excluding
      `-protocol`" would false-FAIL on those two). The scan must parse BOTH `name` declaration forms: class
      `readonly name = '…'` (tui/ws/webrtc) and factory object-literal `name: '…'` (http/mcp). It FAILs if any
      such transport `name` is missing a matrix Transport-`name` row (undocumented) or any matrix Transport-`name`
      row names a nonexistent transport (phantom); the Client/presentation column is out of scope for this floor.
      (Equivalent acceptable alternative, and the cleaner route: adopt a static transport-name manifest — e.g.
      `.agents/specs/transport-names.json` = `["tui","ws","webrtc","http","mcp"]` — as the scan's SSOT, sidestepping
      the two declaration forms entirely; either way the source is a real enumerable set, not a hand-maintained
      assertion.) Mechanical FAIL floor per [enforcement-architecture.md](../../rules/enforcement-architecture.md): every guardian needs
      a mechanical source, not a human re-checking the list.
- [ ] TC-03: **no-new-coupling deps scan** — `pnpm harness:scan` `deps`
      (`scripts/harness/check-dependency-direction.mjs`) stays green: this work introduces **no new bidirectional
      production dependency, no pass-through re-export, and no new transport/gateway package**. Mechanical FAIL
      floor per [enforcement-architecture.md](../../rules/enforcement-architecture.md).
- [ ] TC-04: **runnable example exercised** — the `examples/` multi-surface program serves one definition over
      ≥2 transports and is built/smoke-run in CI (or a bintest), demonstrating the documented pattern end-to-end.

## Test Plan

| TC    | Verification                                                   | Type/Tool                                                  |
| ----- | -------------------------------------------------------------- | ---------------------------------------------------------- |
| TC-01 | `t1.attached === t2.attached === session` (reference identity) | vitest (registry + `buildRuntimeSession`, recording fakes) |
| TC-02 | transport-`name` set `{tui,ws,webrtc,http,mcp}` ↔ matrix rows  | `pnpm harness:scan` (deployment-matrix drift)              |
| TC-03 | no new bidirectional dep / re-export / package                 | `pnpm harness:scan` (`deps`)                               |
| TC-04 | multi-surface example builds + smoke-runs                      | example build / bintest                                    |

## Tasks

`.agents/tasks/SELFHOST-013*.md` — 미생성 (GATE-APPROVAL 통과 후 생성). P1 (this) = deployment matrix + proof
test + deploy guide + runnable example.

## Evidence Log

- 2026-07-17 — **Draft authored.** Grounded in the real transport DIP: `IConfigurableTransport<TSession>`
  ([`agent-interface-transport/src/transport-config.ts`](../../../packages/agent-interface-transport/src/transport-config.ts) /
  [`transport-adapter.ts`](../../../packages/agent-interface-transport/src/transport-adapter.ts)),
  `TransportRegistry.startAll(session)`
  ([`agent-transport/src/transport-registry.ts`](../../../packages/agent-transport/src/transport-registry.ts)),
  the single construction seam `buildRuntimeSession` / `startRuntimeHost`
  ([`agent-framework/src/runtime/runtime-host.ts`](../../../packages/agent-framework/src/runtime/runtime-host.ts)),
  and the five live surfaces sharing it — `createDefaultTransportRegistry`/`WsTransport`
  ([`agent-cli/src/cli.ts`](../../../packages/agent-cli/src/cli.ts)), headless `--serve` (RUNTIME-001,
  [`serve-mode.ts`](../../../packages/agent-cli/src/modes/serve-mode.ts)), the desktop sidecar (GUI-002,
  [`apps/agent-app/electron/sidecar.ts`](../../../apps/agent-app/electron/sidecar.ts)), and the pairing-gated
  `WebRtcTransport` into the same registry (REMOTE-001,
  [`remote-control-controller.ts`](../../../packages/agent-cli/src/remote-control/remote-control-controller.ts)).
  Scoped strictly to docs/packaging + a proof test + optional convention-level glue; no new transport, package,
  or sibling edge (fenced by the `deps` scan, TC-03). **GATE-APPROVAL pending** (independent proposal-reviewer).
- 2026-07-17 — **RE-REVIEW → REVISE (iteration 1, applied).** Direction (documentation + packaging over the
  existing transport DIP; gateway-sibling and `robota deploy` shapes rejected; no new coupling) confirmed
  CORRECT; the completion criteria were tightened per the punch-list:
  - **TC-01** — replaced the imprecise "byte-identical" wording with a falsifiable **reference-identity**
    assertion: two recording fakes capture their `attach()` argument and the test asserts
    `t1.attached === t2.attached === session` (the same `IInteractiveSession` instance reaches every enabled
    transport). Scoped explicitly: it PROVES the registry shares one session instance; it does NOT prove
    per-surface composition-root discipline (a single `agent-transport` test cannot show absence of branching
    across all surfaces' composition roots).
  - **TC-02** — gave the matrix-drift scan a **concrete enumerable source** so it is a real mechanical floor,
    not a hand-maintained assertion (transport names live at runtime, so there is no `.claude/agents/*.md`-style
    static set the `orchestration-map` scan relies on): scan the `packages/agent-transport-*` set EXCLUDING
    `agent-transport-protocol` (not a transport) and require each transport's `name` to appear as a matrix row
    (or read a static transport-name manifest); added `scripts/harness/scan-deployment-matrix.mjs` to Affected
    Files and made TC-02 a `harness:scan` FAIL floor.
  - **Framing precision** — Prior Art + Affected Scope now state the pairing-gated `WebRtcTransport` is
    `defaultEnabled:false` and started **out-of-band** (`void transport.start()`, attached to the same session
    but NOT picked up by `startAll`), and cite **REMOTE-001** (default `WsTransport` + pairing-time
    `WebRtcTransport`, both `attach(session)` on the same instance) as the concrete live SIMULTANEOUS
    two-transport / one-session prior art for TC-01/TC-04 — rather than implying all five surfaces exercise the
    fan-out concurrently (the default CLI / `--serve` path runs a single network transport).
  - TC-03 (`deps` scan) and TC-04 (example build / bintest) unchanged — already genuine floors.
- 2026-07-17 — **iteration 2: RE-REVIEW → REVISE, applied.** Re-reviewer confirmed Fixes 1 (TC-01 reference-identity)
  and 3 (WebRTC out-of-band framing + REMOTE-001 citation) code-accurate; Fix 2's enumerable source was FALSE for 2
  of 7 non-protocol packages — `agent-transport-gui` and `agent-transport-webrtc-web` are React/browser PRESENTATION
  layers exporting no `ITransportAdapter`/`name`, so "scan `agent-transport-*` excluding `-protocol`" would false-FAIL
  on them, and the matrix mixed package identity with transport `name`. Fixes applied: (1) TC-02's enumerable source
  redefined to **the set of packages exporting an `ITransportAdapter`/`IConfigurableTransport` with a `name`** =
  `{tui,ws,webrtc,http,mcp}` (excludes `-protocol`, `-gui`, `-webrtc-web`), with a static `transport-names.json`
  manifest offered as the cleaner SSOT; (2) noted both `name` declaration forms (class `readonly name` for
  tui/ws/webrtc; factory object-literal for http/mcp, which are `ITransportAdapter` without `defaultEnabled`, mounted
  outside `startAll`'s fan-out); (3) the matrix now separates a **Transport `name`** column from a
  **Client / presentation** column (`-gui`/`-webrtc-web`/print moved there), so TC-02's "no phantom rows" is
  well-defined against the transport-`name` set only.
- 2026-07-17 — **iteration 3: RE-REVIEW → ENDORSE** (independent proposal-reviewer). Every premise verified against
  the code: `agent-transport-gui` and `agent-transport-webrtc-web` export NO `ITransportAdapter`/transport `name`
  (correctly Client/presentation, not the name floor); `tui`/`ws`/`webrtc` declare `readonly name` on an
  `IConfigurableTransport` class (`defaultEnabled` present); `http`/`mcp` expose `name` via a factory object-literal
  as plain `ITransportAdapter` (no `defaultEnabled`, mounted outside `startAll`'s fan-out) — so the enumerable source
  is correctly the SEMANTIC discriminator (implements the port with a `name` = `{tui,ws,webrtc,http,mcp}`), not a
  string-prefix glob; the matrix's Transport-`name` column union equals that set (no undocumented/phantom); TC-01
  (reference identity at `startAll`), TC-03 (`deps` scan), and TC-04 (example) remain genuine floors. Direction
  intact. **GATE-APPROVAL PASSED.** (Non-blocking: `ws` also has a factory form in addition to its class form — the
  enumerable set is identical either way; the both-forms scan or the manifest covers it.)
