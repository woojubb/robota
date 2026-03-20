# Streaming

Real-time text output as the model generates tokens.

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Set up streaming callback on the provider
provider.onTextDelta = (delta) => {
  process.stdout.write(delta);
};

const agent = new Robota({
  name: 'StreamAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemMessage: 'You are a creative writer.',
  },
});

// Text appears in real-time via onTextDelta
// run() returns the complete response after streaming finishes
const response = await agent.run('Write a short poem about programming.');
console.log('\n--- Complete response ---');
console.log(response);
```

## With Sessions (SDK)

```typescript
import { createSession, loadConfig, loadContext } from '@robota-sdk/agent-sdk';

const session = createSession({
  config: await loadConfig(process.cwd()),
  context: await loadContext(process.cwd()),
  terminal,
  onTextDelta: (delta) => process.stdout.write(delta),
});

await session.run('Explain the architecture of this project');
```

The `onTextDelta` option on `createSession()` is wired to the provider automatically.
