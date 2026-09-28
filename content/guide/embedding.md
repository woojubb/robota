# Embedding agent-framework

`@robota-sdk/agent-framework` runs outside the CLI — in HTTP servers, bots, serverless functions and
batch jobs. This guide shows the pattern for each context. It assumes you know the basics of
`InteractiveSession` and `createQuery()` from [Using the SDK](./sdk.md).

## API selection

| Use case                          | API                                                        | Notes                                        |
| --------------------------------- | ---------------------------------------------------------- | -------------------------------------------- |
| Questions from a script or CI job | `createQuery`                                              | One conversation per query function          |
| Streaming server (SSE, WebSocket) | `createAgentRuntime` + `runtime.createSession()`           | Full event stream per session                |
| Custom tools with streaming       | `runtime.createSession({ additionalTools, allowedTools })` | Tools and events together                    |
| Bot that remembers conversations  | `createAgentRuntime({ sessionStore })` + `resumeSessionId` | Resumes a saved session per channel          |
| Serverless, nothing persisted     | `createStatelessRuntime`                                   | No session store; sessions default to `bare` |
| Batch processing                  | One `createQuery` per item, run with `Promise.all`         | Independent conversations in parallel        |
| Structured JSON output            | `responseFormat`                                           | Support depends on the provider              |

## Before you deploy: tools and permissions

Every framework session gets the default tools — `Shell`, `Bash`, `Read`, `Write`, `Edit`, `Glob`,
`Grep`, `WebFetch`, `WebSearch`, `AskUserQuestion` — with file tools confined to `cwd`. On a server,
decide what the model may do before it can do it:

- Keep `permissionMode: 'default'` (the default). Reads and searches proceed; writing files, running
  commands and calling your own tools need approval, and **a request nobody answers is denied**.
- Pre-approve your own tools by name with `allowedTools: ['calculate']`, or declare what they do with
  `registerToolPermissionProfile('calculate', { riskClass: 'inspect' })` from `agent-core`.
- Remove built-in tools the agent must not have with `deniedTools: ['Shell', 'Bash', 'Write', 'Edit']`.
  A tool denied by bare name is hidden from the model entirely.
- `permissionMode: 'bypassPermissions'` lets the model run any command and edit any file under
  `cwd`. Use it only where that is acceptable, such as a disposable sandbox.

The framework reads no settings file and no project instructions unless you pass them, so a server
session behaves the same wherever it runs. See [What a session loads](./sdk.md#what-a-session-loads).

## Layer overview

```
createZodFunctionTool / createFunctionTool  →  @robota-sdk/agent-tools      (tool definitions)
Robota, FunctionTool                        →  @robota-sdk/agent-core       (engine; no sessions)
createAgentRuntime / InteractiveSession     →  @robota-sdk/agent-framework  (events, permissions, sessions)
createQuery()                               →  @robota-sdk/agent-framework  (prompt-in, text-out wrapper)
```

## createQuery — questions from code

`createQuery()` returns an async function. Each call is a new turn in the same conversation, so
follow-up questions see earlier answers. Pass `model` with any provider other than Anthropic: without
it the model comes from the settings files, and without one the session asks the provider for
`claude-opus-4-5`.

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const query = createQuery({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  onTextDelta: (delta) => process.stdout.write(delta), // optional streaming
});

const answer = await query('What files are in the project?');
```

With your own tools, list them in `allowedTools` so they run without asking (or decide per call with a
`permissionHandler`):

```typescript
import { z } from 'zod';
import { createQuery } from '@robota-sdk/agent-framework';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

const calculatorTool = createZodFunctionTool(
  'calculate',
  'Add two numbers',
  z.object({ a: z.number(), b: z.number() }),
  async ({ a, b }) => ({ result: a + b }),
);

const query = createQuery({
  provider,
  additionalTools: [calculatorTool],
  allowedTools: ['calculate'],
});

const answer = await query('What is 1234 + 5678?');
```

Things to know about a query function:

- **Calls run one at a time.** The function wraps one session, so a call made while another is
  running waits for it, then gets its own reply. For parallel work, create one query function per
  task.
- **Shut it down when you are done.** `await query.shutdown()` ends the session. A call still
  running or waiting rejects, and so does every later one.

## createAgentRuntime — streaming server

A runtime holds the shared configuration (`cwd`, provider, optional session store and command
modules); `runtime.createSession()` builds an `InteractiveSession` from it with per-session options.

```typescript
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

declare const apiKey: string;

const runtime = createAgentRuntime({
  cwd: process.cwd(),
  provider: new AnthropicProvider({ apiKey }),
});

// Next.js App Router route handler
export async function POST(request: Request): Promise<Response> {
  const { message } = (await request.json()) as { message: string };
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const session = runtime.createSession({
        bare: true,
        deniedTools: ['Shell', 'Bash', 'Write', 'Edit'],
      });
      session.on('text_delta', (delta) => send({ text: delta }));

      try {
        const handle = await session.submit(message);
        const result = await handle.completed;
        send({ done: true, interrupted: result.interrupted === true });
      } catch (error) {
        send({ error: error instanceof Error ? error.message : String(error) });
      } finally {
        controller.close();
        await session.shutdown();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
```

`handle.completed` resolves with the turn's result, or rejects with the error the turn failed on.
You can also listen for the `complete`, `interrupted` and `error` events instead.

### Custom tools with streaming

`runtime.createSession()` accepts `additionalTools`; pre-approve them with `allowedTools`:

```typescript
import type { IAgentRuntime } from '@robota-sdk/agent-framework';
import type { IToolWithEventService } from '@robota-sdk/agent-core';

declare const runtime: IAgentRuntime;
declare const calculatorTool: IToolWithEventService;
declare const dbLookupTool: IToolWithEventService;

const session = runtime.createSession({
  bare: true,
  additionalTools: [calculatorTool, dbLookupTool],
  allowedTools: ['calculate', 'db_lookup'],
  deniedTools: ['Shell', 'Bash', 'Write', 'Edit'],
});

session.on('tool_start', ({ toolName }) => console.log('calling', toolName));
session.on('tool_end', ({ toolName, result }) => console.log('done', toolName, result));

const handle = await session.submit('What is 10% of our Q4 revenue?');
console.log((await handle.completed).response);
```

## Bot pattern — resuming conversations

Bots receive each message in a separate request or webhook call. Give the runtime a session store,
and resume the saved session for each channel with `resumeSessionId`. A session is saved after every
completed turn and again on shutdown.

```typescript
import { createAgentRuntime, createNodeHostSessionStore } from '@robota-sdk/agent-framework';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

const runtime = createAgentRuntime({
  cwd: process.cwd(),
  provider,
  sessionStore: createNodeHostSessionStore('/var/lib/my-bot/sessions'),
});

// Channel or thread id → session id
const sessions = new Map<string, string>();

async function handleMessage(channelId: string, text: string): Promise<string> {
  const session = runtime.createSession({
    bare: true,
    deniedTools: ['Shell', 'Bash', 'Write', 'Edit'],
    resumeSessionId: sessions.get(channelId), // undefined for the first message
  });
  try {
    const handle = await session.submit(text);
    const result = await handle.completed;
    sessions.set(channelId, session.sessionId);
    return result.response;
  } finally {
    await session.shutdown();
  }
}
```

In production, keep the channel-to-session map somewhere durable too.

## createStatelessRuntime — serverless

`createStatelessRuntime({ provider, cwd? })` is a runtime with no session store and with settings
reads and writes from commands turned into no-ops. Its sessions default to `bare: true`. It has no
project access, so its sessions never read project files.

The default tools are still there, so deny the ones your environment should not offer:

```typescript
import { createStatelessRuntime } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

declare const apiKey: string;

const runtime = createStatelessRuntime({
  provider: new AnthropicProvider({ apiKey }),
});

export const handler = async (event: { prompt: string }): Promise<string> => {
  const session = runtime.createSession({
    deniedTools: ['Shell', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
  });
  try {
    const handle = await session.submit(event.prompt);
    return (await handle.completed).response;
  } finally {
    await session.shutdown();
  }
};
```

## Session lifecycle

| When                                           | Do                                                   |
| ---------------------------------------------- | ---------------------------------------------------- |
| A connection or conversation starts            | Create a session                                     |
| The same user sends a follow-up                | Reuse the session, or resume it by id                |
| The connection closes or the conversation ends | Call `session.shutdown()`                            |
| A request times out                            | Call `session.shutdown()` (it aborts a running turn) |

A session's history grows with every turn and is sent to the model each time. Create a fresh session
per conversation rather than sharing one across users.

`shutdown()` stops background work, saves the session if a store is configured, and removes all
listeners. Always call it when you are done:

```typescript
import type { IAgentRuntime } from '@robota-sdk/agent-framework';

declare const runtime: IAgentRuntime;
declare const prompt: string;

const session = runtime.createSession({ bare: true });
try {
  const handle = await session.submit(prompt);
  await handle.completed;
} finally {
  await session.shutdown();
}
```

## Structured output (responseFormat)

`responseFormat` asks the provider for JSON. How it reaches the model depends on the provider:

- `{ type: 'json_object' }` is sent as OpenAI's native JSON mode. The Anthropic provider has no
  equivalent and ignores it.
- `{ type: 'json_schema', name, schema }` is sent as native structured output by both the OpenAI and
  the Anthropic providers. `runtime.createSession()` accepts it; `createQuery()` accepts only `text`
  and `json_object`.

Parse the reply defensively either way.

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const query = createQuery({
  provider: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
  model: 'gpt-4o',
  responseFormat: { type: 'json_object' },
});

const raw = await query(
  'Classify "TypeScript is great for large codebases." Reply as JSON with sentiment and topic.',
);
const result = JSON.parse(raw) as { sentiment: string; topic: string };
```

```typescript
import type { IAgentRuntime } from '@robota-sdk/agent-framework';

declare const runtime: IAgentRuntime;

const session = runtime.createSession({
  bare: true,
  responseFormat: {
    type: 'json_schema',
    name: 'classification',
    schema: {
      type: 'object',
      properties: {
        sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
        topic: { type: 'string' },
      },
      required: ['sentiment', 'topic'],
    },
  },
});
```

For typed, validated objects with automatic retries, use `Robota.run(prompt, { output })` from
`agent-core`; see [Building Agents](./building-agents.md#structured-output).

## WebSocket server

One session per connection, with events forwarded as JSON messages. (For a ready-made WebSocket
carrier with the full session protocol, see `@robota-sdk/agent-transport-ws` and
[Deployment](./deployment.md).)

<!-- doc-example-skip: imports the external `ws` package, which is not a workspace dependency -->

```typescript
import { WebSocketServer } from 'ws';
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const runtime = createAgentRuntime({
  cwd: process.cwd(),
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
});

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws) => {
  const session = runtime.createSession({
    bare: true,
    deniedTools: ['Shell', 'Bash', 'Write', 'Edit'],
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
    const { prompt } = JSON.parse(data.toString()) as { prompt: string };
    session
      .submit(prompt)
      .catch((err: Error) => ws.send(JSON.stringify({ type: 'error', message: err.message })));
  });

  ws.on('close', () => {
    void session.shutdown();
  });
});
```

A prompt sent while a turn is running waits for it; if the client sends several, only the newest
waiting prompt runs.

## Batch processing

Run independent queries in parallel with one query function per item:

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function classifyAll(texts: string[]): Promise<string[]> {
  return Promise.all(
    texts.map((text) =>
      createQuery({ provider })(
        `Classify the sentiment of: "${text}". Reply with one word: positive, negative, or neutral.`,
      ),
    ),
  );
}

const results = await classifyAll(['TypeScript is great!', 'This API is confusing.', 'It works.']);
```

For rate-limited providers, split the list and limit concurrency. For large batches, prefer sessions
from a runtime so you can `shutdown()` each one when its item is done.

## Error handling

### Rate limits

The run loop does not retry a failed provider call (the vendor SDK clients inside the Anthropic and
OpenAI providers apply their own default retries). A rate limit that still fails surfaces as
`RateLimitError`, with the seconds the vendor asked to wait in `retryAfter` when it said; see
[Provider failures](./error-handling.md#provider-failures) for the other error types. Retry in your
code — see [Retrying provider failures](./error-handling.md#retrying-provider-failures).

### Context overflow

A session tracks token usage and compacts the conversation automatically: before each new turn, if
usage has passed the threshold (about 83.5% of the model's context window by default), it
summarizes the history first. See [Context Management](./context-management.md).

### Submitting after shutdown

`submit()` on a session that is shutting down or shut down rejects. Create a new session instead.

## Complete examples

- [`examples/express/`](../../examples/express/) — an Express server that creates a query function per
  request, with custom tools and SSE streaming.
- [`examples/nextjs/`](../../examples/nextjs/) — a Next.js route streaming session events with
  `createAgentRuntime`.
- [`examples/websocket-chat/`](../../examples/websocket-chat/), [`examples/slack-bot/`](../../examples/slack-bot/),
  [`examples/discord-bot/`](../../examples/discord-bot/), [`examples/telegram-bot/`](../../examples/telegram-bot/)
  — chat front ends built on `createAgentRuntime`.
- [`examples/batch-processor/`](../../examples/batch-processor/) — batch jobs with `createQuery`.
