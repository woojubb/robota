/**
 * Capability: route through ANY OpenAI-compatible endpoint via `baseURL`.
 *
 * Works with AI gateways (Vercel AI Gateway, LiteLLM, OpenRouter), Azure, vLLM,
 * Ollama, LM Studio — model slugs pass through verbatim, so non-OpenAI ids like
 * `anthropic/claude-sonnet-4-5` work. Streaming rides the same protocol.
 *
 * Run:
 *   GATEWAY_BASE_URL=https://ai-gateway.vercel.sh/v1 \
 *   GATEWAY_API_KEY=... \
 *   GATEWAY_MODEL=anthropic/claude-sonnet-4-5 \
 *   pnpm dev
 */
import { Robota } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider';

const baseURL = process.env.GATEWAY_BASE_URL;
const apiKey = process.env.GATEWAY_API_KEY;
const model = process.env.GATEWAY_MODEL ?? 'gpt-4o-mini';
if (!baseURL || !apiKey) {
  console.error('Set GATEWAY_BASE_URL and GATEWAY_API_KEY (see file header).');
  process.exit(1);
}

const agent = new Robota({
  name: 'GatewayDemo',
  aiProviders: [new OpenAIProvider({ apiKey, baseURL, defaultModel: model })],
  defaultModel: { provider: 'openai', model, maxTokens: 200 },
  systemMessage: 'Answer in one short paragraph.',
});

const answer = await agent.run('Explain what an OpenAI-compatible endpoint is.', {
  onTextDelta: (delta) => process.stdout.write(delta),
});
process.stdout.write('\n---\n');
console.log(`Model slug "${model}" answered ${answer.length} chars through ${baseURL}`);
await agent.destroy();
