import { fileURLToPath } from 'node:url';

import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

import type {
  IModelEffortOutcome,
  TModelEffortSelection,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import { loadVercelAiGatewayModelEffortConfig } from '../src/openai/model-effort-verification-config';

function userMessage(content: string): TUniversalMessage {
  return {
    id: `model-effort-example-${Date.now()}`,
    role: 'user',
    content,
    state: 'complete',
    timestamp: new Date(),
  };
}

async function main(): Promise<void> {
  const configuration = loadVercelAiGatewayModelEffortConfig(
    process.env,
    fileURLToPath(new URL('../../../.env.local', import.meta.url)),
  );
  const requested = process.argv.slice(2);
  const selections = (
    requested.length > 0 ? requested : ['high', 'max', 'auto']
  ) as TModelEffortSelection[];
  const provider = new OpenAIProvider({
    apiKey: configuration.apiKey,
    baseURL: configuration.baseURL,
    defaultModel: configuration.model,
  });

  for (const effort of selections) {
    const outcomes: IModelEffortOutcome[] = [];
    await provider.chat([userMessage('Reply with OK.')], {
      model: configuration.model,
      effort,
      onModelEffortOutcome: (outcome) => outcomes.push(outcome),
    });
    const outcome = outcomes.at(-1);
    if (outcome === undefined) throw new Error(`No model-effort outcome for ${effort}`);
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
  }
  process.stdout.write('OPENAI_MODEL_EFFORT_PASS\n');
}

void main();
