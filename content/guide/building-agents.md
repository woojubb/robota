# Building Agents

This guide covers building agents directly with `@robota-sdk/agent-core`, the foundation package.
`agent-core` gives you the `Robota` agent class: a conversation with one or more AI providers, tool
calling, plugins, and structured output. It reads no files and loads no project configuration.

Use it when you want full control over a small agent — a classifier, a router, a chat endpoint with
your own tools. When you want a ready-assembled agent with built-in file and shell tools, permission
prompts, project instructions and session persistence, use `@robota-sdk/agent-framework` instead
(see [Using the SDK](./sdk.md)).

## The Robota class

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  },
  systemMessage: 'You are a helpful assistant.',
});

const response = await agent.run('Hello!');
```

### Configuration (`IAgentConfig`)

The most-used fields:

| Field                                           | Type                      | Required | Description                                                           |
| ----------------------------------------------- | ------------------------- | -------- | --------------------------------------------------------------------- |
| `name`                                          | `string`                  | yes      | Agent name, used in logs and events                                   |
| `aiProviders`                                   | `IAIProvider[]`           | yes      | Provider instances the agent may use                                  |
| `defaultModel.provider`                         | `string`                  | yes      | Name of the provider to use (must match one in `aiProviders`)         |
| `defaultModel.model`                            | `string`                  | yes      | Model identifier, e.g. `claude-sonnet-4-6`                            |
| `defaultModel.temperature`, `maxTokens`, `topP` | `number`                  | no       | Generation defaults for every run                                     |
| `defaultModel.toolChoice`                       | `TToolChoice`             | no       | Default tool-call directive (see [Decision agents](#decision-agents)) |
| `systemMessage`                                 | `string`                  | no       | System prompt                                                         |
| `tools`                                         | `IToolWithEventService[]` | no       | Tools the model may call (for example `FunctionTool` instances)       |
| `plugins`                                       | `IPluginContract[]`       | no       | Plugins, usually `AbstractPlugin` subclasses                          |
| `retainHistory`                                 | `boolean`                 | no       | `false` makes each run start from a fresh conversation                |
| `maxExecutionRounds`                            | `number`                  | no       | Default cap on model/tool rounds per run (`0` = no cap)               |

### Methods

| Method                          | Description                                                              |
| ------------------------------- | ------------------------------------------------------------------------ |
| `run(input, options?)`          | Send a message and resolve with the reply. Tool calls run automatically. |
| `runStream(input, options?)`    | Same, as an async generator that yields text chunks as they arrive.      |
| `getHistory()`                  | The conversation as `TUniversalMessage[]`.                               |
| `clearHistory()`                | Start a new conversation on the same instance.                           |
| `setModel({ provider, model })` | Switch provider and model for later runs.                                |
| `destroy()`                     | Release plugins, modules and listeners (see [destroy()](#destroy)).      |

`run()` accepts per-run options (`IRunOptions`), including `signal`, `onTextDelta`, `toolChoice`,
`maxExecutionRounds`, `temperature`, `maxTokens` and `output`.

## AI providers

Each provider package implements `IAIProvider` from `agent-core` and translates between Robota's
message format and the vendor API. Options for every provider are in the
[Providers Reference](./providers.md).

```typescript
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';
import {
  DeepSeekProvider,
  GemmaProvider,
  QwenProvider,
} from '@robota-sdk/agent-provider-openai-compatible';

const anthropic = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
const gemini = new GeminiProvider({
  apiKey: process.env.GEMINI_API_KEY!,
  defaultModel: 'gemini-3-flash-preview',
});

// A Gemma-family model served by LM Studio or another OpenAI-compatible endpoint
const gemma = new GemmaProvider({
  apiKey: 'lm-studio',
  baseURL: 'http://localhost:1234/v1',
  defaultModel: 'my-local-gemma-model',
});

const qwen = new QwenProvider({ apiKey: process.env.DASHSCOPE_API_KEY, defaultModel: 'qwen-plus' });
const deepseek = new DeepSeekProvider({
  apiKey: process.env.DEEPSEEK_API_KEY,
  defaultModel: 'deepseek-v4-flash',
  thinking: 'enabled',
  reasoningEffort: 'high',
});
```

The provider names used in `defaultModel.provider` are `anthropic`, `openai`, `gemini`, `gemma`,
`qwen` and `deepseek`.

A few provider-specific notes:

- **Anthropic** has built-in metadata (context window, output limit) for `claude-opus-4-6`,
  `claude-sonnet-4-6`, `claude-haiku-4-5` and the Claude 4.5 models. Unless you set `maxTokens`, a
  request asks for the model's full output limit (64K tokens for Sonnet 4.6, 128K for Opus 4.6). The
  provider always uses Anthropic's streaming API, even without a text callback, so long requests
  are not cut off by the SDK's timeout for non-streaming calls. It can also use Anthropic's hosted
  web search (`web_search_20250305`) when native web tools are requested; its `onServerToolUse`
  callback fires when a search runs.
- **Gemini** sends the system prompt as `systemInstruction` and accepts `responseSchema` or
  `responseJsonSchema`, `safetySettings` and `thinkingConfig` options.
- **Gemma** filters Gemma's reasoning markers and turns tool calls written as text into real tool
  calls.
- **Qwen** can enable its own hosted web search and extraction with `builtInWebTools`.
- Hosted tools like these run at the vendor, separately from Robota's local tools, and never pass
  through Robota's permission checks. Set `withholdHostedTools: true` on a run to leave them out.
- OpenAI-compatible local endpoints such as LM Studio support ordinary function calling. They are
  not treated as having hosted web search, so give the agent Robota's `WebSearch`/`WebFetch` tools
  when it needs the web.

### Several providers in one agent

```typescript
import { Robota } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const anthropicProvider: IAIProvider;
declare const openaiProvider: IAIProvider;
declare const geminiProvider: IAIProvider;
declare const qwenProvider: IAIProvider;

const agent = new Robota({
  name: 'FlexAgent',
  aiProviders: [anthropicProvider, openaiProvider, geminiProvider, qwenProvider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
});

// Switch at any time; the conversation history is kept
agent.setModel({ provider: 'openai', model: 'gpt-5.1' });
agent.setModel({ provider: 'gemini', model: 'gemini-3-pro-preview' });
agent.setModel({ provider: 'qwen', model: 'qwen-plus' });
```

## Tools

Tools let the model call your functions during a run. The model decides when to call a tool; the
agent executes it, sends the result back, and continues until the model replies without a tool call.
A tool that throws does not end the run: the failure is returned to the model as the tool's result.

### Creating tools with Zod

`createZodFunctionTool(name, description, schema, handler)` from `@robota-sdk/agent-tools` validates
the model's arguments against a Zod schema before calling your handler.

```typescript
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

const weatherTool = createZodFunctionTool(
  'get_weather',
  'Get the current weather for a city',
  z.object({
    city: z.string().describe('City name'),
    unit: z.enum(['celsius', 'fahrenheit']).optional(),
  }),
  async ({ city, unit }) => {
    return { city, unit: unit ?? 'celsius', temperature: 21 };
  },
);
```

### Creating tools with a JSON schema

`createFunctionTool(name, description, parameters, handler)` takes a JSON-schema `parameters`
object instead. It builds the same `FunctionTool` class that `agent-core` exports; you can also
construct `new FunctionTool(schema, handler)` directly.

```typescript
import { createFunctionTool } from '@robota-sdk/agent-tools';

const timeTool = createFunctionTool(
  'current_time',
  'Get the current date and time',
  {
    type: 'object',
    properties: {
      timezone: { type: 'string', description: 'IANA timezone, e.g. Asia/Seoul' },
    },
  },
  async (params) => {
    const timeZone = typeof params.timezone === 'string' ? params.timezone : 'UTC';
    return new Date().toLocaleString('en-US', { timeZone });
  },
);
```

### Registering tools

```typescript
import { Robota } from '@robota-sdk/agent-core';
import type { FunctionTool, IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;
declare const weatherTool: FunctionTool;
declare const timeTool: FunctionTool;

const agent = new Robota({
  name: 'ToolAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: [weatherTool, timeTool],
});

const response = await agent.run('What time is it in Seoul, and is it warm there?');
```

### Built-in tools

`@robota-sdk/agent-tools` also ships the tools the `robota` CLI gives its agent. File and shell tools
are factories that take the directory they may work in — `createReadTool({ cwd })` — because a file
tool with no root would have no boundary.

| Factory or instance   | Tool name         | What it does                                                      |
| --------------------- | ----------------- | ----------------------------------------------------------------- |
| `createShellTool`     | `Shell`           | Runs a command in the host shell (bash, or PowerShell on Windows) |
| `createBashTool`      | `Bash`            | The same tool under the name models commonly expect               |
| `createReadTool`      | `Read`            | Reads a file with line numbers                                    |
| `createWriteTool`     | `Write`           | Writes a file                                                     |
| `createEditTool`      | `Edit`            | Replaces a string in a file                                       |
| `createGlobTool`      | `Glob`            | Finds files by glob pattern                                       |
| `createGrepTool`      | `Grep`            | Searches file contents with a regular expression                  |
| `webFetchTool`        | `WebFetch`        | Fetches a URL and returns its text                                |
| `webSearchTool`       | `WebSearch`       | Web search through the Brave Search API (`BRAVE_API_KEY`)         |
| `askUserQuestionTool` | `AskUserQuestion` | Asks the user a question and waits for the answer                 |

`createDefaultTools({ cwd })` from `@robota-sdk/agent-tool-defaults` returns this whole set at once.
When you give these tools to a bare `Robota`, no permission prompts run — the agent can use them
freely. `agent-framework` wraps them with permission checks; see
[Permissions and Hooks](./permissions-and-hooks.md).

### Decision agents

For routers, orchestrators and classifiers, the useful output is a tool call, not prose. Normally,
when a run stops at its round cap right after a tool call, the agent makes one more model call to get
a text summary. Set `maxExecutionRounds: 1` together with `allowToolOnlyCompletion: true` to end the
run on the tool call itself and skip that extra call. Read the decision from your tool's handler; the
returned text may be empty.

```typescript
import { z } from 'zod';
import { Robota } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';

declare const provider: IAIProvider;

let decision: string | undefined;
const routeTool = createZodFunctionTool(
  'route',
  'Choose the team that should handle the ticket',
  z.object({ team: z.enum(['billing', 'bugs', 'sales']) }),
  async ({ team }) => {
    decision = team;
    return `routed to ${team}`;
  },
);

const router = new Robota({
  name: 'Router',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  tools: [routeTool],
});

await router.run('Ticket: "I was charged twice this month."', {
  toolChoice: { tool: 'route' },
  maxExecutionRounds: 1,
  allowToolOnlyCompletion: true,
});
// decision === 'billing'
```

`toolChoice` directs tool use for a run (or for every run, through `defaultModel.toolChoice`):
`'auto'` lets the model decide, `'none'` suppresses tool calls, `'required'` forces some tool call,
and `{ tool: name }` forces the named tool. Forcing applies to the run's first model call only;
later rounds go back to `'auto'` so the model can read tool results and finish.

### Structured output

For a fixed-shape answer, pass a schema as `output`. `run()` then resolves to the validated object
instead of a string. The schema goes to the provider's native structured-output feature where one
exists, and the reply is always validated. A reply that fails validation is retried with the errors
fed back (`outputRetries`, default 2); if retries run out, `run()` throws `StructuredOutputError`.

```typescript
import { z } from 'zod';
import type { Robota } from '@robota-sdk/agent-core';

declare const agent: Robota;

const sentiment = await agent.run('Classify: "The new API is confusing."', {
  output: z.object({
    label: z.enum(['positive', 'negative', 'neutral']),
    confidence: z.number(),
  }),
});
// sentiment.label is typed as 'positive' | 'negative' | 'neutral'
```

## Plugins

Plugins add cross-cutting behavior — logging, usage tracking, limits, webhooks — by overriding
lifecycle hooks.

### Using plugins

`EventEmitterPlugin` is built into `agent-core`. `@robota-sdk/agent-plugin` provides eight more:

| Plugin                      | Purpose                                              |
| --------------------------- | ---------------------------------------------------- |
| `LoggingPlugin`             | Logging to the console, a file, or a remote endpoint |
| `UsagePlugin`               | Token usage and cost tracking                        |
| `PerformancePlugin`         | Performance metrics                                  |
| `ExecutionAnalyticsPlugin`  | Execution statistics                                 |
| `ErrorHandlingPlugin`       | Error handling strategies                            |
| `LimitsPlugin`              | Rate, token and cost limits                          |
| `ConversationHistoryPlugin` | Persisting conversation history                      |
| `WebhookPlugin`             | HTTP notifications on agent events                   |

```typescript
import { Robota } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';
import { LoggingPlugin } from '@robota-sdk/agent-plugin';

declare const provider: IAIProvider;

const agent = new Robota({
  name: 'PluginAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  plugins: [new LoggingPlugin({ strategy: 'console' })],
});
```

### Lifecycle hooks

`Robota` calls these hooks on every plugin that defines them:

| Hook                                                                    | When it runs                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `beforeRun(input, options)`                                             | At the start of `run()`, after the user message is recorded   |
| `onMessageAdded(message)`                                               | Each time a user or assistant message is added to the history |
| `beforeExecution(context)`                                              | Before the first model call of the run                        |
| `beforeProviderCall(messages)`                                          | Before each model call                                        |
| `afterProviderCall(messages, response)`                                 | After each model reply                                        |
| `afterRun(input, response, options)`                                    | After the run finishes                                        |
| `afterExecution(context, result)`, `afterConversation(context, result)` | After the run finishes, with its result                       |
| `afterToolExecution(context, result)`                                   | After the run finishes, if it called any tools                |
| `onError(error, context)`                                               | When the run fails                                            |

A hook that throws is logged as a warning; it does not fail the run.

### Writing a plugin

Extend `AbstractPlugin` and override the hooks you need:

```typescript
import { AbstractPlugin } from '@robota-sdk/agent-core';

class ResponseLengthPlugin extends AbstractPlugin {
  readonly name = 'response-length';
  readonly version = '1.0.0';

  override async afterRun(input: string, response: string): Promise<void> {
    console.log(`Replied to ${input.length} chars with ${response.length} chars`);
  }
}
```

## Streaming

`runStream()` yields text as the model produces it and returns the complete reply at the end:

```typescript
import type { Robota } from '@robota-sdk/agent-core';

declare const agent: Robota;

for await (const chunk of agent.runStream('Write a haiku about TypeScript')) {
  process.stdout.write(chunk);
}
```

With `run()`, pass an `onTextDelta` callback instead:

```typescript
import type { Robota } from '@robota-sdk/agent-core';

declare const agent: Robota;

const full = await agent.run('Write a haiku about TypeScript', {
  onTextDelta: (delta) => process.stdout.write(delta),
});
```

## Conversation history

A `Robota` instance keeps its conversation across `run()` calls. Every message has an `id` and a
`state` of `'complete'` or `'interrupted'`.

```typescript
import { Robota } from '@robota-sdk/agent-core';
import type { IAgentConfig } from '@robota-sdk/agent-core';

declare const config: IAgentConfig;

const agent = new Robota(config);

await agent.run('My name is Alice.');
const response = await agent.run('What is my name?');
// "Your name is Alice."

const history = agent.getHistory(); // TUniversalMessage[]
agent.clearHistory();
```

### History lifetime and cost

The history grows for the lifetime of the instance, and the **whole history is sent to the provider
on every call**, so token cost rises with every turn until you act:

- `clearHistory()` starts over. The configured `systemMessage` is kept and applied again on the next
  run.
- One `Robota` instance is one conversation. For independent requests (for example one per HTTP
  request), create an instance per conversation rather than sharing one.
- History is append-only; there is no API to edit or delete a message.
- **Run-isolated mode:** set `retainHistory: false` and each run sees only the system prompt and its
  own input; the history resets when the run settles. Use it for coordinators that rebuild context
  on every call. In this mode `getHistory()` is empty after a run — read the reply from `run()`.

```typescript
import { Robota } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

const stateless = new Robota({
  name: 'Coordinator',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  systemMessage: 'Answer in one sentence.',
  retainHistory: false,
});

await stateless.run('First');
await stateless.run('Second'); // sends the system prompt and "Second" only
```

### Interrupted replies

Pass an `AbortSignal` as `signal` to stop a run. Aborting does not throw: `run()` resolves with the
text committed so far (possibly `''`), and a reply cut off mid-stream stays in the history with
`state: 'interrupted'`. Check `signal.aborted` to tell an interrupted run from a finished one. When
the history is sent to the model again, an interrupted reply is marked
`[This response was interrupted by the user]` so the model knows it was cut short.

## Execution contracts

Guarantees of `run()` and `runStream()` that matter when you host an agent in production.

### Execution rounds

A **round** is one model call plus the execution of every tool call that reply asked for. A reply
with no tool calls ends the run, so a plain question and answer is one round. `maxExecutionRounds`
caps rounds within one `run()`; it is not a tool-count limit or a conversation-turn limit. Set it
per run or in the config; `0` means no cap. `maxSameToolInputs` separately stops a run that calls the
same tool with identical input too many times (it throws `SameToolInputLoopError`).

```typescript
import type { Robota } from '@robota-sdk/agent-core';

declare const agent: Robota;

await agent.run('Research this topic and summarize.', { maxExecutionRounds: 5 });
```

### Concurrency

One instance owns one conversation, so concurrent `run()`/`runStream()` calls on the same instance
are **queued and run one after another** — calls never interleave their messages. A queued call whose
`signal` fires while it waits fails with an `AbortError` without reaching the provider or the
history. `runStream()` keeps
its place in the queue until the stream is fully consumed. Separate instances run fully in parallel.

### destroy()

`destroy()` is best-effort and never rejects because of a cleanup failure, so `void agent.destroy()`
is safe. Every cleanup step (modules, plugin subscriptions, event listeners) runs even if an earlier
one fails; failures are logged and returned as `{ errors: Error[] }`:

```typescript
import type { Robota } from '@robota-sdk/agent-core';

declare const agent: Robota;

const { errors } = await agent.destroy();
if (errors.length > 0) {
  // cleanup failures — already logged; decide whether to alert
}
```

`Session.shutdown()` in `agent-session` follows the same rule.

## Errors

Errors thrown by the SDK extend `RobotaError`, which carries a `code`, a `category` and a
`recoverable` flag. Provider failures arrive as `RateLimitError`, `AuthenticationError`,
`ModelNotAvailableError`, `NetworkError` or, for anything else, `ProviderError` (which carries the HTTP
`status`). See [Error Handling](./error-handling.md) for the full list and retry patterns.
