# Multi-Provider

Register several providers on one agent and switch the model between runs. Each provider lives in its
own package; DeepSeek, Qwen and Gemma share `@robota-sdk/agent-provider-openai-compatible`.

```typescript
import { ConversationAgent } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';
import {
  DeepSeekProvider,
  GemmaProvider,
  QwenProvider,
} from '@robota-sdk/agent-provider-openai-compatible';

const agent = new ConversationAgent({
  name: 'MultiAgent',
  aiProviders: [
    new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
    new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
    new DeepSeekProvider({
      apiKey: process.env.DEEPSEEK_API_KEY,
      defaultModel: 'deepseek-v4-flash',
    }),
    new GeminiProvider({
      apiKey: process.env.GEMINI_API_KEY!,
      defaultModel: 'gemini-3-flash-preview',
    }),
    // A local OpenAI-compatible server such as LM Studio
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
  },
  systemMessage: 'You are a helpful assistant.',
});

// Start with Claude
let response = await agent.run('Hello!');
console.log('Claude:', response);

// Switch to OpenAI
agent.setModel({ provider: 'openai', model: 'gpt-5.1' });
response = await agent.run('Which model are you?');
console.log('OpenAI:', response);

// Switch to Gemini
agent.setModel({ provider: 'gemini', model: 'gemini-3-pro-preview' });
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

// Switch to DeepSeek
agent.setModel({ provider: 'deepseek', model: 'deepseek-v4-flash' });
response = await agent.run('Give one concise implementation risk.');
console.log('DeepSeek:', response);
```

`setModel()` takes the provider's `name` (`anthropic`, `openai`, `deepseek`, `gemini`, `gemma`,
`qwen`) and a model id. The conversation history stays with the agent, so the next provider receives
the full context. Each provider converts it to its own wire format; for Gemini, for example, the
system message becomes `systemInstruction` and tool results become `functionResponse` parts.

To reach any other OpenAI-compatible endpoint (a gateway, Azure, vLLM, Ollama), give
`OpenAIProvider` a `baseURL`;
[examples/capabilities/openai-compatible-gateway](../../examples/capabilities/openai-compatible-gateway/README.md)
shows it. The [providers guide](../guide/providers.md) covers each provider's options.
