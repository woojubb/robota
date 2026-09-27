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
  └─ POST /api/chat { message }
       └─ createAgentRuntime({ cwd, provider }).createSession({ permissionMode, bare: true })
            └─ session.submit(message)
                 ├─ text_delta            → data: { type: "text_delta", text: "..." }
                 ├─ complete/interrupted  → data: { type: "done" }
                 └─ error                 → data: { type: "error", message: "..." }
```

Each request builds a new runtime and session, and the client sends only the latest message, so the model
does not see earlier turns of the chat. The session runs with `permissionMode: 'bypassPermissions'` and the
default tool set in the server's working directory, so anyone who can reach `/api/chat` can have the agent
read, write and run shell commands there. Keep the app local, or pass `deniedTools` to `createSession()`.

## Swap provider

Install the provider package (`npm install @robota-sdk/agent-provider-openai`) and change
`AnthropicProvider` in `app/api/chat/route.ts`:

```ts
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const agentRuntime = createAgentRuntime({
  cwd: process.cwd(),
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
});
```

Set the corresponding env var (`OPENAI_API_KEY`) in `.env.local`, and update the handler's
`ANTHROPIC_API_KEY` check to the new variable.
