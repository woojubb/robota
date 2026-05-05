import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { TPlaygroundProvider } from './types';

export function isPlaygroundProvider(value: TUniversalValue): value is TPlaygroundProvider {
  return value === 'openai' || value === 'anthropic' || value === 'google';
}
