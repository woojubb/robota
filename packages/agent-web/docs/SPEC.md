# SPEC.md — @robota-sdk/agent-web

## Scope

Browser React component library for monitoring and optionally controlling a running `agent-cli`
session over WebSocket. Provides a connection hook (`useWsSession`), a conversation view component
(`ConversationView`), and a self-contained monitor widget (`SessionMonitor`) that applications can
embed without importing from any other `@robota-sdk/*` package.

This package sits in the **Product shells** layer. It is a pure browser UI library — it does not
own session lifecycle, conversation history, or agent runtime state.

**Distinction from `apps/agent-web`:** `packages/agent-web` is a published npm package that
exports reusable browser React components. `apps/agent-web` is a Next.js host application that
consumes `packages/agent-web` and deploys the actual web UI. They share a name prefix but are
different layers: this package is a library; the app is a deployment.

## Boundaries

- Does NOT own WebSocket protocol framing — that is `@robota-sdk/agent-transport-ws`
  (`TServerMessage`, `TClientMessage`).
- Does NOT own `InteractiveSession` or any SDK/session/runtime contracts — those live in
  `agent-sdk`, `agent-sessions`, `agent-runtime`.
- Does NOT own `agent-core` types directly — message types pass through `agent-transport-ws`.
- Does NOT own the CLI sidecar server — that is `agent-cli` (`startWebSidecarServer`).
- OWNS: browser WebSocket client lifecycle (`IWsSessionClient`, reconnect logic).
- OWNS: React state reconstruction from `TServerMessage` events (`useWsSession`).
- OWNS: React components `SessionMonitor` and `ConversationView`.
- OWNS: `TConnectionStatus` type (`disconnected | connecting | connected | error`).

## Architecture Overview

```
agent-web (browser)
  └── useWsSession(url)
        └── createWsSessionClient  ← reconnects on disconnect (max 10 attempts, 2s delay)
              │  onMessage (TServerMessage)
              └── agent-transport-ws  ← TServerMessage / TClientMessage types only
```

On connect the client sends `{ type: "get-messages" }` to request full history replay from
the CLI sidecar. Subsequent `TServerMessage` events update React state in `useWsSession`.

`SessionMonitor` is a self-contained React component that renders connection status, the
conversation view, and a prompt input. It calls `useWsSession` internally and requires only
a `url` prop pointing at the CLI sidecar's WebSocket endpoint.

`ConversationView` is a pure rendering component that accepts `IConversationMessage[]`,
`IActiveTool[]`, `streamingText`, and `isThinking` props from the caller.

## Type Ownership

| Type                   | Location                          | Purpose                                                                                |
| ---------------------- | --------------------------------- | -------------------------------------------------------------------------------------- |
| `TConnectionStatus`    | `src/client/ws-session-client.ts` | WebSocket lifecycle state: disconnected / connecting / connected / error               |
| `IWsSessionClient`     | `src/client/ws-session-client.ts` | Handle returned by `createWsSessionClient` (connect/disconnect/send/status)            |
| `IConversationMessage` | `src/hooks/useWsSession.ts`       | Reconstructed conversation message with id, role, content, and optional streaming flag |
| `IActiveTool`          | `src/hooks/useWsSession.ts`       | Active tool call state: id, name, status (running/done/error), input, result           |
| `IWsSessionState`      | `src/hooks/useWsSession.ts`       | Full React hook state: status, messages, activeTools, streamingText, isThinking, send  |

## Public API Surface

| Export                 | Kind      | Description                                                                          |
| ---------------------- | --------- | ------------------------------------------------------------------------------------ |
| `SessionMonitor`       | component | Self-contained monitor widget; accepts `url` prop for the CLI sidecar WebSocket      |
| `ConversationView`     | component | Pure conversation renderer; accepts messages, activeTools, streamingText, isThinking |
| `useWsSession`         | hook      | React hook managing WebSocket connection and reconstructing session state            |
| `IConversationMessage` | type      | Reconstructed message shape for display                                              |
| `IActiveTool`          | type      | Active tool call display state                                                       |
| `IWsSessionState`      | type      | Full hook return type                                                                |
| `TConnectionStatus`    | type      | WebSocket lifecycle status enum                                                      |

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

- No test files exist currently. Recommended:
  - Unit tests for `createWsSessionClient` reconnect logic with a mock WebSocket.
  - Unit tests for `useWsSession` message reconstruction logic (mocking `createWsSessionClient`).
  - Render tests for `ConversationView` with representative message arrays.

## Class Contract Registry

### Functions / Hooks

| Export                  | Defined In                        | Notes                                      |
| ----------------------- | --------------------------------- | ------------------------------------------ |
| `createWsSessionClient` | `src/client/ws-session-client.ts` | Factory; not re-exported from package root |
| `useWsSession`          | `src/hooks/useWsSession.ts`       | Re-exported from package root              |

### Components

| Component          | Defined In                            | Notes                                  |
| ------------------ | ------------------------------------- | -------------------------------------- |
| `SessionMonitor`   | `src/components/SessionMonitor.tsx`   | `'use client'` directive; Tailwind CSS |
| `ConversationView` | `src/components/ConversationView.tsx` | Pure renderer; Tailwind CSS            |

### Cross-Package Port Consumers

| Port (Owner)                          | Usage                                              |
| ------------------------------------- | -------------------------------------------------- |
| `TServerMessage` (agent-transport-ws) | Parsed from WebSocket `onmessage` events           |
| `TClientMessage` (agent-transport-ws) | Sent to sidecar via `ws.send(JSON.stringify(msg))` |
