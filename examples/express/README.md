# robota-example-express

Express REST API that streams chat responses over SSE and registers custom tools for the agent, powered by
`@robota-sdk/agent-framework`.

## What this shows

- Creating a per-request query with `createQuery` from `@robota-sdk/agent-framework`
- Defining `calculate` and `get_current_time` tools with `createZodFunctionTool` from `@robota-sdk/agent-tools`
- Driving an `AnthropicProvider` from `@robota-sdk/agent-provider-anthropic`
- Streaming the response as SSE from a POST endpoint via the `onTextDelta` callback

## Quick start

```bash
npm install
export ANTHROPIC_API_KEY=your-key
npm run dev
```

The server reads `ANTHROPIC_API_KEY` and `PORT` (default `3001`) from the environment, and loads `.env` from
the working directory first when there is one (copy `.env.example` to `.env`).

Test with curl:

```bash
curl -N -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is 123 multiplied by 456?"}'
```

## Key files

| File            | Purpose                                  |
| --------------- | ---------------------------------------- |
| `src/server.ts` | Express server — tools, query, SSE route |

## Endpoints

| Method | Path        | Description                  |
| ------ | ----------- | ---------------------------- |
| GET    | `/health`   | Liveness check               |
| POST   | `/api/chat` | SSE stream — tool-aware chat |

## How it works

The tools are created once at startup with `createZodFunctionTool`. Each request builds a fresh
query with `createQuery` (so conversation history never bleeds between users), registers the tools
via `additionalTools`, and forwards streamed text through `onTextDelta` as SSE events.

```
POST /api/chat { message }
  └─ createQuery({ provider, additionalTools, allowedTools, deniedTools, onTextDelta })
       └─ query(message)
            ├─ onTextDelta(delta) → data: { type: "text_delta", text }
            └─ settled             → data: { type: "done" } or { type: "error", message }
```

## Tool permissions

`createQuery` runs in the `default` permission mode, where a custom tool would ask for approval that no
one is there to give. The server lists its two tools in `allowedTools`, so they run without asking, and
denies the built-in tools that run commands, read or change files, reach the network or send files, since
anyone who can reach `/api/chat` writes the prompt:

```ts
const query = createQuery({
  provider: new AnthropicProvider({ apiKey }),
  additionalTools: [calculatorTool, currentTimeTool],
  allowedTools: ['calculate', 'get_current_time'],
  deniedTools: DENIED_TOOLS,
  onTextDelta: (delta) => send({ type: 'text_delta', text: delta }),
});
```

## Swap provider

Install the provider package (`npm install @robota-sdk/agent-provider-openai`), then in `src/server.ts`
replace `AnthropicProvider` and pass the new provider to `createQuery`:

```ts
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const query = createQuery({
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
  model: 'gpt-4o',
  additionalTools: [calculatorTool, currentTimeTool],
  allowedTools: ['calculate', 'get_current_time'],
  deniedTools: DENIED_TOOLS,
  onTextDelta: (delta) => send({ type: 'text_delta', text: delta }),
});
```
