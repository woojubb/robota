# robota-example-express

Express REST API with AI tool use powered by `@robota-sdk/agent-core`.

## What this shows

- Creating a `Robota` agent with custom tools
- Registering `calculate` and `get_current_time` tools via `createFunctionTool`
- Streaming the response as SSE from a POST endpoint

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
| `src/server.ts` | Express server — tools, agent, SSE route |

## Endpoints

| Method | Path        | Description                  |
| ------ | ----------- | ---------------------------- |
| GET    | `/health`   | Liveness check               |
| POST   | `/api/chat` | SSE stream — tool-aware chat |

## How it works

```
POST /api/chat { message }
  └─ Robota.runStream(message)
       ├─ LLM calls tool → execute → result injected
       └─ yields text chunks → SSE text_delta events
```

## Swap provider

In `src/server.ts`, replace `AnthropicProvider` with any supported provider:

```ts
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';

aiProviders: [new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY })],
defaultModel: { provider: 'openai', model: 'gpt-4o-mini' },
```
