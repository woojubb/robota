# Multi-Provider

Register multiple providers and switch between them dynamically.

> **Note**: `@robota-sdk/agent-provider-openai` and `@robota-sdk/agent-provider-google` are not yet published to npm. This example works within the monorepo.

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { GoogleProvider } from '@robota-sdk/agent-provider-google';

const agent = new Robota({
  name: 'MultiAgent',
  aiProviders: [
    new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
    new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
    new GoogleProvider({ apiKey: process.env.GOOGLE_API_KEY }),
  ],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemMessage: 'You are a helpful assistant.',
  },
});

// Start with Claude
let response = await agent.run('Hello!');
console.log('Claude:', response);

// Switch to GPT-4
agent.setModel({ provider: 'openai', model: 'gpt-4o' });
response = await agent.run('Now you are GPT-4. What model are you?');
console.log('GPT-4:', response);

// Switch to Gemini
agent.setModel({ provider: 'google', model: 'gemini-1.5-pro' });
response = await agent.run('And now?');
console.log('Gemini:', response);
```

Conversation history is preserved across provider switches. The new provider sees the full context.
