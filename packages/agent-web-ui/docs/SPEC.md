# SPEC.md — @robota-sdk/agent-web-ui

## Scope

Browser React component library for monitoring and optionally controlling a running `agent-cli`
session over WebSocket. Provides a connection hook (`useWsSession`), a conversation view component
(`ConversationView`), an agent activity panel (`AgentActivityPanel`), and a self-contained monitor
widget (`SessionMonitor`) that applications can embed without importing from any other
`@robota-sdk/*` package.

**REMOTE-009 Stage D — browser remote client.** The package is also the P2P remote peer: it opens the
pairing URL, answers the host's WebRTC offer over a **native** `RTCPeerConnection`, runs the pairing
handshake as RESPONDER over the data channel, and co-drives the SAME session — swapping WebSocket for
`RTCDataChannel`. The session hook is parameterized (`useSessionClient(makeClient)`) with two thin
wrappers: `useWsSession(url)` (localhost) and `useRtcSession({relayUrl,rendezvous,secret})` (Stage D).
The RTC path adds `createRtcSignalingClient` (native-`WebSocket` `ISignalingClient`), `ResponderGate`
(fail-closed pairing routing switch — session exposed ONLY post-accept, dropped pre-accept non-pairing),
`createRtcSessionClient` (answerer + gate + session client), `parseRemoteClientLocation` (relay ← query,
secret ← fragment), and the `spa/remote.html` fragment-injected static entry (`RemoteClient`). It reuses
the isomorphic zero-dep `@robota-sdk/agent-remote-pairing` leaf and takes **no** `agent-transport-webrtc`
(node/werift) dependency. The permission/ask render+answer (`useWsSession` handles
`permission_request`/`ask_request`/`prompt_resolved`, `PermissionPrompt` component) serves BOTH the WS and
RTC clients — the paired owner answers its OWN prompts (local == remote).

This package sits in the **Product shells** layer. It is a pure browser UI library — it does not
own session lifecycle, conversation history, or agent runtime state.

**Distinction from `apps/agent-web`:** `packages/agent-web-ui` is a reusable browser React
component library that exports components for other workspaces to consume. `apps/agent-web` is a
Next.js host application that consumes `packages/agent-web-ui` and deploys the actual web UI. They
share a name prefix but are different layers: this package is a library; the app is a deployment.

## Boundaries

- Does NOT own WebSocket protocol framing — the `TServerMessage`/`TClientMessage` wire protocol is owned by
  `@robota-sdk/agent-transport-protocol` (REMOTE-002 extraction).
- Does NOT own `InteractiveSession` or any SDK/session/runtime contracts — those live in
  `agent-framework`, `agent-session`, `agent-executor`.
- Does NOT own `agent-core` types directly — protocol message types come from `agent-transport-protocol`.
- Does NOT own the CLI sidecar server — that is `agent-cli` (`startWebSidecarServer`).
- Does NOT own the pairing CRYPTO — the directional-HMAC handshake + DTLS-fingerprint channel binding is the
  isomorphic zero-dep `@robota-sdk/agent-remote-pairing` leaf (the only REMOTE-009 dep added). Owns the browser
  responder GATE + answerer glue. Takes **no** `agent-transport-webrtc`/werift dependency (that is node-only).
- OWNS: browser WebSocket client lifecycle (`IWsSessionClient`, reconnect logic).
- OWNS: browser WebRTC remote client (REMOTE-009): `createRtcSignalingClient`, `ResponderGate`,
  `createRtcSessionClient`, `parseRemoteClientLocation`, `RemoteClient`/`PermissionPrompt`, the `spa/remote.html`
  entry, and the `useSessionClient`/`useRtcSession` hooks.
- OWNS: React state reconstruction from `TServerMessage` events (`useSessionClient`), incl. the REMOTE-007
  permission/ask prompt state (`applyPromptEvent`) for BOTH transports.
- OWNS: React components `SessionMonitor`, `ConversationView`, `AgentActivityPanel`, `RemoteClient`, `PermissionPrompt`.
- OWNS: `TConnectionStatus` (`disconnected | connecting | connected | error`) + `TRtcConnectionStatus`
  (adds `pairing | failed`) + `TSessionStatus` (their union).
- OWNS: `IWsSessionClientCallbacks` callback contract for `createWsSessionClient`.

## Architecture Overview

```
agent-web (browser)
  └── useWsSession(url)
        └── createWsSessionClient  ← reconnects on disconnect (max 10 attempts, 2s delay)
              │  onMessage (TServerMessage)
              └── agent-transport-protocol  ← TServerMessage / TClientMessage types
```

On connect the client sends `{ type: "get-messages" }` to request full history replay from
the CLI sidecar. Subsequent `TServerMessage` events update React state in `useWsSession`.
The hook handles: `messages`, `user_message`, `text_delta`, `thinking`, `tool_start`,
`tool_end`, `execution_workspace_event`, `complete`, and `interrupted` message types.

`SessionMonitor` is a self-contained React component that renders connection status, the
conversation view, a prompt input, and an optional `AgentActivityPanel` for background tasks.
It calls `useWsSession` internally and requires a `wsUrl` prop pointing at the CLI sidecar's
WebSocket endpoint. It conditionally renders `AgentActivityPanel` when
`executionWorkspace.entries` contains visible background tasks.

`ConversationView` is a pure rendering component that accepts `IConversationMessage[]`,
`IActiveTool[]`, `streamingText`, and `isThinking` props from the caller.

`AgentActivityPanel` is a pure rendering component that accepts a `tasks` prop of
`readonly IExecutionWorkspaceEntry[]` (from `agent-transport-ws`) and renders each agent's
status, current action, and preview with animated status indicators.

## Type Ownership

| Type                        | Location                          | Purpose                                                                                                   |
| --------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `TConnectionStatus`         | `src/client/ws-session-client.ts` | WebSocket lifecycle state: disconnected / connecting / connected / error                                  |
| `IWsSessionClient`          | `src/client/ws-session-client.ts` | Handle returned by `createWsSessionClient` (connect/disconnect/send/status)                               |
| `IWsSessionClientCallbacks` | `src/client/ws-session-client.ts` | Callback contract passed to `createWsSessionClient` (onMessage, onStatusChange)                           |
| `IConversationMessage`      | `src/hooks/useWsSession.ts`       | Reconstructed conversation message with id, role, content, and optional streaming flag                    |
| `IActiveTool`               | `src/hooks/useWsSession.ts`       | Active tool call state: id, name, status (running/done/error), input, result                              |
| `IWsSessionState`           | `src/hooks/useWsSession.ts`       | Full React hook state: status, messages, activeTools, streamingText, isThinking, executionWorkspace, send |

Note: `IExecutionWorkspaceSnapshot`, `IExecutionWorkspaceEntry`, `TExecutionWorkspaceStatus`, and
`TExecutionAttention` are consumed from `@robota-sdk/agent-transport-ws` and are not owned by this
package.

## Public API Surface

| Export                      | Kind      | Description                                                                                              |
| --------------------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| `SessionMonitor`            | component | Self-contained monitor widget; accepts `wsUrl` prop for the CLI sidecar WebSocket                        |
| `ConversationView`          | component | Pure conversation renderer; accepts messages, activeTools, streamingText, isThinking                     |
| `AgentActivityPanel`        | component | Background-task monitor panel; accepts `tasks: readonly IExecutionWorkspaceEntry[]` (exported from root) |
| `useWsSession`              | hook      | React hook managing WebSocket connection and reconstructing session state                                |
| `useSessionClient`          | hook      | Core session hook parameterized by a client factory (WS or RTC); reconstructs state + prompt handling    |
| `useRtcSession`             | hook      | REMOTE-009 Stage D: React hook for the WebRTC remote client (`{relayUrl,rendezvous,secret}`)             |
| `RemoteClient`              | component | REMOTE-009 Stage D root: reads the pairing URL, pairs over WebRTC, renders the session + prompts         |
| `PermissionPrompt`          | component | Renders the owner's pending permission/ask prompts + answer buttons (REMOTE-007 render+answer)           |
| `createRtcSessionClient`    | function  | Browser WebRTC answerer + pairing responder + data-channel session client (REMOTE-009)                   |
| `createRtcSignalingClient`  | function  | Browser `ISignalingClient` over the native `WebSocket` (REMOTE-009)                                      |
| `parseRemoteClientLocation` | function  | Parse the Stage-D page URL: relay ← query, rendezvous + secret ← fragment (REMOTE-009)                   |
| `IConversationMessage`      | type      | Reconstructed message shape for display                                                                  |
| `TPendingPrompt`            | type      | A pending permission/ask prompt awaiting the owner's answer (REMOTE-007/009)                             |
| `TSessionStatus`            | type      | Union of the WS + RTC connection statuses                                                                |
| `IActiveTool`               | type      | Active tool call display state                                                                           |
| `IWsSessionState`           | type      | Full hook return type including `executionWorkspace: IExecutionWorkspaceSnapshot \| null`                |
| `TConnectionStatus`         | type      | WebSocket lifecycle status enum                                                                          |

## Extension Points

- Consumers may use `useWsSession` directly for custom UI layouts instead of `SessionMonitor`.
- `ConversationView` accepts all display props explicitly; consumers can wrap it inside any layout.
- The `send` function returned by `useWsSession` accepts `TClientMessage` values to submit prompts
  back to the CLI session (Phase 2 feature).

## Error Taxonomy

| Source              | Behavior                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------ |
| WebSocket bind fail | Status transitions to `error`; reconnect attempted up to 10 times                          |
| Invalid JSON        | Silently ignored (non-string `data` is filtered before parse)                              |
| Server-closed       | Status transitions to `disconnected`; automatic reconnect unless `disconnect()` was called |

## Test Strategy

- `createWsSessionClient` is unit-tested with a mock WebSocket (malformed-frame guard +
  reconnect / intentional-disconnect logic — WEBUI-001/002). Still recommended:
  - Unit tests for `createWsSessionClient` reconnect logic with a mock WebSocket. _(done)_
  - Unit tests for `useWsSession` message reconstruction logic (mocking `createWsSessionClient`).
  - Render tests for `ConversationView` with representative message arrays.

## Class Contract Registry

### Functions / Hooks

| Export                  | Defined In                        | Notes                                      |
| ----------------------- | --------------------------------- | ------------------------------------------ |
| `createWsSessionClient` | `src/client/ws-session-client.ts` | Factory; not re-exported from package root |
| `useWsSession`          | `src/hooks/useWsSession.ts`       | Re-exported from package root              |

### Components

| Component            | Defined In                              | Notes                                                                                                    |
| -------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `SessionMonitor`     | `src/components/SessionMonitor.tsx`     | `'use client'` directive; Tailwind CSS; prop `wsUrl: string`                                             |
| `ConversationView`   | `src/components/ConversationView.tsx`   | Pure renderer; `'use client'` directive; Tailwind CSS                                                    |
| `AgentActivityPanel` | `src/components/AgentActivityPanel.tsx` | Pure renderer; no `'use client'` directive (server-renderable); exported from package root; Tailwind CSS |

### Cross-Package Port Consumers

| Port (Owner)                                                            | Usage                                               |
| ----------------------------------------------------------------------- | --------------------------------------------------- |
| `TServerMessage` (agent-transport-protocol)                             | Parsed from WebSocket `onmessage` events            |
| `TClientMessage` (agent-transport-protocol)                             | Sent to sidecar via `ws.send(JSON.stringify(msg))`  |
| `IExecutionWorkspaceSnapshot` (agent-transport-ws)                      | Stored in `IWsSessionState.executionWorkspace`      |
| `IExecutionWorkspaceEntry` (agent-transport-ws)                         | Passed as `tasks` prop to `AgentActivityPanel`      |
| `TExecutionWorkspaceStatus`, `TExecutionAttention` (agent-transport-ws) | Used in `AgentActivityPanel` status rendering logic |
