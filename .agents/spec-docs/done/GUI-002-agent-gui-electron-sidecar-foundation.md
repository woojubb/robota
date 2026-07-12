---
status: done
type: INFRA
tags: [desktop, electron, sidecar, gui, react, websocket]
---

# GUI-002: agent-gui — Electron + sidecar foundation (Stage 1 MVP)

> Parent: [GUI-001](../../backlog/completed/) research-first backlog. This is the **foundational
> architecture spec** for `agent-gui` and the **Stage 1 MVP** it authorizes. It records the two
> owner-decided forks (Electron shell; spawn-the-CLI-sidecar hosting) so GATE-APPROVAL reviews the
> decision, then authorizes a first buildable stage. Later stages (per-OS packaging/signing, richer
> co-drive UI, in-process option if ever wanted) are separate specs.
>
> **Fork A revised (2026-07-12):** the shell was flipped **Tauri v2 → Electron** at the owner's direction
> ("Node 생태계를 최대한 활용") after research showed every system-webview shell (Tauri/webview-nodejs/
> electrobun) forces a non-Node toolchain (Rust/Bun) or a native addon — reintroducing exactly what
> INFRA-028/DIST-001 avoid, and Rust does not even build in the current CI. Electron is the only option
> satisfying all-Node + no-native-addon + builds-in-plain-Node-CI + mature signing. Sidecar model (Fork B),
> the required nonce auth, and agent-web-ui reuse are unchanged. Re-endorsed by proposal-review (see
> Evidence Log).

## Problem

`agent-cli` drives a live `IInteractiveSession` through a **thin TUI presentation layer**
(`@robota-sdk/agent-transport-tui`) — a display/interaction surface over the transport-neutral session
contract (`@robota-sdk/agent-interface-transport`). Session logic, command routing, permission/ask
prompts (REMOTE-007), and co-drive attribution (REMOTE-014) all live BELOW the presentation layer; the
TUI is "just another surface".

**Concrete symptom / gap:** there is no graphical surface today — the only way to drive a session is the
terminal TUI (`agent-cli`). A user who wants a windowed desktop app (`agent-gui` in the dock/Start menu,
clickable permission prompts, no terminal) has nothing to run; `apps/` contains no desktop shell and no
`robota`-driven GUI application.

We want **`agent-gui`**: a graphical **desktop application** driven by the SAME session contract, whose
GUI presentation layer mirrors the TUI layer's role and architecture (same seams, the OWNER PRINCIPLE
local == remote). The hard question is not "how do we render a session" — a React surface that renders a
live session over the wire **already exists** (`@robota-sdk/agent-web-ui`: conversation, tools, streaming,
permission/ask, driver-attribution chips) — but **how a desktop app should host the session and which
shell technology to use**, without duplicating session logic or forking the distribution direction.

## Architecture Review

### Affected Scope

Research (GUI-001 phase 1, read-only) established the reusable substrate and the decision space:

- **The TUI presentation-layer contract** (what a GUI surface must satisfy): construct or receive an
  `IInteractiveSession`; subscribe to the 15 `IInteractiveSessionEvents`
  (`user_message`, `text_delta`, `tool_start`/`tool_end`, `thinking`, `complete`, `interrupted`,
  `error`, `context_update`, `compact`, `skill_activation`, `memory_event`,
  `execution_workspace_event`, and the REMOTE-007 trio `permission_request`/`ask_request`/
  `prompt_resolved`) and fold them into a view model; drive via `submit` / `executeCommand` / `abort` /
  `cancelQueue` / `shutdown` / `getFullHistory` / `getContextState` /
  `getExecutionWorkspaceSnapshot`; render + answer permission via `resolvePermission(id,result)` and ask
  via `resolveAsk(id,response)`, dismissing on `prompt_resolved`.
- **`agent-web-ui` already implements ~80–90% of this** as a browser-only React library. Its
  `useSessionClient(makeClient)` reducer is **transport-agnostic** (a pluggable `TMakeSessionClient`
  factory over `{onMessage(TServerMessage), onStatusChange}`); it ships a WS client
  (`createWsSessionClient`, localhost sidecar) and a WebRTC client. `ConversationView`,
  `PermissionPrompt`, `AgentActivityPanel`, `prompt-state` cover REMOTE-007 + REMOTE-014 today.
  Dependencies are browser-clean (no `node:` imports; React + the three transport-contract packages).
- **The session is Node-side** (providers, tools, `node:fs`, `child_process` for subagent worktrees,
  `ws`, `werift`). A pure system-webview (Tauri) cannot host it in-process — but it need not: agent-cli
  already exposes the session as a **loopback WebSocket server** (`WsTransport`, `127.0.0.1:7070`,
  `defaultEnabled:true`), and `agent-web-ui` already targets exactly that (`apps/agent-web` monitor
  connects to `ws://localhost:7070`). The runtime workspace closure was verified pure-JS by INFRA-028
  (no native modules). DIST-001/002/003 _aim_ to produce a single-file Bun-compiled `robota` binary with
  a Node-less install path, but **DIST-001 is a `todo` compatibility spike, not a shipped fact** — it
  explicitly flags `bun --compile` unknowns including the `node` child-spawn the session uses for subagent
  worktrees. So GUI-002 must NOT hard-depend on the Bun binary: it spawns _a_ `robota` executable, with the
  ordinary **Node `robota` entrypoint as the Stage-1 dev-run sidecar**; adopting the Bun single-binary is a
  later optimization gated on DIST-001, not a Stage-1 requirement.
- **The loopback WS is UNAUTHENTICATED today.** `WsTransport` (`defaultEnabled:true`) runs
  `new WebSocketServer({ server })` with no `verifyClient`, no origin check, no token — and on every
  connection immediately emits full history + execution-workspace snapshot, then wires the socket to
  `createWsHandler` (which can `submit`, `executeCommand`, and **answer permission/ask prompts**). Because
  browser `WebSocket` connections are not gated by CORS, **any local process — or any web page open in any
  browser on the machine — can currently reach `ws://127.0.0.1:7070` and fully drive/authorize a running
  session.** That is a pre-existing OWNER-PRINCIPLE hole (permission-answering _is_ the authorization gate),
  independent of the GUI. GUI-002 must therefore treat loopback auth as a REQUIRED gate, not an add-on.

### Alternatives Considered (the two forks)

**Fork A — desktop shell.** The candidates split into two classes: **bundled-Chromium** shells (Electron,
NW.js — all-JS, prebuilt binary, no compiler) and **system-webview** shells (Tauri = Rust; `webview-nodejs`
= C native addon, discontinued; `@webview/webview` = Rust native addon; electrobun = Bun + Zig). Research
established a decisive structural fact: **binding a system webview inherently requires native code, so
"small system-webview bundle" and "all-Node + no-native-addon + builds-in-plain-Node-CI" are mutually
exclusive in this repo.** Every system-webview option reintroduces exactly the native-module / non-Node
toolchain that INFRA-028 (pure-JS closure) and DIST-001 (Bun-compile hostile to native addons) avoid — and
Rust/Bun are both **absent from the current CI** (Tauri literally does not build here). **Owner decision:
Electron.** Rationale: it is the only candidate satisfying ALL hard constraints simultaneously — no new
language/toolchain (prebuilt Chromium+Node; the app compiles nothing), **no native addon** (INFRA-028
invariant preserved), **builds in the current plain Node/pnpm CI**, and mature per-OS packaging + signing
(electron-builder: macOS notarization, Windows Authenticode) for the deferred GUI-003 stage. Between the
two bundled-Chromium options, Electron dominates NW.js on community and signing tooling. Cost accepted:
**~85–150 MB bundled-Chromium shell** (vs the ~5–15 MB a system webview would give) and **the shell itself
is not Bun-compilable** — but because this is a **sidecar** architecture, that misalignment is confined to
the window chrome: the DIST-001 Bun single-binary, if that spike succeeds, still becomes the **sidecar**
Electron spawns, so the Bun/native direction is preserved for the part that carries the actual runtime.
Flipping to Electron also **removes** two costs the Tauri path carried (Rust glue + Linux WebKitGTK QA;
Electron ships uniform Chromium on all three OSes).

**Fork B — session hosting.** Spawn the CLI as a **loopback-WS sidecar** vs host the session
**in-process** in a Node runtime. **Owner decision: sidecar.** Rationale: reuses the entire existing
WS surface (REMOTE-007 permission/ask, REMOTE-014 attribution, OWNER PRINCIPLE) with near-zero new
transport code — it is literally what `apps/agent-web` already does. In-process hosting would couple
`agent-gui` to `agent-framework`/`agent-core` (violating the no-framework-dep invariant), force the session
runtime into the shell process, and directly contradict the Bun single-binary direction — whereas the
sidecar keeps the runtime in a separate, independently-distributable `robota` process.

**Package shape (consequence of A+B).** REUSE `agent-web-ui` as the presentation substrate rather than
fork a new `agent-transport-gui`. A new `apps/agent-gui` owns ONLY the Electron shell + sidecar
lifecycle + loopback wiring (its own product assembly, per the "no shared product factory" rule). Any
GUI-only presentation seam that emerges is added _inside_ `agent-web-ui`, not a parallel package.

### Decision

Build `agent-gui` as a **thin Electron desktop shell** that (1) on launch **spawns a `robota` sidecar**
(the Node entrypoint for Stage 1; the DIST-001 Bun single-binary later, gated on that spike) with the WS
transport enabled on a loopback port and a **required launch-nonce loopback auth**; (2) loads the existing
**`agent-web-ui` React SPA** into a `BrowserWindow` renderer, pointed at `ws://127.0.0.1:<port>`; (3) reuses
`agent-web-ui`'s session reducer + rendering verbatim — **no session/command/permission logic in the GUI**.
The Electron **main process is Node**, so `child_process.spawn('robota', …)` with the port+nonce is native
and matches what `apps/agent-web` already does over loopback WS. The GUI is one more driver surface over the
transport-neutral session; the OWNER PRINCIPLE (local == remote) and co-drive attribution (REMOTE-014)
apply to it unchanged.

**Cross-platform:** the app targets **macOS, Linux, and Windows** — Electron bundles uniform Chromium on all
three (no per-OS webview divergence), and the Stage-1 dev-run works on each. Per-OS installers + code-signing
(macOS notarization, Windows Authenticode; .dmg/.app, .AppImage/.deb/.rpm, .exe/.msi via electron-builder)
are the deferred **GUI-003** stage; the `robota` sidecar likewise targets all three (DIST-001: macOS
arm64/x64, Linux x64/arm64, Windows x64).

**Stage 1 (this spec) delivers the MVP:** a desktop window that starts, spawns + supervises the sidecar,
renders a live session (conversation, streaming, tools), and renders + answers permission/ask prompts —
the core user story. It ships the app in dev/run form; **per-OS packaging + code-signing/notarization is
a later spec (GUI-003)**.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — see **Affected Scope** + **Affected Files** (new `apps/agent-gui`;
      reuse `agent-web-ui`; possible additive nonce option in a transport package; `project-structure.md`).
- [x] Sibling scan 완료 — the "render a live session" surface already exists as a SIBLING (`agent-web-ui`,
      the browser React surface, and `apps/agent-web` which mounts it over loopback WS); this spec REUSES that
      sibling as the presentation substrate rather than forking a new `agent-transport-gui` — `apps/agent-gui`
      adds ONLY the Electron shell + sidecar lifecycle. The TUI sibling (`agent-transport-tui`) is the
      architectural mirror (thin surface over the transport-neutral session), not code to copy. N/A: no new
      shared presentation package is introduced.
- [x] 대안 최소 2개 검토 완료 — two forks each with ≥2 options: shell (bundled-Chromium: Electron/NW.js vs
      system-webview: Tauri/webview-nodejs/electrobun) and hosting (sidecar vs in-process); see
      **Alternatives Considered**.
- [x] 결정 근거 문서화 완료 — see **Decision** (Electron+sidecar; rationale = only all-Node + no-native-addon +
      builds-in-plain-CI + mature signing option; costs = ~100 MB bundled-Chromium shell + shell not
      Bun-compilable, sidecar still can be).

**Design invariants this spec must hold** (checked at implementation + review):

- **Dependency direction:** `apps/agent-gui` → `agent-web-ui` (browser export) + the contract packages;
  never inverts. The GUI does not depend on `agent-framework`/`agent-core` (the sidecar owns the runtime).
- **Frontend rule:** React only (satisfied — reuses `agent-web-ui`). Tailwind-only styling (the shell
  supplies the theme CSS variables the components consume).
- **No shared product factory:** `apps/agent-gui` owns its own composition; reuse comes from the shared
  lower layer (`agent-web-ui`), not a shared assembler.
- **OWNER PRINCIPLE:** the GUI is a driver surface; attribution is display-only, never authorization.
- **No native modules:** runtime closure is pure-JS (INFRA-028). Electron ships a prebuilt Chromium+Node
  (no native addon in the app). The Stage-1 sidecar is the Node `robota` entrypoint; the Bun single-binary
  is a later, DIST-001-gated substitution, not a Stage-1 dependency.
- **All-Node toolchain:** the shell is JS/TS (Electron main + preload + renderer); no Rust/Bun/Go, builds in
  the plain Node/pnpm CI. `contextIsolation` on + a minimal `preload` bridge (no `nodeIntegration` in the
  renderer) so the `agent-web-ui` SPA stays a pure browser surface.
- **Loopback auth is REQUIRED (not optional):** the GUI-spawned sidecar must reject any WS connection that
  does not present the launch nonce, and the check must run **before** any session data is emitted.

## Solution

### Components (Stage 1)

1. **`apps/agent-gui` — Electron project (all JS/TS).**
   - `electron/main.ts` (Node main process): create the `BrowserWindow`; **mint** the loopback port + nonce
     (`node:crypto`); **spawn** the `robota` sidecar via `child_process.spawn` with the port+nonce (env/CLI
     flag); supervise the child (health, graceful `shutdown` on window-close, child-exit → UI fatal state);
     `webPreferences` (`contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`); load the built
     `agent-web-ui` SPA via `loadFile` (local content, never a remote URL). **Renderer hardening (the
     bundled Chromium renderer holds the nonce, so it is itself a "browser on the machine"):** a strict CSP
     pinned to `default-src 'self'` + `connect-src ws://127.0.0.1:<port>` (renderer can only reach its own
     loopback sidecar), plus **navigation lockdown** — `will-navigate` deny + `setWindowOpenHandler(() =>
({action:'deny'}))` so a redirected/compromised renderer cannot carry the nonce/session to an external
     origin. (Recorded in `docs/SPEC.md`.)
   - `electron/preload.ts`: a minimal `contextBridge` exposing ONLY the port + nonce (and a fatal/ready
     signal) to the renderer — no Node APIs leak into the SPA.
   - `src/` (TS/React renderer): a thin entry that mounts `agent-web-ui`'s session view (composing
     `ConversationView` + `AgentActivityPanel` + `PermissionPrompt` against `useWsSession(url)`, the way
     `RemoteClient` composes for RTC — NOT the WS-hardwired `SessionMonitor`), reading the port+nonce from
     the preload bridge, plus a Tailwind theme providing the CSS variables (`--background`, `--card`,
     `--foreground`, `--primary`, …).
2. **Sidecar contract + REQUIRED loopback auth.** The GUI spawns `robota` with the WS transport on a
   chosen loopback port and a **mandatory launch nonce** (a high-entropy secret minted by the shell per
   launch). The nonce is NOT optional and NOT merely "hostile-local-process" defense — as **Affected Scope**
   documents, the loopback WS is unauthenticated today and reachable by any local process _or any browser
   page_, so without the nonce a co-resident web page could answer permission prompts. Contract:
   - **Mint:** the Electron main process generates the nonce (256-bit, `node:crypto`) and a free loopback
     port at launch; passes both to the child (env var / CLI flag) and to the renderer via the `preload`
     `contextBridge` (never a world-readable file).
   - **Sidecar side:** the WS transport gains a **required-token option**; the server **rejects the
     handshake (close, no data) BEFORE** the current unconditional `messages` / `execution_workspace_event`
     send when the presented token is absent or wrong. This is a published-surface change to
     `agent-transport-ws` (and possibly `agent-transport-protocol` / `agent-interface-transport` if the
     token check belongs in the shared handler) — **SPEC-first** for the touched package.
   - **Browser transport of the token:** the native `WebSocket` API **cannot set request headers**, so the
     nonce travels via **query param or `Sec-WebSocket-Protocol` subprotocol**; `createWsSessionClient` /
     `useWsSession(url)` are extended (additively) to carry it. The server validates it in the upgrade/first
     frame before any emit.
   - **Pre-existing exposure decision:** GUI-002 closes the hole **for its own sidecar** by requiring the
     token (the GUI never spawns an unauthenticated WS). The **default `defaultEnabled:true` TUI/localhost
     path stays as-is under this spec** and is handed to a **companion SECURITY backlog** (loopback WS auth
     for the default path) rather than silently changed here — a stated decision, not omission.
3. **Lifecycle.** Spawn on app ready → wait for WS readiness → connect the webview. On window close /
   app quit → graceful sidecar shutdown (session `shutdown`), then process kill as a backstop. A sidecar
   crash surfaces a reconnect/fatal state in the UI (reuse the existing `status` surface).

### What Stage 1 explicitly defers

- Per-OS bundling, code-signing, notarization, auto-update → **GUI-003**.
- A `pendingCount` / prompt-queue affordance and richer co-drive UI → later (small; `agent-web-ui` gap).
- Any in-process hosting path → out of scope (owner chose sidecar; would be a distinct spec).
- Multi-session / tabs, settings UI beyond what the session already exposes.

## Affected Files

**New — `apps/agent-gui/`:**

- `package.json` (private app; deps: `@robota-sdk/agent-web-ui`, React, Tailwind; devDeps: `electron`,
  `electron-builder`, `vite`). NO `agent-framework`/`agent-core`.
- `electron/main.ts` (spawn/supervise sidecar, port+nonce, CSP, BrowserWindow), `electron/preload.ts`
  (contextBridge: port+nonce+ready/fatal), `electron/tsconfig.json`.
- `src/main.tsx`, `src/App.tsx` (mount agent-web-ui session view), `src/theme.css` (Tailwind tokens),
  `index.html`, `vite.config.ts` (renderer build), `tsconfig.json`.
- `electron-builder.yml` (per-OS targets for GUI-003; present but packaging deferred), `docs/SPEC.md`
  (new app spec; also list the sidecar/nonce contract).

**Changed (small, additive):**

- `agent-web-ui` — only if the composed session view needs a new exported seam (prefer reuse; if a
  GUI-tailored root is needed, add it here, not a new package). Possibly export the compose-your-own
  pieces already public.
- `agent-web-ui` — `createWsSessionClient` / `useWsSession(url)` extended (additively) to carry the launch
  nonce via query param or `Sec-WebSocket-Protocol` subprotocol (browser `WebSocket` can't set headers).
- `agent-transport-ws` (and possibly `agent-transport-protocol` / `agent-interface-transport`) — a
  **required-token option** on the WS transport/handler that rejects the handshake **before** any session
  data is emitted. Published-surface contract change ⇒ **SPEC-first** for the touched package.
- `.agents/project-structure.md` — register `apps/agent-gui` + its dependency edges.
- Root build/release wiring — how `agent-gui` obtains the `robota` sidecar (Stage 1: the Node entrypoint;
  Bun single-binary later, gated on DIST-001).

**New backlog (companion, filed by this spec — not implemented here):**

- A **SECURITY backlog** for authenticating the default `defaultEnabled:true` loopback WS path (the
  pre-existing unauthenticated exposure the reviewer surfaced), so the TUI/`apps/agent-web` localhost path
  is not left open after GUI-002 closes it only for its own sidecar.

## Completion Criteria

- [x] **TC-01** — Observable: launching `apps/agent-gui` (dev run) opens a desktop window that spawns the
      `robota` sidecar and connects the webview over loopback WS; submitting a user turn shows a streaming
      assistant reply and tool cards in the GUI.
- [x] **TC-02** — Observable: a gated tool call renders a permission prompt in the GUI; clicking Allow/Deny
      answers it via `resolvePermission`, and an ask prompt renders + answers via `resolveAsk`; a
      `prompt_resolved` event dismisses an open prompt.
- [x] **TC-03** — Observable: a WS connection presenting a missing/wrong launch nonce is rejected by the
      sidecar **before any session data (`messages` / `execution_workspace_event`) is emitted** (the reject
      happens at the handshake/first-frame, not after the snapshot dump); a connection presenting the
      correct nonce — carried via query param or `Sec-WebSocket-Protocol` subprotocol — is accepted.
- [x] **TC-04** — Observable: closing the window shuts the session down gracefully (session `shutdown`
      called), and a killed/crashed sidecar surfaces a non-hanging fatal/reconnect state in the UI status.
- [x] **TC-05** — Observable: `apps/agent-gui` declares no dependency on `agent-framework`/`agent-core`;
      the GUI adds no session/command/permission logic (dependency-direction check + review).
- [x] **TC-06** — Command: `pnpm --filter @robota-sdk/agent-gui typecheck` and the affected `pnpm test`
      pass; `pnpm harness:scan` is green (incl. the new app SPEC doc/structure scans); `.agents/project-structure.md`
      lists `apps/agent-gui` and its dependency edges.

## Test Plan

| TC-N  | Test type            | Tool / approach                                                                                                                                                                                                                                                                                |
| ----- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Unit + headless e2e  | Unit: `src/__tests__/session-surface.test.tsx` mounts the compose-root over a stub state + renders folded events. E2E: `e2e/run-e2e.mjs` (Playwright `_electron` + xvfb) launches the REAL app against the real-`WsTransport` scripted sidecar — asserts connect-with-nonce + streaming reply. |
| TC-02 | Unit                 | Prompt render + answer against a mock session surface: Allow/Deny → `resolvePermission`, ask option → `resolveAsk`, `prompt_resolved` → dismiss (reuses `agent-web-ui` prompt-state coverage; GUI compose-root wiring test).                                                                   |
| TC-03 | Unit                 | Launch-nonce loopback auth: the WS client presents the token; the WS handler/transport accepts the correct nonce and rejects a missing/wrong one (test lives in the touched transport package if the option lands there).                                                                      |
| TC-04 | Unit + headless e2e  | Unit: `electron/__tests__/sidecar.test.ts` — spawn args (token in env), child-exit → fatal, shutdown SIGTERM→SIGKILL, idempotent. E2E: `e2e/run-e2e.mjs` asserts the app closes cleanly (sidecar SIGTERM shutdown, no orphan). (All JS/TS — no Rust.)                                          |
| TC-05 | Static / review      | Dependency-direction assertion (`apps/agent-gui` package.json has no `agent-framework`/`agent-core` dep) + harness `deps` scan + code review that no session/command/permission logic was added.                                                                                               |
| TC-06 | Command (CI/harness) | `pnpm --filter @robota-sdk/agent-gui typecheck`, affected `pnpm test`, `pnpm harness:scan` all green; `.agents/project-structure.md` updated and passing the structure scan.                                                                                                                   |

## Tasks

Task file (archived on GATE-COMPLETE): [`.agents/tasks/completed/GUI-002.md`](../../tasks/completed/GUI-002.md)
(execution checklist T1–T10, one task per TC-N, with the mirrored Test Plan).

- [ ] T1: GATE-APPROVAL — proposal-reviewer ENDORSE of this architecture (the two forks + Stage-1 scope).
- [ ] T2: Scaffold `apps/agent-gui` (Electron + Vite + React, all JS/TS); register in `.agents/project-structure.md`.
- [ ] T3: Electron main + preload (TS) — mint port+nonce (`node:crypto`); `child_process.spawn` the Node
      `robota` sidecar + supervise; `contextIsolation`/`sandbox` + CSP; contextBridge port/nonce to renderer;
      fatal-error surface.
- [ ] T4: TS compose-root — mount `agent-web-ui` session view (ConversationView + AgentActivityPanel +
      PermissionPrompt) against `useWsSession(loopbackUrl)`; Tailwind theme tokens.
- [ ] T5: **Required** launch-nonce loopback auth — SPEC-first update to the touched transport package,
      then: mint in shell → child + webview → WS client carries the token via query param /
      `Sec-WebSocket-Protocol` subprotocol → handler **rejects before any session data is emitted**.
      Extend `createWsSessionClient`/`useWsSession` additively (TC-03).
- [ ] T6: File the **companion SECURITY backlog** (auth for the default `defaultEnabled:true` loopback WS
      path) via backlog-writer — before/alongside implementation, so the pre-existing exposure is tracked.
- [ ] T7: `apps/agent-gui/docs/SPEC.md` (+ sidecar/nonce contract + User Execution scenario); harness
      doc/structure scans green.
- [ ] T8: Tests (Test Plan) + `pnpm typecheck`/affected tests/`harness:scan` green; feature→develop→main
      via merge-verifier at each hop.
- [ ] T9: GATE-COMPLETE — spec active→done; open follow-up backlogs (GUI-003 packaging/signing;
      pendingCount UI; Bun-binary sidecar swap gated on DIST-001).

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-07-12

**Status remains:** draft
**Failed criteria:**

- Frontmatter `type:`: found `ARCHITECTURE`; required exactly one of the 11-prefix list (SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT · INFRA · PERF · SECURITY · OBSERVABILITY). `ARCHITECTURE` is not a valid type value.
  **Required action:** Change `type:` to a valid prefix value (e.g. `INFRA` for a foundation/shell spec).
- Completion Criteria — TC-N prefixes: found 6 plain bullet items with no `TC-N` prefix; required every item prefixed `TC-01`, `TC-02`, … Items without a TC-N prefix = FAIL.
  **Required action:** Rewrite each completion criterion as a `TC-N`-prefixed, command-form or observable-behavior item.
- Test Plan — one row per TC-N: found a 4-item bullet list; required one row per `TC-N` in Completion Criteria with the count matching. No TC-N exist, so no rows can match.
  **Required action:** Convert the Test Plan to a table with one row per TC-N (Test Type + Tool/Approach + Notes), matching the Completion Criteria count.
- Evidence Log empty (first GATE-WRITE run): found a pre-existing 2026-07-12 research note; required empty on first run.
  **Required action:** Move the research note into the Problem/Architecture Review narrative; keep Evidence Log for gate entries only.

Additional observation (not the gating failure): the `## Problem` section frames a design question ("how a desktop app should host the session") rather than a concrete failing symptom + reproduction condition; consider stating the symptom form the GATE-WRITE Problem criteria expect. Frontmatter `status: draft` and `tags:` are present and valid; Tasks section is present with a placeholder; no `## Status`/`## Classification` body sections. The `type` / TC-N / Test-Plan failures block the draft → review-ready upgrade.

### [GATE-WRITE] — ❌ FAIL | 2026-07-12

**Status remains:** draft

Prior-FAIL items now resolved (verified): `type:` is `INFRA` (valid 11-prefix value); Completion Criteria are `TC-01`..`TC-06`, each in Observable/Command form with no banned phrases; Test Plan is a table with exactly 6 rows (one per TC-N), each with a non-empty Test type + Tool/approach; the earlier research note is gone from the Evidence Log; the `## Problem` section now states a concrete symptom ("there is no graphical surface today … `apps/` contains no desktop shell") plus a reproduction condition ("a user who wants a windowed desktop app … has nothing to run"), no TBD/TODO. Frontmatter block present with `status: draft` and `tags:`; Tasks section present with placeholders; no `## Status`/`## Classification` body sections; Alternatives Considered has 2 entries (Tauri v2 vs Electron; sidecar vs in-process) each with pro/con; Decision references the driving trade-offs. The pre-existing FAIL entry is a legitimate historical record (this is a re-run, so a non-empty Evidence Log is expected).

**Failed criteria:**

- Architecture Review Checklist — "All 4 checklist items are `[x]`": found a `### Architecture Review Checklist` section containing 5 bold-labeled design-invariant bullets (Dependency direction, Frontend rule, No shared product factory, OWNER PRINCIPLE, No native modules), NONE of which are `[x]` checkbox items. Required: the canonical 4-item checklist all marked `[x]` (affected packages + layers listed; Sibling scan; ≥2 alternatives reviewed; decision rationale documented), per the passing-spec form.
  **Required action:** Replace/augment the section with the 4 canonical `[x]` checklist items (all checked), keeping the current design-invariant bullets as supporting prose if desired.
- Architecture Review Checklist — "Sibling scan item is `[x]` with completion evidence or explicit `N/A: <reason>`": no Sibling scan checklist item exists anywhere in the document. (Sibling context — the `agent-transport-tui` presentation layer and `apps/agent-web` loopback client — is discussed in the Affected Scope narrative, but not captured as the required `[x]` item.)
  **Required action:** Add a `[x] Sibling scan …` checklist item with the completion evidence (the existing TUI/agent-web narrative can be cited) or an explicit `N/A: <reason>`.

### [GATE-WRITE] — ✅ PASS | 2026-07-12

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: INFRA` (valid 11-prefix value); `tags:` present (`[desktop, tauri, sidecar, gui, react, websocket]`). PASS.
- Problem: concrete symptom ("there is no graphical surface today … `apps/` contains no desktop shell and no `robota`-driven GUI application") + reproduction condition ("A user who wants a windowed desktop app … has nothing to run"); no TBD/TODO/vague single-sentence. PASS.
- Architecture Review Checklist: the prior FAIL is resolved — the section now carries the canonical 4 items ALL `[x]` (영향 패키지/레이어 목록; Sibling scan; 대안 최소 2개; 결정 근거). Sibling scan is `[x]` with completion evidence (`agent-web-ui` + `apps/agent-web` loopback client cited as the reused sibling) plus an explicit `N/A: no new shared presentation package is introduced`. The former design-invariant bullets are preserved below as a separate "Design invariants this spec must hold" note (not part of the checklist). PASS.
- Alternatives Considered: 2 forks, each with ≥2 options and pro/con — shell (Tauri v2 vs Electron: bundle size / Node-in-webview / native-dep trade-offs) and hosting (sidecar vs in-process). Decision references the driving trade-offs (DIST-alignment + zero session-logic duplication + smallest bundle; costs = Rust glue + Linux WebKitGTK QA + loopback-nonce surface). PASS.
- Completion Criteria: TC-01..TC-06, each Observable- or Command-form; no banned phrases ("works correctly"/"no errors"/"implemented"/"displays correctly"); ≥1 criterion per distinct feature. PASS.
- Test Plan: `## Test Plan` table present with exactly 6 rows (TC-01..TC-06) — count matches the 6 Completion Criteria; each row has a non-empty Test type + Tool/approach; TC-01's manual portion carries an inline explanation (dev-run launch drives a real session, recorded in the app SPEC User Execution scenario). PASS.
- Structure: Tasks section present with placeholders (T1–T8); Evidence Log present (two prior FAIL entries are legitimate historical records — non-empty is expected on a re-run); no `## Status`/`## Classification` body sections. PASS.
- TC-N count check: Completion Criteria = 6 (TC-01..TC-06); Test Plan rows = 6 (TC-01..TC-06). Match confirmed.

### [proposal-review] — 🔧 REVISE (round 1) → revisions applied | 2026-07-12

Independent proposal-reviewer (read-only, premises tested against code) endorsed the DIRECTION (Tauri v2
shell + spawn-CLI-loopback-WS-sidecar + reuse `agent-web-ui` verbatim; no superior fork) but returned
REVISE on two load-bearing corrections. Both applied to the spec:

1. **Loopback auth promoted from optional → REQUIRED, fully specified.** The reviewer verified the loopback
   WS is UNAUTHENTICATED today (`WsTransport`, `defaultEnabled:true`, no `verifyClient`/origin/token; dumps
   history + workspace on connect) and reachable by any local process OR any browser page — a pre-existing
   OWNER-PRINCIPLE hole. Spec now: nonce is mandatory for the GUI sidecar; **reject before any session data
   is emitted**; token carried via query param / `Sec-WebSocket-Protocol` subprotocol (native `WebSocket`
   can't set headers); `createWsSessionClient`/`useWsSession` extended additively; SPEC-first on the touched
   transport package; and an explicit decision to **file a companion SECURITY backlog** for the default
   `defaultEnabled:true` path rather than change it silently. TC-03 strengthened to assert reject-before-emit.
2. **DIST-001 Bun-binary premise corrected from settled fact → unproven dependency.** DIST-001 is a `todo`
   compat spike (flags the `node` subagent child-spawn). Spec now spawns the **Node `robota` entrypoint** as
   the Stage-1 sidecar; the Bun single-binary is a later DIST-001-gated swap; dropped "Node-less for free".

Rule-alignment in the review: React-only ✓, dependency direction ✓ (no inversion; the additive nonce edge
is a downward transport-contract change), no-shared-product-factory ✓, no native modules ✓.

### [proposal-review] — 🔧 REVISE (round 2) → single leftover fixed | 2026-07-12

Round-2 confirmed correction #1 (nonce) fully addressed and consistent across Decision/Solution/Affected
Files/TC-03, and correction #2 applied in Affected Scope + Decision + invariants — but caught ONE mechanical
leftover: the **Fork A rationale** still asserted "it ships the _exact_ DIST-001 Bun binary as its sidecar
… the Node-less install story extends for free" (the phrase round 1 said to drop), contradicting the
corrected Decision. Fixed (prose-only): the Fork A rationale now grounds Tauri on system-webview fit +
smallest bundle + no native-dep handling, frames the Bun binary as a later DIST-001-gated _option_ ("if that
spike succeeds"), and states Stage 1 spawns the Node entrypoint. The reviewer pre-authorized ENDORSE
conditional on exactly this edit ("Fix lines 80-84 as above … and this is an ENDORSE"). Round-3 confirmation
requested to record the clean verdict.

### [proposal-review] — ✅ ENDORSE (round 3) | 2026-07-12

Independent proposal-reviewer confirmed the sole round-2 blocker resolved: the Fork A rationale no longer
asserts the Bun binary as fact or claims Node-less-for-free; it is grounded on system-webview fit + smallest
bundle + no native-dep handling, with the Bun single-binary demoted to a DIST-001-gated future option; all
four locations (Fork A / Decision / Affected Scope / invariants) tell the same story; no new inconsistency.
Tauri v2 + sidecar + reuse-`agent-web-ui` endorsed on design-correctness grounds. **The design gate is
satisfied; GATE-APPROVAL now requires the owner's explicit authorization to implement.**

### [GATE-APPROVAL] — ✅ PASS | 2026-07-12

**Status upgrade:** review-ready → approved

- Explicit owner approval directed at this spec, in the current conversation, via the GATE-APPROVAL
  question "authorize implementation of the agent-gui Stage 1 MVP as specified (Tauri v2 shell + Node robota
  sidecar + reuse agent-web-ui + required loopback-nonce auth + companion security backlog)?" — owner
  answered verbatim: **"Approve — build Stage 1 MVP"**. Unambiguous confirmation of the design + authorization
  to implement.
- No Architecture Review or frontmatter `type`/`tags` modified after approval.
- No implementation (file edits / commits) was started before this gate — the three prior review rounds and
  all edits were to the spec document only.

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-07-12

**Status remains:** approved

Prior-gate precondition met: GATE-APPROVAL shows `✅ PASS | 2026-07-12` in this Evidence Log; frontmatter `status: approved` and the `todo/` folder match the expected input stage for GATE-IMPLEMENT.

Criteria checked:

- `.agents/tasks/GUI-002.md` created — PASS (file exists with T1–T10 + a `## Test Plan` section).
- Tasks correspond to Completion Criteria (≥1 task per TC-N) — PASS. Task file maps every TC: T2→TC-01, T3→TC-01/TC-04, T4→TC-01/TC-02, T5→TC-03, T7→TC-06, T8→TC-01..TC-06, T9→TC-05. TC-01..TC-06 all covered.
- Task file `## Test Plan` (≥50 chars) — PASS. `.agents/tasks/GUI-002.md` has a `## Test Plan` section (mirrors the spec's TC-01..TC-06, well over 50 chars). [AF-24]

**Failed criteria:**

- Tasks file path recorded in the `## Tasks` section of the spec: the spec's `## Tasks` section (T1–T9) lists tasks inline but contains no reference to the task file path `.agents/tasks/GUI-002.md`; required — the `## Tasks` section must record the tasks file path so the spec points to its execution tracker.
  **Required action:** Add the task-file path (`.agents/tasks/GUI-002.md`) to the spec's `## Tasks` section (e.g. a `Tasks tracked in .agents/tasks/GUI-002.md` line), then re-run GATE-IMPLEMENT.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-12

**Status upgrade:** approved → in-progress

Prior-gate precondition met: GATE-APPROVAL shows `✅ PASS | 2026-07-12` in this Evidence Log; frontmatter `status: approved` and the `todo/` folder match the expected input stage for GATE-IMPLEMENT.

- `.agents/tasks/GUI-002.md` created — PASS. File exists with tasks T1–T10 and a `## Test Plan` section.
- Tasks file path recorded in the spec `## Tasks` section — PASS (prior FAIL resolved). The `## Tasks` section now opens with ``Task file: [`.agents/tasks/GUI-002.md`](../../tasks/GUI-002.md)`` (spec line 255), so the spec points to its execution tracker.
- Tasks correspond to Completion Criteria (≥1 task per TC-N) — PASS. Task-file mapping covers all six: T2→TC-01, T3→TC-01/TC-04, T4→TC-01/TC-02, T5→TC-03, T7→TC-06, T9→TC-05, T8→TC-01..TC-06. TC-01..TC-06 all covered.
- Task file `## Test Plan` (≥50 chars) — PASS. `.agents/tasks/GUI-002.md` has a `## Test Plan` section mirroring the spec's TC-01..TC-06, well over 50 chars. [AF-24]

### [Fork A revision] — Tauri v2 → Electron + owner re-approval | 2026-07-12

During implementation prep, the environment was found to have **no Rust toolchain** (`cargo`/`rustc` absent),
so the GATE-APPROVED Tauri shell could not be compiled or run here. The owner challenged the shell choice on a
sound principle — "우리는 node.js로 만든 환경이 다 갖춰져 있는데 … 생태계도 nodejs로 선택해야 하는거 아닌가?"
(maximize the already-provisioned Node ecosystem). Follow-up research (read-only) established that **every
system-webview shell forces a non-Node toolchain or a native addon** (Tauri = Rust; `webview-nodejs` = C
addon, discontinued; `@webview/webview` = Rust addon; electrobun = Bun+Zig, Bun absent) — reintroducing
exactly what INFRA-028 (pure-JS closure) and DIST-001 (Bun-compile hostile to native addons) avoid — so
"small system-webview bundle" and "all-Node + no-native-addon + builds-in-plain-CI" are **mutually
exclusive**. **Electron** is the only candidate satisfying all hard constraints (all-JS/TS, no native addon,
builds in the current CI, mature per-OS signing, uniform Chromium on macOS/Linux/Windows).

**Fork A revised Tauri v2 → Electron.** Fork B (sidecar), the required nonce auth, agent-web-ui reuse, the
dependency direction, and every TC are UNCHANGED; the spec's `src-tauri/` Rust component became
`electron/main.ts` + `preload.ts` (TS), and two costs (Rust glue + Linux WebKitGTK QA) were removed. Because
this modifies the Architecture Review after the prior GATE-APPROVAL, the owner **re-approved the revised
decision** via a Fork-A-reconsideration question — owner answered verbatim: **"Electron으로 확정 (권장)"** —
and separately confirmed cross-platform support ("Mac, linux, windows 지원 가능하지?" → yes, all three).
Re-endorsement by proposal-review recorded below.

### [proposal-review] — ✅ ENDORSE (Electron revision) | 2026-07-12

Independent proposal-reviewer re-reviewed the delta and ENDORSED. Confirmed: (1) the Electron choice is sound
and internally consistent — every current-decision surface reads Electron; residual Tauri/Rust text is
legitimately historical (Evidence Log) or the expected "why the system-webview/Rust class was rejected"
rationale; (2) Electron satisfies every hard constraint — all-JS/TS (no new language), no native addon in the
app closure (prebuilt Chromium+Node; INFRA-028's pure-JS-_runtime-closure_ concern is met since the runtime
lives in the sidecar), builds in the current Node/pnpm CI, and PRESERVES the unchanged parts (sidecar,
reject-before-emit nonce, agent-web-ui reuse, non-inverting dependency direction). The Node main process
doing `child_process.spawn` of the sidecar is lifecycle/hosting, NOT session/command/permission logic, and
does not tempt an `agent-framework`/`agent-core` import (TC-05 asserts the absence); (3) the sharpest
Electron-specific risk — the bundled-Chromium renderer is itself "a browser on the machine" holding the nonce
— is closed by the nonce + the webPreferences posture (`contextIsolation:true`, `nodeIntegration:false`,
`sandbox:true`, `loadFile` of local content, preload bridge exposing only port+nonce). Two non-blocking
hardening notes folded into the spec: Fork B's stale "(forcing Electron)" parenthetical reworded; and the
"strict CSP" pinned to `default-src 'self'` + `connect-src ws://127.0.0.1:<port>` plus navigation lockdown
(`will-navigate` deny + `setWindowOpenHandler` deny) recorded in Components (to be nailed down in the app
`docs/SPEC.md` at T7). **Design gate satisfied for the Electron revision; implementation authorized (owner
re-approved).**

### [verification] — ✅ all TC-01..TC-06 verified (headless e2e built — GUI smoke is agent-owned) | 2026-07-12

Implementation complete + on main (PR #1129 feature→develop, #1130 develop→main; both merge-verifier PASS).
Per the owner directive ("GUI 검증은 네가 하고, 그게 가능한 테스트 환경까지 구축하라"), the previously-deferred
desktop smoke is now an **agent-run headless automated e2e** — no owner action required:

- **TC-01** — PASS. Unit: `apps/agent-gui/src/__tests__/session-surface.test.tsx` (compose-root renders folded
  state). E2E: `apps/agent-gui/e2e/run-e2e.mjs` (Playwright `_electron` under `xvfb`, Electron `--no-sandbox`)
  launches the REAL built app → asserts "window connects to the token-gated sidecar (nonce accepted
  end-to-end)" + "submit renders a streaming assistant reply". GREEN.
- **TC-02** — PASS. Unit: `session-surface.test.tsx` (Allow → `resolvePermission`). E2E: asserts "a gated tool
  raises a permission prompt" + "Allow answers it and the tool completes". GREEN.
- **TC-03** — PASS. `packages/agent-transport-ws/src/__tests__/ws-transport-auth.test.ts` (5 tests): correct
  token via query param + subprotocol served; missing/wrong token closed 1008 BEFORE any `messages`/
  `execution_workspace_event`; no-token = unchanged open. The e2e additionally proves the GUI presents the
  correct token (its connection is accepted by the real token-gated `WsTransport`).
- **TC-04** — PASS. Unit: `apps/agent-gui/electron/__tests__/sidecar.test.ts` (8 tests: spawn args token-in-env,
  child-exit→fatal, shutdown SIGTERM→SIGKILL, idempotent). E2E: asserts "app closes cleanly (sidecar SIGTERM
  shutdown)". GREEN.
- **TC-05** — PASS. `apps/agent-gui/package.json` has no `agent-framework`/`agent-core` dep (the sidecar owns
  the runtime; the e2e's `agent-transport-ws` is a devDep test fixture only); harness `deps` + capability-placement scans green.
- **TC-06** — PASS. `pnpm --filter @robota-sdk/agent-gui typecheck` + `test` (12) + renderer/electron builds +
  lint clean; `pnpm harness:scan` all 49 pass; `.agents/project-structure.md` lists `apps/agent-gui`.

**Test env built (agent-owned, reproducible):** `xvfb` (headless display) + the downloaded Electron 43 binary
(`--no-sandbox`) + Playwright `_electron` + `e2e/scripted-sidecar.mjs` (real `WsTransport` + scripted session,
deterministic, no LLM/API key). `pnpm --filter @robota-sdk/agent-gui test:e2e` → **E2E PASSED (5/5)**.
Follow-up (not blocking): wire `test:e2e` into a CI job (needs xvfb + electron-binary + playwright provisioning).

### [GATE-VERIFY] — ❌ FAIL | 2026-07-12

**Status remains:** in-progress

Prior-gate precondition met: GATE-IMPLEMENT shows `✅ PASS | 2026-07-12` in this Evidence Log; frontmatter
`status: in-progress` and the `active/` folder match the expected input stage for GATE-VERIFY.

Criteria checked:

- Build passes for affected packages — PASS (per record). The `[verification]` entry records renderer +
  electron builds clean and `pnpm --filter @robota-sdk/agent-gui typecheck` green.
- Tests pass for affected packages — PASS (per record). The `[verification]` entry records agent-gui `test`
  (12) + `agent-transport-ws` ws-transport-auth (5) + e2e (5/5) green, and `pnpm harness:scan` all 49 pass.

**Failed criteria:**

- "All tasks in `.agents/tasks/GUI-002.md` are marked complete (`[x]`)" / "No tasks are blocked or pending":
  T8 (`Tests per Test Plan; pnpm typecheck + affected pnpm test + pnpm harness:scan green;
feature→develop→main via merge-verifier at each hop`) is still `[ ]` in the tasks file, even though the
  `[verification]` Evidence entry records its substance as complete and merged (PR #1129 → develop, #1130 →
  main, both merge-verifier PASS; tests + harness:scan green). The tracker therefore contradicts the recorded
  evidence. (T10 = GATE-COMPLETE is a later-gate milestone task and is legitimately not-yet-checked at
  GATE-VERIFY; it is not the blocker.)
  **Required action:** Reconcile the tasks file — mark T8 `[x]` (its completion is already evidenced) so the
  execution tracker reflects reality, then re-run GATE-VERIFY.

### [GATE-VERIFY] — ✅ PASS | 2026-07-12

**Status upgrade:** in-progress → verifying

Prior-gate precondition met: GATE-IMPLEMENT shows `✅ PASS | 2026-07-12` in this Evidence Log; frontmatter
`status: in-progress` and the `active/` folder match the expected input stage for GATE-VERIFY.

Criteria checked:

- "All tasks in `.agents/tasks/GUI-002.md` are marked complete (`[x]`)" — PASS. The prior FAIL blocker is
  resolved: T8 (`Tests per Test Plan; pnpm typecheck + affected pnpm test + pnpm harness:scan green;
feature→develop→main via merge-verifier at each hop`) is now `[x]`. T1–T9 are all `[x]`.
- "No tasks are blocked or pending" — PASS. The only remaining unchecked item is T10 (`GATE-COMPLETE — spec
active→done; open follow-up backlogs`), the terminal GATE-COMPLETE milestone task. Per the pipeline state
  machine it transitions verifying→done at its OWN next gate and cannot be checked before that gate runs; it
  is treated as not-yet-applicable for GATE-VERIFY (consistent with the prior GATE-VERIFY FAIL entry, which
  explicitly recorded T10 as "a later-gate milestone task … legitimately not-yet-checked at GATE-VERIFY; it
  is not the blocker"). No task is blocked.
- Build passes for affected packages — PASS (per record). The `[verification]` entry records renderer +
  electron builds clean and `pnpm --filter @robota-sdk/agent-gui typecheck` green.
- Tests pass for affected packages — PASS (per record). The `[verification]` entry records agent-gui `test`
  (12) + `agent-transport-ws` `ws-transport-auth.test.ts` (5) + headless Playwright/xvfb e2e (5/5) green, and
  `pnpm harness:scan` all 49 pass. All six Completion Criteria TC-01..TC-06 are `[x]` with per-TC Test Plan
  references and a per-TC Evidence Log entry.

All GATE-VERIFY criteria met. File stays in `active/`; frontmatter `status` advanced to `verifying`.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-07-12

Checkbox `[x]`. Verification: unit `apps/agent-gui/src/__tests__/session-surface.test.tsx` (compose-root
renders folded state) + headless e2e `apps/agent-gui/e2e/run-e2e.mjs` (Playwright `_electron` under `xvfb`,
Electron 43 `--no-sandbox`) launched the REAL built app → asserted window connects to the token-gated
sidecar (nonce accepted end-to-end) + submit renders a streaming assistant reply. E2E PASSED 5/5.
Test reference: `session-surface.test.tsx` + `e2e/run-e2e.mjs` (Test Plan TC-01 row).

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-07-12

Checkbox `[x]`. Verification: unit `session-surface.test.tsx` (Allow → `resolvePermission`) + e2e asserted a
gated tool raises a permission prompt and Allow answers it so the tool completes. GREEN.
Test reference: `apps/agent-gui/src/__tests__/session-surface.test.tsx` + `e2e/run-e2e.mjs` (Test Plan TC-02 row).

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-07-12

Checkbox `[x]`. Verification: `packages/agent-transport-ws/src/__tests__/ws-transport-auth.test.ts` (5 tests) —
correct token via query param + subprotocol served; missing/wrong token closed 1008 BEFORE any `messages` /
`execution_workspace_event` emit; no-token path unchanged. The e2e additionally proves the GUI presents the
correct token (accepted by the real token-gated `WsTransport`). GREEN.
Test reference: `packages/agent-transport-ws/src/__tests__/ws-transport-auth.test.ts` (Test Plan TC-03 row).

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-07-12

Checkbox `[x]`. Verification: unit `apps/agent-gui/electron/__tests__/sidecar.test.ts` (8 tests: spawn args
token-in-env, child-exit→fatal, shutdown SIGTERM→SIGKILL, idempotent) + e2e asserted the app closes cleanly
(sidecar SIGTERM shutdown, no orphan). GREEN.
Test reference: `apps/agent-gui/electron/__tests__/sidecar.test.ts` + `e2e/run-e2e.mjs` (Test Plan TC-04 row).

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-07-12

Checkbox `[x]`. Verification: `apps/agent-gui/package.json` declares no `agent-framework`/`agent-core` dep (the
sidecar owns the runtime; `agent-transport-ws` is a devDep test fixture only); harness `deps` +
capability-placement scans green; review confirmed no session/command/permission logic added.
Test reference: dependency-direction assertion + harness `deps` scan (Test Plan TC-05 row).

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-07-12

Checkbox `[x]`. Verification (command): `pnpm --filter @robota-sdk/agent-gui typecheck` + `test` (12) +
renderer/electron builds + lint clean; `pnpm harness:scan` all 49 pass; `.agents/project-structure.md` lists
`apps/agent-gui` and its dependency edges.
Test reference: command form — typecheck + affected test + `harness:scan` (Test Plan TC-06 row).

### [GATE-COMPLETE] — ✅ PASS | 2026-07-12

**Status upgrade:** verifying → done

Prior-gate precondition met: GATE-VERIFY shows `✅ PASS | 2026-07-12` in this Evidence Log; frontmatter
`status: verifying` and the `active/` folder match the expected input stage for GATE-COMPLETE.

- Every TC-N in `## Completion Criteria` is `[x]` (TC-01..TC-06) and each has a matching
  `[GATE-COMPLETE: TC-N]` Evidence entry above recording the verification command/action, the observed
  result, and the test reference (real headless Playwright/xvfb e2e PASSED 5/5 + unit suites +
  `ws-transport-auth` 5 tests).
- Every TC-N in `## Test Plan` carries a test reference: TC-01 `session-surface.test.tsx` + `e2e/run-e2e.mjs`;
  TC-02 `session-surface.test.tsx` + e2e; TC-03 `ws-transport-auth.test.ts`; TC-04 `sidecar.test.ts` + e2e;
  TC-05 dependency-direction assertion + harness `deps` scan; TC-06 typecheck + test + `harness:scan`. No TC-N
  silently unaddressed.
- `## Completion Criteria` checkboxes all `[x]`; `## Test Plan` rows all reference tests.
- Tasks file archived to `.agents/tasks/completed/GUI-002.md`; T10 marked `[x]`; the spec `## Tasks` section
  updated to point at the archived path.

All GATE-COMPLETE criteria met. Frontmatter `status` advanced to `done`; spec moved `active/` → `done/`.
