/**
 * Multi-provider example for @robota-sdk/agent-core.
 *
 * Requirements:
 * - OPENAI_API_KEY
 */

import { Robota } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

async function testProvider(providerName: string, robota: Robota, query: string): Promise<void> {
  // eslint-disable-next-line no-console -- examples CLI entrypoint
  console.log(`\n${'='.repeat(50)}`);
  // eslint-disable-next-line no-console -- examples CLI entrypoint
  console.log(`🤖 Testing ${providerName.toUpperCase()} Provider`);
  // eslint-disable-next-line no-console -- examples CLI entrypoint
  console.log(`${'='.repeat(50)}`);
  // eslint-disable-next-line no-console -- examples CLI entrypoint
  console.log(`User: ${query}`);

  const response = await robota.run(query);
  // eslint-disable-next-line no-console -- examples CLI entrypoint
  console.log(`Assistant: ${response}`);
}

async function main(): Promise<void> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const openai35Provider = new OpenAIProvider({ apiKey: openaiKey });
  const robota35 = new Robota({
    name: 'GPT35Agent',
    aiProviders: [openai35Provider],
    defaultModel: {
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      systemMessage: 'You are a helpful assistant powered by OpenAI GPT-3.5.',
    },
  });

  await testProvider(
    'OpenAI GPT-3.5',
    robota35,
    'Tell me about artificial intelligence in 2-3 sentences.',
  );

  const openai4MiniProvider = new OpenAIProvider({ apiKey: openaiKey });
  const robota4Mini = new Robota({
    name: 'GPT4MiniAgent',
    aiProviders: [openai4MiniProvider],
    defaultModel: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemMessage: 'You are a helpful assistant powered by OpenAI GPT-4o-mini.',
    },
  });

  await testProvider(
    'OpenAI GPT-4o-mini',
    robota4Mini,
    'Tell me about artificial intelligence in 2-3 sentences.',
  );

  await robota35.destroy();
  await robota4Mini.destroy();
}

main().catch((error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  // eslint-disable-next-line no-console -- examples CLI entrypoint
  console.error(err.message);
  process.exit(1);
});
