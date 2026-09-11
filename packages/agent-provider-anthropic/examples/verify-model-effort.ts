import { fileURLToPath } from 'node:url';

import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

import type {
  IModelEffortOutcome,
  TModelEffortSelection,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import { loadAnthropicModelEffortVerificationConfig } from '../src/anthropic/model-effort-verification-config';

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
  const configuration = loadAnthropicModelEffortVerificationConfig(
    process.env,
    fileURLToPath(new URL('../../../.env.local', import.meta.url)),
  );
  const requested = process.argv.slice(2);
  const selections = (
    requested.length > 0 ? requested : ['high', 'max', 'auto']
  ) as TModelEffortSelection[];
  const provider = new AnthropicProvider({ apiKey: configuration.apiKey });

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
  process.stdout.write('ANTHROPIC_MODEL_EFFORT_PASS\n');
}

void main();
