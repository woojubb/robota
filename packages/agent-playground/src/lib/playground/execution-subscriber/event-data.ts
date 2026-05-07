import type {
  IEventEmitterEventData,
  IEventEmitterHierarchicalEventData,
  TUniversalValue,
} from '@robota-sdk/agent-core';

/**
 * Type guard for event payloads that include hierarchy metadata.
 */
export function isHierarchicalEventData(
  data: IEventEmitterEventData,
): data is IEventEmitterHierarchicalEventData {
  const candidate = data as Partial<IEventEmitterHierarchicalEventData>;
  return typeof candidate.executionLevel === 'number' && Array.isArray(candidate.executionPath);
}

export function asObjectValue(
  value: TUniversalValue | IEventEmitterEventData['data'] | undefined,
): Record<string, TUniversalValue> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) {
    return undefined;
  }
  return value as Record<string, TUniversalValue>;
}
