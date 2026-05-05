import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { IToolExecutionStepInfo } from '../block-tracking/types';
import { asObjectValue } from './event-data';

export function parseExecutionSteps(
  value: TUniversalValue | undefined,
): IToolExecutionStepInfo[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const steps: IToolExecutionStepInfo[] = [];
  value.forEach((entry, index) => {
    const candidate = asObjectValue(entry);
    const id = candidate?.id;
    const name = candidate?.name;
    const estimatedDuration = candidate?.estimatedDuration;
    const description = candidate?.description;
    if (
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      typeof estimatedDuration !== 'number'
    ) {
      return;
    }
    steps.push({
      id,
      name,
      estimatedDuration,
      description: typeof description === 'string' ? description : `Step ${index + 1}`,
    });
  });

  return steps.length > 0 ? steps : undefined;
}
