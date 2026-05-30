# websocket-chat

Real-time AI chat over WebSocket using Robota SDK with streaming text deltas.

## Features

- One `InteractiveSession` per connected client
- Streaming text via `text_delta` events forwarded as WebSocket deltas
- Abort support — click **Stop** or send `{ "type": "abort" }`
- Auto-reconnect in the browser client

## Setup

```bash
cd examples/websocket-chat
npm install          # or pnpm install

cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY
```

## Run

```bash
# Development (watch mode)
npm run dev

# Production
npm run build
npm start
```

The server starts on `ws://localhost:8080` (override with `PORT=` env var).

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
