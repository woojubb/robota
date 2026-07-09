# robota-example-express

Express REST API with AI tool use, powered by `@robota-sdk/agent-framework`.

## What this shows

- Creating a per-request query with `createQuery` from `@robota-sdk/agent-framework`
- Defining `calculate` and `get_current_time` tools with `createZodFunctionTool` from `@robota-sdk/agent-tools`
- Driving an `AnthropicProvider` from `@robota-sdk/agent-provider-anthropic`
- Streaming the response as SSE from a POST endpoint via the `onTextDelta` callback

## Quick start

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY

npm install
npm run dev
```

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
  └─ createQuery({ provider, additionalTools, onTextDelta })
       └─ query(message)
            ├─ LLM calls tool → execute → result injected
            └─ onTextDelta(delta) → SSE text_delta events → done
```

## Swap provider

In `src/server.ts`, replace `AnthropicProvider` with any supported provider and pass it to
`createQuery`:

```ts
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const query = createQuery({
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
  additionalTools: [calculatorTool, currentTimeTool],
  onTextDelta: (delta) => send({ type: 'text_delta', text: delta }),
});
```
