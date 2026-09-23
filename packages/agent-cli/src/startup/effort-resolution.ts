import { parseModelEffort, resolveModelEffort } from '@robota-sdk/agent-framework';

import type { TUniversalValue } from '@robota-sdk/agent-core';
import type {
  ICommandEffortAdapter,
  IModelEffortResolution,
  TEffortSelection,
} from '@robota-sdk/agent-framework';
import type { IParsedCliArgs } from '../utils/cli-args.js';
import type { IResolvedPresetOptions } from '@robota-sdk/agent-preset';

/** Resolve all CLI-owned effort sources before any product surface is assembled. */
export function resolveCliModelEffort(
  args: Pick<IParsedCliArgs, 'effort'>,
  environment: NodeJS.ProcessEnv,
  settings: Record<string, TUniversalValue>,
  preset: Pick<IResolvedPresetOptions, 'effort'>,
  modelDefault: IModelEffortResolution['modelDefault'] = 'high',
): IModelEffortResolution {
  return resolveModelEffort({
    flag: args.effort,
    environment: parseModelEffort(environment.ROBOTA_EFFORT, 'ROBOTA_EFFORT'),
    settings: parseModelEffort(settings.effort, 'settings.effort'),
    preset: preset.effort,
    modelDefault,
  });
}

/** Keep the live command state aligned with the startup-selected effort. */
export function createCliEffortAdapter(initial: IModelEffortResolution): ICommandEffortAdapter {
  let current = initial;
  return {
    getResolution: () => current,
    apply: async (selection: TEffortSelection, session) => {
      const next = resolveModelEffort({
        command: selection,
        modelDefault: current.modelDefault,
      });
      await session.applyModelOptions({ effort: next.requested });
      current = next;
      return next;
    },
  };
}
