import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { IProjectConfig } from './types';

export function isProjectRecord(value: TUniversalValue): value is Record<string, TUniversalValue> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

export function parseProjectConfig(value: TUniversalValue): IProjectConfig | null {
  if (!isProjectRecord(value)) return null;

  const { model, temperature } = value;
  if (typeof model !== 'string' || typeof temperature !== 'string') return null;

  return { ...value, model, temperature };
}
