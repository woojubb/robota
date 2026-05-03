import { CLAUDE_MODELS, formatTokenCount } from '@robota-sdk/agent-core';
import type { ICommand } from '../types.js';

export const MODEL_COMMAND_DESCRIPTION = 'Change AI model';
export const MODEL_COMMAND_ARGUMENT_HINT = '<model-id>';

export function buildModelCommandSubcommands(source = 'model'): ICommand[] {
  const seen = new Set<string>();
  const commands: ICommand[] = [];
  for (const model of Object.values(CLAUDE_MODELS)) {
    if (seen.has(model.name)) continue;
    seen.add(model.name);
    commands.push({
      name: model.id,
      description: `${model.name} (${formatTokenCount(model.contextWindow).toUpperCase()})`,
      source,
    });
  }
  return commands;
}
