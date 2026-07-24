# SPEC.md — @robota-sdk/agent-transport-gui

## Scope

The **GUI presentation layer** for a running robota session — the graphical analog of the terminal
presentation in `@robota-sdk/agent-transport-tui`. It reconstructs conversation state from the
transport-neutral `TServerMessage` stream and renders it as React components, and it ships the desktop
**session shell** (title/status bar, conversation column, background-activity rail, composer, permission
modal). It is consumed by both GUI product surfaces: the desktop app (`apps/agent-app`, Electron) and the
browser-remote surface (`@robota-sdk/agent-transport-webrtc-web`).

Provides:

- **`useSessionClient(makeClient)`** — the transport-neutral session reducer. Generic over the connection
  status type (`useSessionClient<TStatus>`) so a transport can widen the status union (the WebRTC surface adds
  `pairing | failed`). Reconstructs messages, streaming text, thinking, active tools, the execution-workspace
  snapshot, and the pending permission/ask prompts from `TServerMessage` events.
- **`useWsSession(url)`** — a thin wrapper binding the reducer to a localhost WebSocket sidecar via
  `createWsSessionClient`.
- **`createWsSessionClient(url, callbacks)`** — the browser WebSocket client (reconnect on disconnect), the
  localhost transport for the reducer.
- **Prompt state** — `applyPromptEvent` / `permissionResponse` / `askResponse` (pure), the REMOTE-007
  permission/ask model folded by the reducer for BOTH transports.
- **UI-intent state (CMD-004 Stage D)** — `applyUiIntentEvent` / `removeUiIntentNotice` /
  `describeUiIntentForGui` (pure). A `ui_intent` server message (requester-routed to this surface by
  the server) folds into an explicit, dismissible `IUiIntentNotice` rendered by `SessionSurface`; the
  reducer exposes `uiIntentNotices` + `dismissUiIntentNotice`. The GUI has no full-screen equivalent
  of the four intents yet (`show-settings` / `show-session-picker` / `show-plugin-manager` /
  `show-agent-switcher`), so v1 folds EVERY intent — including unknown future kinds arriving on the
  wire — into an explicit "not available on this surface" notice, never a silent no-op (TC-05, the
  no-fallback rule). When a GUI screen for an intent lands, its arm in `describeUiIntentForGui`
  switches from a notice to the mapped surface state.
- **Components** — `ConversationView` (pure conversation render, markdown), `AgentActivityPanel` (background
  task rail), `PermissionPrompt` (permission/ask modal), `SessionSurface` (the full terminal-noir desktop
  layout over an `IWsSessionState`), and `CenteredChrome` (pre-session / fatal chrome).
- **Theme** — `styles/theme.css`, the "terminal-noir" design tokens + Tailwind `@theme inline` token map +
  base/scrollbar/utility layers. Shipped as source: the package authors Tailwind utility classes and ships NO
  compiled CSS — the **consumer** owns the Tailwind entry (`@import 'tailwindcss'` + `@source` over this
  package's `src`) and `@import`s this file.

This package sits in the **transport / presentation** layer. It is a pure UI + wire-reducer library — it does
not own session lifecycle, conversation history, or agent runtime state.

## Boundaries

- Does NOT own the WS/RTC wire protocol framing — `TServerMessage` / `TClientMessage` are owned by
  `@robota-sdk/agent-transport-protocol`.
- Does NOT own the transport-facing contract types (interaction/event/workspace) — those live in
  `@robota-sdk/agent-interface-transport`.
- Does NOT own `InteractiveSession`, session/runtime contracts, or `agent-core` types — no dependency on
  `agent-framework` / `agent-session` / `agent-core`.
- Does NOT own the CLI sidecar server — that is `agent-cli` (`startWebSidecarServer`).
- Does NOT own the WebRTC remote peer / pairing — that is `@robota-sdk/agent-transport-webrtc-web` (REMOTE-009), which
  consumes this package's reducer + components and widens the status union.
- Does NOT own the Electron shell / sidecar supervision — that is `apps/agent-app`.
- OWNS: the transport-neutral session reducer (`useSessionClient`) + its state/handle contract
  (`IWsSessionState`, `ISessionClientHandle`, `TMakeSessionClient`, `IConversationMessage`, `IActiveTool`).
- OWNS: the localhost WebSocket client (`createWsSessionClient`) + `TConnectionStatus`
  (`disconnected | connecting | connected | error`).
- OWNS: the permission/ask prompt state (`applyPromptEvent`, `permissionResponse`, `askResponse`,
  `TPendingPrompt`).
- OWNS: the ui-intent notice state (`applyUiIntentEvent`, `removeUiIntentNotice`,
  `describeUiIntentForGui`, `IUiIntentNotice`) — CMD-004 Stage D.
- OWNS: the React presentation — `ConversationView`, `AgentActivityPanel`, `PermissionPrompt`,
  `SessionSurface`, `CenteredChrome`.
- OWNS: the "terminal-noir" theme (`styles/theme.css`).

## Architecture Overview

```
apps/agent-app (Electron renderer)          agent-transport-webrtc-web (browser remote)
        │                                            │
        │ useWsSession(loopbackUrl)                  │ useRtcSession({relay,…})
        ▼                                            ▼
  ┌──────────────────────  useSessionClient<TStatus>(makeClient)  ──────────────────────┐
  │  reducer over TServerMessage: messages · text_delta · thinking · tool_start/end ·   │
  │  execution_workspace_event · permission_request/ask_request/prompt_resolved ·       │
  │  complete/interrupted  →  IWsSessionState<TStatus>                                   │
  └──────────────────────────────────────────────────────────────────────────────────┘
        │                                            │
        │ createWsSessionClient (localhost)          │ createRtcSessionClient (agent-transport-webrtc-web)
        ▼                                            ▼
  agent-transport-protocol  (TServerMessage / TClientMessage)
```

`useSessionClient` is generic over `TStatus extends string = TConnectionStatus`: the WS path uses
`TConnectionStatus`; the WebRTC path (agent-transport-webrtc-web) instantiates `useSessionClient<TSessionStatus>` where
`TSessionStatus = TConnectionStatus | TRtcConnectionStatus`. This keeps the RTC-only status states out of this
package (no dependency on the RTC client) — the reason the reducer is generic rather than importing a widened
union (which would create a package cycle).

`SessionSurface` is pure presentation over `IWsSessionState`: title/status bar, an empty state, the
`ConversationView` column, the `AgentActivityPanel` rail (when the execution workspace has entries), the
`Composer` (Enter sends, ⇧Enter newline), and the `PermissionPrompt` modal. It holds NO session/transport
logic — it forwards user intent through the reducer's `send` / `answerPermission` / `answerAsk`.

## Type Ownership

| Type / value                                                               | Owner                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------ |
| `IWsSessionState<TStatus>`                                                 | this package (reducer state)                           |
| `ISessionClientHandle`, `TMakeSessionClient`                               | this package                                           |
| `IConversationMessage`, `IActiveTool`                                      | this package                                           |
| `TConnectionStatus`                                                        | this package (`createWsSessionClient`)                 |
| `TPendingPrompt`                                                           | this package (`prompt-state`)                          |
| `TServerMessage`, `TClientMessage`                                         | `@robota-sdk/agent-transport-protocol`                 |
| `IExecutionWorkspaceSnapshot`, `TActionResponse`, `TPermissionResultValue` | `@robota-sdk/agent-interface-transport`                |
| `TRtcConnectionStatus`, `TSessionStatus`                                   | `@robota-sdk/agent-transport-webrtc-web` (RTC surface) |

## Public API Surface

Exported from the package root (node) and `./client` (browser):

| Export                   | Kind      | Description                                                                          |
| ------------------------ | --------- | ------------------------------------------------------------------------------------ |
| `useSessionClient`       | hook      | Transport-neutral session reducer, generic over the status type                      |
| `useWsSession`           | hook      | `useSessionClient` bound to a localhost WS via `createWsSessionClient`               |
| `createWsSessionClient`  | function  | Browser WebSocket client (reconnecting) implementing `ISessionClientHandle`          |
| `applyPromptEvent`       | function  | Fold a permission/ask/resolved event into the pending-prompt list                    |
| `permissionResponse`     | function  | Build the `TClientMessage` answering a permission prompt                             |
| `askResponse`            | function  | Build the `TClientMessage` answering an ask prompt                                   |
| `applyUiIntentEvent`     | function  | Fold a `ui_intent` server message into the explicit notice list (CMD-004 Stage D)    |
| `removeUiIntentNotice`   | function  | Dismiss one ui-intent notice by id (idempotent)                                      |
| `describeUiIntentForGui` | function  | Per-kind explicit "not available on this surface" text for an intent                 |
| `ConversationView`       | component | Pure conversation renderer (markdown); messages/activeTools/streamingText/isThinking |
| `AgentActivityPanel`     | component | Background-task rail; `tasks: readonly IExecutionWorkspaceEntry[]`                   |
| `PermissionPrompt`       | component | Permission/ask modal; prompts + `onAnswerPermission`/`onAnswerAsk`                   |
| `SessionSurface`         | component | Full terminal-noir desktop layout over an `IWsSessionState`; optional `surface`      |
| `CenteredChrome`         | component | Pre-session / fatal chrome frame; `tone` + children                                  |
| `SessionMonitor`         | component | Localhost-WS **web** session shell (composes the reducer + views); prop `wsUrl`      |
| `IConversationMessage`   | type      | Reconstructed conversation message (id, role, content, author?)                      |
| `IActiveTool`            | type      | Active tool-call display state                                                       |
| `IWsSessionState`        | type      | Reducer return state (generic over the status type)                                  |
| `ISessionClientHandle`   | type      | The `connect`/`disconnect`/`send` handle a transport client returns                  |
| `TMakeSessionClient`     | type      | Factory the reducer calls to build its client from the callbacks                     |
| `TConnectionStatus`      | type      | WS lifecycle status (`disconnected \| connecting \| connected \| error`)             |
| `TPendingPrompt`         | type      | A pending permission/ask prompt awaiting the owner's answer                          |

Style: `./styles/theme.css` (source; consumer-compiled). Consumers import these directly — this package is
NOT re-exported through a sibling product (`agent-transport-webrtc-web` does not re-export it; the repo forbids
pass-through re-exports).

## Extension Points

- A new transport supplies its own `makeClient` (a `TMakeSessionClient<TStatus>`) and, if it has extra
  connection states, instantiates `useSessionClient<ItsStatus>` — mirroring `useRtcSession` in `agent-transport-webrtc-web`.
- A new GUI surface (e.g. a future unified web app) renders `SessionSurface` / the components over its own
  `makeClient`, and owns its Tailwind entry + theme import.

## Error Taxonomy

- Malformed server frames are surfaced through the client's `onMessage`/callback path (never thrown inside the
  socket handler) — see the `ws-session-client` regression tests (WEBUI-002 origin).

## Test Strategy

- `ws-session-client.test.ts` — malformed-frame safety + connect/replay behavior of the WS client.
- `prompt-state.test.ts` — the permission/ask reducer helpers.
- `ui-intent-state.test.ts` — CMD-004 TC-05: every `ui_intent` kind (including unknown wire-level
  kinds) folds to an explicit notice — never a silent no-op; dismissal is id-scoped + idempotent.
- Component rendering (`SessionSurface`, prompts) is exercised by the consuming app's jsdom test
  (`apps/agent-app`) and its headless Electron e2e (real `WsTransport` sidecar).

## Class Contract Registry

### Functions / Hooks

| Name                                 | Kind     | Contract                                                                |
| ------------------------------------ | -------- | ----------------------------------------------------------------------- |
| `useSessionClient`                   | hook     | Reduce a `TServerMessage` stream to `IWsSessionState<TStatus>`.         |
| `useWsSession`                       | hook     | `useSessionClient` bound to a localhost WS via `createWsSessionClient`. |
| `createWsSessionClient`              | factory  | Browser WS client (reconnecting) implementing `ISessionClientHandle`.   |
| `applyPromptEvent`                   | function | Fold a permission/ask/resolved event into the pending-prompt list.      |
| `permissionResponse` / `askResponse` | function | Build the `TClientMessage` answering a prompt.                          |
| `applyUiIntentEvent`                 | function | Fold a `ui_intent` message into the explicit notice list (CMD-004).     |
| `removeUiIntentNotice`               | function | Dismiss one ui-intent notice by id (idempotent).                        |
| `describeUiIntentForGui`             | function | Explicit per-kind unavailable-on-this-surface text.                     |

### Components

| Name                 | Props                                                    |
| -------------------- | -------------------------------------------------------- |
| `ConversationView`   | `messages`, `activeTools`, `streamingText`, `isThinking` |
| `AgentActivityPanel` | `tasks: readonly IExecutionWorkspaceEntry[]`             |
| `PermissionPrompt`   | `prompts`, `onAnswerPermission`, `onAnswerAsk`           |
| `SessionSurface`     | `state: IWsSessionState`, optional `surface` label       |
| `CenteredChrome`     | `tone: 'muted' \| 'fatal'`, `children`                   |
| `SessionMonitor`     | `wsUrl: string`, optional `className` (web monitor page) |

### Cross-Package Consumers

- `apps/agent-app` — Electron renderer: `useWsSession` + `SessionSurface` + `CenteredChrome` + `theme.css`.
- `@robota-sdk/agent-transport-webrtc-web` — `useSessionClient` (generic), `ConversationView`, `AgentActivityPanel`,
  `PermissionPrompt` for its `SessionMonitor` / `RemoteClient`.
