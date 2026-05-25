# robota-example-nextjs

Streaming AI chat embedded in a Next.js App Router application using `@robota-sdk/agent-framework`.

## What this shows

- Mounting the Robota runtime inside a Next.js API route
- Streaming the response as Server-Sent Events (SSE)
- Consuming the SSE stream from a React client component

## Quick start

```bash
cp .env.example .env.local
# fill in ANTHROPIC_API_KEY

npm install
npm run dev
```

Open http://localhost:3000 — you should see a streaming chat UI.

## Key files

| File                    | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `app/api/chat/route.ts` | POST handler — creates session, emits SSE           |
| `components/chat.tsx`   | Client component — reads SSE, renders streamed text |

## How it works

```
Client (fetch + ReadableStream)
  └─ POST /api/chat
       └─ createAgentRuntime({ provider })
            └─ session.submit(message)
                 ├─ text_delta  → data: { type: "text_delta", text: "..." }
                 └─ done        → data: { type: "done" }
```

## Swap provider

Change `AnthropicProvider` in `app/api/chat/route.ts` to any supported provider:

```ts
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';

provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
```

Set the corresponding env var (`OPENAI_API_KEY`) in `.env.local`.
