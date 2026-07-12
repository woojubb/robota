# SPEC.md — @robota-sdk/agent-app

## Scope

`agent-app` is a thin **Electron** desktop application (macOS / Linux / Windows) that drives a live
`robota` session graphically. It is a **presentation surface only** — the mirror of the TUI
(`agent-transport-tui`): it owns the desktop shell (window, lifecycle) and the loopback wiring, and reuses
`@robota-sdk/agent-transport-gui`'s React session view + reducer verbatim. All session/command/permission logic
lives **below the wire**, in a `robota` sidecar process reached over a loopback WebSocket (GUI-002).

## Boundaries

- **Does NOT own session logic.** No agent runtime, tools, providers, command routing, or permission
  policy — those run in the spawned `robota` sidecar and are reached over WS (`agent-transport-gui`'s reducer folds
  the `TServerMessage` stream). The GUI never imports `@robota-sdk/agent-framework` or `agent-core`.
- **Does NOT own the wire protocol or the session contract** — those belong to
  `agent-transport-protocol` / `agent-interface-transport`, consumed transitively via `agent-transport-gui`.
- **Does NOT own packaging/signing** in Stage 1 — per-OS installers, code-signing, notarization, and
  auto-update are deferred to **GUI-003** (`electron-builder`).

## Architecture Overview

Two processes, one wire:

```
Electron main (Node)                         robota sidecar (Node CLI)
  ├─ mint free loopback port + 256-bit nonce   ├─ WsTransport binds 127.0.0.1:<port>
  ├─ spawn `robota` with                        │    with token=<nonce> (GUI-002 T5)
  │    env ROBOTA_WS_TOKEN / ROBOTA_WS_PORT ───▶ │    → rejects any connection lacking the
  ├─ BrowserWindow (contextIsolation, sandbox)   │      nonce BEFORE emitting session data
  │    preload contextBridge → { endpoint }       │
  └─ supervise child (exit → fatal; close → SIGTERM→SIGKILL)
        │
        ▼ (renderer, Chromium)
   agent-transport-gui React presentation core
     useWsSession('ws://127.0.0.1:<port>?token=<nonce>')  ← token in query (browser WS can't set headers)
     ConversationView + AgentActivityPanel + PermissionPrompt + composer
```

- **`electron/sidecar.ts`** — Electron-free logic (endpoint minting, spawn-arg building, `SidecarSupervisor`);
  unit-tested without a display or the electron binary.
- **`electron/main.ts`** — wires electron: free-port discovery, `child_process.spawn` of the sidecar, the
  hardened `BrowserWindow`, CSP + navigation lockdown, IPC endpoint handoff, supervision.
- **`electron/preload.ts`** — a minimal `contextBridge` exposing ONLY the endpoint + lifecycle signals.
- **`src/App.tsx`** — `SessionSurface` (pure presentation over `IWsSessionState`, unit-tested) + `SessionView`
  (the thin `useWsSession` binding) + `App` (endpoint resolution + fatal-state gate).

## Sidecar + loopback-auth contract (GUI-002)

- The shell mints a **per-launch 256-bit nonce** and a **free loopback port**, spawns `robota` with them in
  the child environment (`ROBOTA_WS_TOKEN` / `ROBOTA_WS_PORT`) — never on argv (argv is world-readable).
- `agent-cli` reads that env and constructs `WsTransport({ token, port })`; the transport **closes any
  connection that does not present the token (query param or `Sec-WebSocket-Protocol` subprotocol) BEFORE
  any `messages` / `execution_workspace_event` is emitted** (constant-time compare). This closes the
  otherwise-unauthenticated loopback port against a co-resident browser page. (Contract owned by
  `@robota-sdk/agent-transport-ws`; see its SPEC.)
- **Renderer hardening:** `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, `loadFile` of
  local content only, a CSP pinned to `default-src 'self'` + `connect-src ws://127.0.0.1:<port>`, and
  navigation lockdown (`will-navigate` deny + `setWindowOpenHandler` deny) so the nonce-holding renderer
  cannot carry the session to an external origin.
- **Default path unchanged:** the token is only enforced when set; the plain TUI/`apps/agent-web` localhost
  path stays open and is tracked for hardening by **SEC-001**.

## Public API Surface

None — `agent-app` is a private application (`"private": true`), not a library. It exports no package API.

## Dependencies

`@robota-sdk/agent-transport-gui` (workspace) + `react`/`react-dom`. Dev: `electron`, `vite`,
`@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss`, `vitest`, `@testing-library/react`, `jsdom`,
`playwright`, `typescript`, and `@robota-sdk/agent-transport-ws` (workspace, e2e-only — the headless Electron
e2e stands up the real `WsTransport` sidecar). **No `agent-framework`/`agent-core`** (the sidecar owns the
runtime) — enforced by review + the harness `deps` scan.

## Test Strategy

- `electron/__tests__/sidecar.test.ts` — endpoint/token minting, spawn-arg building (token in env, not
  argv), and `SidecarSupervisor` (crash → fatal, ready, shutdown SIGTERM→SIGKILL, idempotent).
- `src/__tests__/session-surface.test.tsx` — the compose-root renders the session over a stub
  `IWsSessionState` and answers permission prompts, proving no session logic lives in the GUI.
- **Headless end-to-end (`e2e/`, `pnpm --filter @robota-sdk/agent-app test:e2e`):** launches the REAL built
  Electron app under **`xvfb`** via **Playwright `_electron`**, pointed at `e2e/scripted-sidecar.mjs` — a
  deterministic sidecar that stands up the **REAL `WsTransport`** (so the GUI-002 T5 loopback auth is
  exercised against the nonce the GUI presents) with a scripted session (no LLM/API key). Asserts the full
  Stage-1 story: connect with the launch nonce → streaming reply → raise + Allow a permission prompt → clean
  shutdown (TC-01/TC-02/TC-04). Runs on this headless Linux box (Electron launched with `--no-sandbox`, the
  standard CI posture). This is the agent-owned automated form of the smoke below — GUI verification is not
  deferred to the owner.

## User Execution Test Scenario (manual, real `robota`)

The headless e2e above covers the GUI behavior deterministically. This manual scenario additionally exercises
a REAL `robota` sidecar (a live provider) on a machine with a display + a built `robota` on `PATH` (or
`ROBOTA_GUI_SIDECAR_CMD` set):

1. `pnpm --filter @robota-sdk/agent-app build && pnpm --filter @robota-sdk/agent-app start`.
2. The window opens, spawns the sidecar, and shows the conversation view (status `connected`).
3. Send a message → a streaming assistant reply + tool cards appear.
4. Trigger a gated tool → a permission prompt appears; **Allow** proceeds, **Deny** blocks.
5. Close the window → the sidecar shuts down (no orphaned `robota` process).
6. Kill the sidecar externally → the UI shows the non-hanging fatal state.

## Constraints

- Electron shell is JS/TS only (no Rust/Bun); the renderer is React (frontend rule) with a Tailwind theme.
- Runs in Electron's bundled Chromium (recent) — the renderer build targets `esnext` (no legacy transpile).
- `"private": true`; not published. Packaging/signing → GUI-003.
