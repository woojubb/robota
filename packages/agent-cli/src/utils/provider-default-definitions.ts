import { createAnthropicProviderDefinition } from '@robota-sdk/agent-provider-anthropic';
import { createGemmaProviderDefinition } from '@robota-sdk/agent-provider-gemma';
import { createOpenAIProviderDefinition } from '@robota-sdk/agent-provider-openai';
import type { IProviderDefinition } from './provider-definition.js';

export const DEFAULT_PROVIDER_DEFINITIONS: readonly IProviderDefinition[] = [
  createAnthropicProviderDefinition(),
  createOpenAIProviderDefinition(),
  createGemmaProviderDefinition(),
];
