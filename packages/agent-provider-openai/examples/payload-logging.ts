/**
 * Payload logging example for @robota-sdk/agent-provider-openai.
 *
 * Requirements:
 * - OPENAI_API_KEY
 *
 * Note:
 * - This example writes payload log files under ./logs/ relative to the current working directory.
 */

import { Robota } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const provider = new OpenAIProvider({
    apiKey,
    enablePayloadLogging: true,
    payloadLogDir: './logs/openai-payloads',
    includeTimestampInLogFiles: true,
  });

  const agent = new Robota({
    name: 'PayloadLogger',
    aiProviders: [provider],
    defaultModel: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemMessage: 'You are a helpful assistant.',
    },
  });

  const response = await agent.run('Tell me a fun fact about space in one sentence.');
  // eslint-disable-next-line no-console -- examples CLI entrypoint
  console.log(response);

  await agent.destroy();
}

main().catch((error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  // eslint-disable-next-line no-console -- examples CLI entrypoint
  console.error(err.message);
  process.exit(1);
});
