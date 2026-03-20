/**
 * Agent "templates" example for @robota-sdk/agent-core.
 *
 * This is NOT a team API. It is simply multiple independent Robota instances with different
 * providers/models/system prompts.
 *
 * Requirements:
 * - OPENAI_API_KEY
 * - ANTHROPIC_API_KEY
 * - (optional) ANTHROPIC_MODEL
 */

import { Robota } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

function readEnvString(key: string): string | undefined {
  const raw = process.env[key];
  if (!raw) return undefined;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function main(): Promise<void> {
  const openaiApiKey = readEnvString('OPENAI_API_KEY');
  const anthropicApiKey = readEnvString('ANTHROPIC_API_KEY');
  if (!openaiApiKey) throw new Error('OPENAI_API_KEY environment variable is required');
  if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY environment variable is required');

  const anthropicModel = readEnvString('ANTHROPIC_MODEL') ?? 'claude-3-haiku-20240307';

  const researchAgent = new Robota({
    name: 'ResearchAgent',
    aiProviders: [new AnthropicProvider({ apiKey: anthropicApiKey })],
    defaultModel: {
      provider: 'anthropic',
      model: anthropicModel,
      systemMessage:
        'You are a market research and analysis specialist. Focus on data-driven insights and structured analysis.',
    },
  });

  const creativeAgent = new Robota({
    name: 'CreativeAgent',
    aiProviders: [new OpenAIProvider({ apiKey: openaiApiKey })],
    defaultModel: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.8,
      systemMessage:
        'You are a creative ideation specialist. Propose innovative, practical ideas with strong user value.',
    },
  });

  const coordinatorAgent = new Robota({
    name: 'CoordinatorAgent',
    aiProviders: [new OpenAIProvider({ apiKey: openaiApiKey })],
    defaultModel: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.4,
      systemMessage:
        'You are a project coordinator. Synthesize inputs into a concise, actionable plan.',
    },
  });

  const topic = 'AI-based personalized health monitoring solution';

  const researchTask = `Analyze the market for ${topic}. Provide a structured analysis with key competitors and opportunities.`;
  const researchResult = await researchAgent.run(researchTask);

  const creativeTask = `Generate three product ideas for ${topic} with key differentiators and features.`;
  const creativeResult = await creativeAgent.run(creativeTask);

  const coordinationTask =
    `Synthesize the following into a cohesive plan:\n\n` +
    `MARKET RESEARCH:\n${researchResult}\n\n` +
    `IDEAS:\n${creativeResult}\n\n` +
    `Return: 1) summary 2) recommended concept 3) next steps.`;
  const finalResult = await coordinatorAgent.run(coordinationTask);

  // eslint-disable-next-line no-console -- examples CLI entrypoint
  console.log(finalResult);

  await researchAgent.destroy();
  await creativeAgent.destroy();
  await coordinatorAgent.destroy();
}

main().catch((error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  // eslint-disable-next-line no-console -- examples CLI entrypoint
  console.error(err.message);
  process.exit(1);
});
