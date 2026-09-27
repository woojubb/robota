# Basic Conversation

A `Robota` agent keeps the conversation in memory, so each `run()` sees the turns before it.

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const agent = new Robota({
  name: 'ChatBot',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  },
  systemMessage: 'You are a friendly conversational assistant.',
});

// Multi-turn conversation — history is kept automatically
const r1 = await agent.run('My name is Alice and I work on TypeScript projects.');
console.log('Agent:', r1);

const r2 = await agent.run('What do you know about me?');
console.log('Agent:', r2);
// The answer refers to Alice and TypeScript from the first message

// Read the conversation history
const history = agent.getHistory();
console.log(`${history.length} messages in history`);

// Start fresh
agent.clearHistory();
```

To send every run without the earlier turns — for example when your code rebuilds the context itself
on each call — create the agent with `retainHistory: false`.
[examples/capabilities/stateless-turns](../../examples/capabilities/stateless-turns/README.md) runs
both modes side by side and prints the input tokens of each call.
