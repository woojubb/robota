# Multi-Provider

Register multiple providers and switch between them dynamically.

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';
import { GemmaProvider } from '@robota-sdk/agent-provider-gemma';
import { QwenProvider } from '@robota-sdk/agent-provider-qwen';

const agent = new Robota({
  name: 'MultiAgent',
  aiProviders: [
    new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
    new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
    new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY }),
    new GemmaProvider({
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
      defaultModel: 'gemma-local-model',
    }),
    new QwenProvider({
      apiKey: process.env.DASHSCOPE_API_KEY,
      defaultModel: 'qwen-plus',
    }),
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
agent.setModel({ provider: 'gemini', model: 'gemini-2.5-pro' });
response = await agent.run('And now?');
console.log('Gemini:', response);

// Switch to local Gemma
agent.setModel({ provider: 'gemma', model: 'gemma-local-model' });
response = await agent.run('Summarize the conversation locally.');
console.log('Gemma:', response);

// Switch to Qwen/DashScope
agent.setModel({ provider: 'qwen', model: 'qwen-plus' });
response = await agent.run('Give one closing recommendation.');
console.log('Qwen:', response);
```

Conversation history is preserved across provider switches. The new provider sees the full context.
