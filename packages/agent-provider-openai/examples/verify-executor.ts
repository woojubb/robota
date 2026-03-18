import { LocalExecutor } from '@robota-sdk/agent-core';
import type { TUniversalMessage } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '../src/provider.ts';

async function collectStream(provider: OpenAIProvider): Promise<string> {
  let output = '';
  for await (const chunk of provider.chatStream(
    [{ role: 'user', content: 'verify-openai-stream', timestamp: new Date() }],
    { model: 'gpt-4o-mini' },
  )) {
    output += typeof chunk.content === 'string' ? chunk.content : '';
  }
  return output;
}

async function main(): Promise<void> {
  const executor = new LocalExecutor();
  executor.registerProvider('openai', {
    name: 'openai',
    async chat(messages: TUniversalMessage[]): Promise<TUniversalMessage> {
      const last = messages.at(-1);
      const content = typeof last?.content === 'string' ? last.content : '';
      return {
        role: 'assistant',
        content: `executor:${content}`,
        timestamp: new Date(),
      };
    },
    async *chatStream(messages: TUniversalMessage[]): AsyncIterable<TUniversalMessage> {
      const last = messages.at(-1);
      const content = typeof last?.content === 'string' ? last.content : '';
      yield {
        role: 'assistant',
        content: 'stream:',
        timestamp: new Date(),
      };
      yield {
        role: 'assistant',
        content,
        timestamp: new Date(),
      };
    },
    supportsTools: () => true,
    validateConfig: () => true,
    dispose: async () => undefined,
  });

  const provider = new OpenAIProvider({ executor });
  const response = await provider.chat(
    [{ role: 'user', content: 'verify-openai-run', timestamp: new Date() }],
    { model: 'gpt-4o-mini' },
  );

  if (response.content !== 'executor:verify-openai-run') {
    throw new Error(`Unexpected executor chat response: ${String(response.content)}`);
  }

  const streamed = await collectStream(provider);
  if (streamed !== 'stream:verify-openai-stream') {
    throw new Error(`Unexpected executor stream response: ${streamed}`);
  }

  const directProvider = new OpenAIProvider({ apiKey: 'sk-test-key' });
  if (!directProvider.validateConfig()) {
    throw new Error('Direct OpenAI provider configuration should validate.');
  }

  await provider.dispose();
  await directProvider.dispose();
  process.stdout.write('openai executor verify passed.\n');
}

void main();
