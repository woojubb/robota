# Embedding agent-framework

`@robota-sdk/agent-framework` can be used outside the CLI — in HTTP servers, bots,
serverless functions, and batch pipelines. This guide shows the correct pattern for
each deployment context.

## API selection

| Use case                          | Recommended API                                            | Notes                                 |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| Single-shot query (scripts, CI)   | `createQuery`                                              | Simplest; multi-turn capable          |
| Streaming server (SSE, WebSocket) | `createAgentRuntime + createSession`                       | Full event system                     |
| Custom tools + streaming          | `createSession({ additionalTools })`                       | Tools AND events together             |
| Bot with conversation memory      | `createSession({ resumeSessionId })`                       | Resumes persisted session             |
| Serverless / no filesystem        | `createStatelessRuntime`                                   | No session store, no-op settings      |
| Batch processing                  | `createQuery` with `Promise.all`                           | Parallel queries                      |
| Structured JSON output            | `createQuery({ responseFormat: { type: 'json_object' } })` | Instructs provider to emit valid JSON |

## Layer overview

```
createFunctionTool()        →  @robota-sdk/agent-tools  (tool definition)
Robota / createFunctionTool →  @robota-sdk/agent-core   (low-level, no events)
createAgentRuntime/Session  →  @robota-sdk/agent-framework  (events, permissions, sessions)
createQuery()               →  @robota-sdk/agent-framework  (convenience wrapper)
```

## createQuery — single-shot queries

The simplest embedding. Returns a bound async function; call it repeatedly for
multi-turn conversations (the session is preserved internally).

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const query = createQuery({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  onTextDelta: (delta) => process.stdout.write(delta), // optional streaming
});

const answer = await query('What files are in the project?');
```

With custom tools:

<!-- doc-example-skip: fragment — elided parameters object -->

```typescript
import { createFunctionTool } from '@robota-sdk/agent-tools';

const calculatorTool = createFunctionTool(
  { name: 'calculate', description: 'Evaluate a math expression', parameters: { ... } },
  async ({ expression }) => ({ result: eval(expression) }),
);

const query = createQuery({
  provider,
  additionalTools: [calculatorTool],
});
```

## createAgentRuntime — streaming server

Use when you need real-time text streaming or tool execution events.

```typescript
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

declare const apiKey: string;

const runtime = createAgentRuntime({
  cwd: process.cwd(),
  provider: new AnthropicProvider({ apiKey }),
});

// Per-request handler (Next.js App Router example)
export async function POST(request: Request): Promise<Response> {
  const { message } = await request.json();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const session = runtime.createSession({
        permissionMode: 'bypassPermissions',
        bare: true,
      });

      session.on('text_delta', (delta) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: delta })}\n\n`));
      });
      session.on('complete', () => {
        controller.enqueue(encoder.encode('data: {"done":true}\n\n'));
        controller.close();
      });
      session.on('error', (err) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
        controller.close();
      });

      await session.submit(message);
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
```

### Custom tools with streaming

`additionalTools` is available on `createSession`:

```typescript
import type { IAgentRuntime } from '@robota-sdk/agent-framework';
import type { IToolWithEventService } from '@robota-sdk/agent-core';

declare const runtime: IAgentRuntime;
declare const calculatorTool: IToolWithEventService;
declare const dbLookupTool: IToolWithEventService;

const session = runtime.createSession({
  permissionMode: 'bypassPermissions',
  bare: true,
  additionalTools: [calculatorTool, dbLookupTool],
});

session.on('tool_start', ({ toolName }) => console.log('calling', toolName));
session.on('tool_end', ({ toolName, result }) => console.log('done', toolName, result));
session.on('complete', (result) => console.log(result.response));

await session.submit('What is 10% of our Q4 revenue?');
```

## Bot pattern — resuming conversations

Bots receive messages in separate requests or webhook calls. Use `resumeSessionId`
to continue the same conversation across requests.

```typescript
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { createProjectSessionStore } from '@robota-sdk/agent-framework';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

const runtime = createAgentRuntime({
  cwd: process.cwd(),
  provider,
  sessionStore: createProjectSessionStore(process.cwd()),
});

// Map channel/thread IDs to session IDs
const sessions = new Map<string, string>();

async function handleMessage(channelId: string, text: string): Promise<string> {
  const session = runtime.createSession({
    permissionMode: 'bypassPermissions',
    bare: true,
    resumeSessionId: sessions.get(channelId), // undefined on first message
  });

  return new Promise<string>((resolve) => {
    session.on('complete', (result) => {
      // Save the session ID for next message
      const id = session.sessionId;
      if (id) sessions.set(channelId, id);
      resolve(result.response);
    });
    session.submit(text).catch(console.error);
  });
}
```

## createStatelessRuntime — serverless / no filesystem

Use in Lambda, Vercel Edge Functions, or any environment where filesystem access
is restricted or undesirable.

```typescript
import { createStatelessRuntime } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

declare const apiKey: string;

const runtime = createStatelessRuntime({
  provider: new AnthropicProvider({ apiKey }),
});

// Handler — safe to call without worrying about file I/O
export const handler = async (event: { prompt: string }) => {
  const session = runtime.createSession({ permissionMode: 'bypassPermissions' });

  return new Promise<string>((resolve) => {
    session.on('complete', (result) => resolve(result.response));
    session.submit(event.prompt).catch(console.error);
  });
};
```

`createStatelessRuntime` sets `bare: true` on sessions by default. Override
per-session if you need context loading:

```typescript
import type { IAgentRuntime } from '@robota-sdk/agent-framework';

declare const runtime: IAgentRuntime;

runtime.createSession({ bare: false, permissionMode: 'bypassPermissions' });
```

## Session lifecycle

| When                                        | Action                                           |
| ------------------------------------------- | ------------------------------------------------ |
| Connection starts / bot conversation begins | Create new session                               |
| Same user's follow-up message               | Reuse or resume same session                     |
| Connection closes / conversation ends       | Call `session.shutdown()`                        |
| Request timeout                             | Call `session.abort()` then `session.shutdown()` |

For long-running servers, session objects accumulate history. If history growth
is a concern, create fresh sessions per conversation rather than reusing across users.

## Resource cleanup

Always call `session.shutdown()` when done to release internal timers and cleanup
background tracking:

```typescript
import type { IAgentRuntime } from '@robota-sdk/agent-framework';

declare const runtime: IAgentRuntime;
declare const prompt: string;

const session = runtime.createSession({ permissionMode: 'bypassPermissions' });
try {
  await new Promise<void>((resolve, reject) => {
    session.on('complete', () => resolve());
    session.on('error', reject);
    session.submit(prompt).catch(reject);
  });
} finally {
  await session.shutdown();
}
```

For `createQuery`, the session is managed internally and cleaned up automatically.

## Structured output (responseFormat)

When you need the AI to return valid JSON (data extraction, classification, structured reports),
pass `responseFormat: { type: 'json_object' }`. This is wired end-to-end from the public API
through to the provider's native JSON mode.

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

declare const apiKey: string;

const query = createQuery({
  provider: new AnthropicProvider({ apiKey }),
  responseFormat: { type: 'json_object' },
});

const raw = await query('Classify this text: "TypeScript is great for large codebases."');
const result = JSON.parse(raw);
// result: { sentiment: "positive", topic: "TypeScript", confidence: 0.95 }
```

Works with `createSession` and `createAgentRuntime.createSession` too:

```typescript
import type { IAgentRuntime } from '@robota-sdk/agent-framework';

declare const runtime: IAgentRuntime;

const session = runtime.createSession({
  permissionMode: 'bypassPermissions',
  bare: true,
  responseFormat: { type: 'json_object' },
});
```

**Provider support:** OpenAI uses the native `response_format: { type: 'json_object' }` parameter.
Other providers that don't support JSON mode will produce text responses as usual — check provider
capabilities before relying on machine-parseable output.

## WebSocket server

`createAgentRuntime` sessions map naturally to WebSocket connections — one session
per connection, events forwarded as JSON messages.

<!-- doc-example-skip: imports the external `ws` package, which is not a workspace dependency -->

```typescript
import { WebSocketServer } from 'ws';
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const runtime = createAgentRuntime({
  cwd: process.cwd(),
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
});

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws) => {
  const session = runtime.createSession({
    permissionMode: 'bypassPermissions',
    bare: true,
  });

  session.on('text_delta', (delta) => ws.send(JSON.stringify({ type: 'delta', delta })));
  session.on('tool_start', ({ toolName }) =>
    ws.send(JSON.stringify({ type: 'tool_start', toolName })),
  );
  session.on('complete', (result) =>
    ws.send(JSON.stringify({ type: 'complete', response: result.response })),
  );
  session.on('error', (err) => ws.send(JSON.stringify({ type: 'error', message: err.message })));

  ws.on('message', (data) => {
    const { prompt } = JSON.parse(data.toString());
    session
      .submit(prompt)
      .catch((err) => ws.send(JSON.stringify({ type: 'error', message: err.message })));
  });

  ws.on('close', async () => {
    await session.abort();
    await session.shutdown();
  });
});
```

## Batch processing

Run multiple independent queries in parallel with `Promise.all`. Each `createQuery`
call owns its own internal session, so parallelism is safe.

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function classifyAll(texts: string[]): Promise<string[]> {
  const tasks = texts.map((text) => {
    const query = createQuery({ provider });
    return query(
      `Classify the sentiment of: "${text}". Reply with one word: positive, negative, or neutral.`,
    );
  });
  return Promise.all(tasks);
}

const results = await classifyAll(['TypeScript is great!', 'This API is confusing.', 'It works.']);
// ["positive", "negative", "neutral"]
```

For rate-limited providers, chunk the array and process sequentially or with a concurrency limit.

## Error handling

### Rate limits (429)

Configure provider-level retry via the provider options:

```typescript
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

declare const apiKey: string;

const provider = new AnthropicProvider({
  apiKey,
  maxRetries: 3, // retry up to 3 times on 429 / 529
  timeout: 60_000, // per-request timeout in ms
});
```

### Context overflow

`InteractiveSession` runs auto-compaction when the context approaches the model's
limit. For `createAgentRuntime` sessions, compaction runs transparently before
each `submit` call if the context is full.

### Submitting after shutdown

Calling `session.submit()` after `session.shutdown()` throws. Guard with a flag:

```typescript
import type { InteractiveSession } from '@robota-sdk/agent-framework';

declare const session: InteractiveSession;
declare const nextPrompt: string;

let alive = true;

session.on('complete', async () => {
  alive = false;
  await session.shutdown();
});

// elsewhere
if (alive) {
  await session.submit(nextPrompt);
}
```

## Express server example

See [`examples/express/`](../../examples/express/) for a complete Express server
using per-request `Robota` instances with custom tools and SSE streaming.

## Next.js App Router example

See [`examples/nextjs/`](../../examples/nextjs/) for a complete Next.js streaming
chat using `InteractiveSession` events and the Web Streams API.
