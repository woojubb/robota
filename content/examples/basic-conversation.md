# Basic Conversation

A simple agent that maintains conversation history across turns.

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
    systemMessage: 'You are a friendly conversational assistant.',
  },
});

// Multi-turn conversation — history is maintained automatically
const r1 = await agent.run('My name is Alice and I work on TypeScript projects.');
console.log('Agent:', r1);

const r2 = await agent.run('What do you know about me?');
console.log('Agent:', r2);
// Will reference Alice and TypeScript from the first message

// Access conversation history
const history = agent.getHistory();
console.log(`${history.length} messages in history`);

// Start fresh
agent.clearHistory();
```
