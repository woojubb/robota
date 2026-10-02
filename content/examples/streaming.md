# Streaming

Show text as the model generates it instead of waiting for the whole answer.

## With `runStream()`

`runStream()` is an async generator: each value is a text delta, and the generator's return value is
the complete response.

```typescript
import { ConversationAgent } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const agent = new ConversationAgent({
  name: 'StreamAgent',
  aiProviders: [new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  },
  systemMessage: 'You are a creative writer.',
});

for await (const delta of agent.runStream('Write a short poem about programming.')) {
  process.stdout.write(delta);
}
process.stdout.write('\n');
```

## With a callback on `run()`

When you want the complete response as the return value and the deltas on the side, pass
`onTextDelta` to `run()`. The callback applies to that run only.

```typescript
import { ConversationAgent } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const agent = new ConversationAgent({
  name: 'StreamAgent',
  aiProviders: [new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
});

const response = await agent.run('Write a short poem about programming.', {
  onTextDelta: (delta) => process.stdout.write(delta),
});
console.log('\n--- Complete response ---');
console.log(response);
```

[examples/capabilities/streaming](../../examples/capabilities/streaming/README.md) is a runnable
version that also streams a structured-output run, where the schema-validated object is the
generator's return value.

## With sessions

An `InteractiveSession` emits a `text_delta` event for each delta while `submit()` runs.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider,
});

session.on('text_delta', (delta) => process.stdout.write(delta));
await session.submit('Explain the architecture of this project');
```
