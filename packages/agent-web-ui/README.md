# Agent Web UI

Browser React component library for monitoring a running `agent-cli` session over WebSocket. Provides a connection hook, conversation view, and a self-contained monitor widget.

## Installation

```bash
npm install @robota-sdk/agent-web-ui
```

> This package is browser-only. It requires React 18+.

## Quick Start

```tsx
import { SessionMonitor } from '@robota-sdk/agent-web-ui';

function App() {
  return <SessionMonitor url="ws://localhost:3001" className="my-monitor" />;
}
```

`SessionMonitor` connects to the CLI sidecar's WebSocket endpoint, replays history, and renders the conversation in real time.

## Components

### `SessionMonitor`

Self-contained widget. Renders connection status, conversation history, and a prompt input.

```tsx
<SessionMonitor url="ws://localhost:3001" />
```

### `ConversationView`

Pure rendering component for conversation messages. Use this when you manage WebSocket state yourself.

```tsx
import { ConversationView } from '@robota-sdk/agent-web-ui';

<ConversationView
  messages={messages}
  activeTools={activeTools}
  streamingText={streamingText}
  isThinking={isThinking}
/>;
```

## Hook

### `useWsSession`

React hook that manages the WebSocket connection and reconstructs conversation state from server events.

```typescript
import { useWsSession } from '@robota-sdk/agent-web-ui';

declare const url: string;
const { status, messages, activeTools, streamingText, isThinking, send } = useWsSession(url);
```

| Field           | Type                     | Description                                        |
| --------------- | ------------------------ | -------------------------------------------------- |
| `status`        | `TConnectionStatus`      | `disconnected \| connecting \| connected \| error` |
| `messages`      | `IConversationMessage[]` | Reconstructed conversation history                 |
| `activeTools`   | `IActiveTool[]`          | Currently running tool calls                       |
| `streamingText` | `string`                 | Partial streaming assistant text                   |
| `isThinking`    | `boolean`                | Whether the agent is processing                    |
| `send`          | `(msg) => void`          | Send a prompt to the agent                         |

## Architecture

This package is a pure browser UI library. It does not own session lifecycle or agent runtime state.

```
agent-web-ui (browser components)
  └── useWsSession(url)
        └── createWsSessionClient  ← reconnects on disconnect
              └── agent-transport-ws  ← TServerMessage / TClientMessage types
```

## Dependencies

- `react` ^18 (peer)
- `@robota-sdk/agent-transport` (for WebSocket message types)

## Links

- [npm](https://www.npmjs.com/package/@robota-sdk/agent-web-ui)
- [GitHub](https://github.com/woojubb/robota)
