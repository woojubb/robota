/**
 * Capability: run-isolated (stateless) mode — `retainHistory: false`.
 *
 * Default behavior accumulates history and sends ALL of it on every call (token cost
 * grows every turn). Run-isolated mode resets the store after each run: flat token
 * profile, ideal for coordinators that reconstruct context per call. This demo prints
 * the per-call input token counts for both modes so the difference is visible.
 *
 * Run: ANTHROPIC_API_KEY=... pnpm dev
 */
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Set ANTHROPIC_API_KEY.');
  process.exit(1);
}

const prompts = ['Reply with: ONE', 'Reply with: TWO', 'Reply with: THREE'];

async function measure(retainHistory: boolean): Promise<number[]> {
  const agent = new Robota({
    name: `demo-${retainHistory ? 'default' : 'isolated'}`,
    aiProviders: [new AnthropicProvider({ apiKey })],
    defaultModel: { provider: 'anthropic', model: 'claude-haiku-4-5', maxTokens: 32 },
    systemMessage: 'Follow the instruction exactly.',
    ...(retainHistory ? {} : { retainHistory: false }),
  });
  const inputTokens: number[] = [];
  for (const prompt of prompts) {
    await agent.run(prompt, {
      onExecutionEvent: (event, data) => {
        if (event === 'provider_response_normalized') {
          const response = data.response as { metadata?: { inputTokens?: number } };
          if (typeof response?.metadata?.inputTokens === 'number') {
            inputTokens.push(response.metadata.inputTokens);
          }
        }
      },
    });
  }
  await agent.destroy();
  return inputTokens;
}

const isolated = await measure(false);
const accumulating = await measure(true);
console.log(`run-isolated  (retainHistory: false): ${isolated.join(', ')} input tokens`);
console.log(`default       (accumulating)        : ${accumulating.join(', ')} input tokens`);
console.log('Flat vs growing — the accumulation default is a real cost knob.');
