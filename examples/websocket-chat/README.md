# websocket-chat

Real-time AI chat over WebSocket using the agent runtime SDK with streaming text deltas.

## Features

- One `InteractiveSession` per connected client
- Streaming text via `text_delta` events forwarded as WebSocket deltas
- Abort support — click **Stop** or send `{ "type": "abort" }`
- Auto-reconnect in the browser client

## Setup

```bash
cd examples/websocket-chat
npm install          # or pnpm install

export ANTHROPIC_API_KEY=your-key
```

The server reads `ANTHROPIC_API_KEY` and `PORT` from the environment, and loads `.env` from the working
directory first when there is one (copy `.env.example` to `.env`).

## Run

```bash
# Development (watch mode)
npm run dev

# Production
npm run build
npm start
```

The server starts on `ws://localhost:8080` (override with the `PORT` env var; the browser client connects to
`ws://localhost:8080`, so change `src/client.html` to match).

## Use the browser client

Open `src/client.html` directly in your browser (no build step needed):

```
open src/client.html       # macOS
xdg-open src/client.html   # Linux
start src/client.html      # Windows
```

Type a message and press **Enter** or click **Send**. Text streams in real time.  
Click **Stop** to abort the current generation mid-stream.

## Message protocol

**Client → Server**

| Message                                | Description              |
| -------------------------------------- | ------------------------ |
| `{ "type": "message", "text": "..." }` | Submit a prompt          |
| `{ "type": "abort" }`                  | Abort current generation |

**Server → Client**

| Message                                 | Description          |
| --------------------------------------- | -------------------- |
| `{ "type": "delta", "text": "..." }`    | Streaming text chunk |
| `{ "type": "done", "response": "..." }` | Generation complete  |
| `{ "type": "error", "message": "..." }` | Error occurred       |

An aborted generation also ends with `done`, carrying the partial response. Each connection keeps its session
for its lifetime, so the conversation continues across messages until the client disconnects.

Anyone who can connect talks to the agent, so the session has none of the built-in tools that run commands,
read or change files, reach the network or send files (`DENIED_TOOLS` in `src/server.ts`). Give it your own
tools with `additionalTools` and approve them by name with `allowedTools`.
