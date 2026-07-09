/**
 * Basic conversation example for @robota-sdk/agent-core.
 *
 * Requirements:
 * - OPENAI_API_KEY
 */

import { Robota } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const robota = new Robota({
    name: 'BasicAgent',
    aiProviders: [new OpenAIProvider({ apiKey })],
    defaultModel: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemMessage: 'You are a helpful assistant. Provide concise and useful responses.',
    },
  });

  const query = 'Hi, what is TypeScript?';
  const response = await robota.run(query);
  // eslint-disable-next-line no-console -- examples CLI entrypoint
  console.log(response);

  await robota.destroy();
}

main().catch((error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  // eslint-disable-next-line no-console -- examples CLI entrypoint
  console.error(err.message);
  process.exit(1);
});
