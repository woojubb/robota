/**
 * Provider factory — creates an AI provider from resolved config.
 */

import type { IAIProvider } from '@robota-sdk/agent-core';
import type { IResolvedConfig } from '../config/config-types.js';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

/**
 * Create an AI provider from the resolved config.
 * Currently supports Anthropic only. Throws if no API key is available.
 */
export function createProvider(config: IResolvedConfig): IAIProvider {
  const apiKey = config.provider.apiKey ?? process.env['ANTHROPIC_API_KEY'];

  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. ' +
        'Set the environment variable or configure provider.apiKey in ~/.robota/settings.json',
    );
  }

  return new AnthropicProvider({ apiKey });
}
