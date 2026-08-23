import { createAnthropicProviderDefinition } from '@robota-sdk/agent-provider-anthropic';
import { createGeminiProviderDefinition } from '@robota-sdk/agent-provider-gemini';
import { createOpenAIProviderDefinition } from '@robota-sdk/agent-provider-openai';
import {
  createDeepSeekProviderDefinition,
  createGemmaProviderDefinition,
  createQwenProviderDefinition,
} from '@robota-sdk/agent-provider-openai-compatible';

import type { IProviderDefinition } from '@robota-sdk/agent-core';

export function createDefaultProviderDefinitions(): readonly IProviderDefinition[] {
  return [
    createAnthropicProviderDefinition(),
    createOpenAIProviderDefinition(),
    createGeminiProviderDefinition(),
    createGemmaProviderDefinition(),
    createQwenProviderDefinition(),
    createDeepSeekProviderDefinition(),
  ];
}
