/**
 * A provider built with no client, no apiKey and no executor refuses the same way whichever vendor
 * it is: one error class, one message shape, so a host handles a missing credential once.
 */

import { ConfigurationError } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import { AnthropicProvider } from '../anthropic/index';
import { DeepSeekProvider } from '../deepseek/index';
import { GemmaProvider } from '../gemma/index';
import { OpenAIProvider } from '../openai/index';
import { QwenProvider } from '../qwen/index';

const noCredential = {} as never;

const providers: Array<[string, () => unknown]> = [
  ['Anthropic', () => new AnthropicProvider(noCredential)],
  ['OpenAI', () => new OpenAIProvider(noCredential)],
  ['DeepSeek', () => new DeepSeekProvider(noCredential)],
  ['Qwen', () => new QwenProvider(noCredential)],
  ['Gemma', () => new GemmaProvider(noCredential)],
];

describe.each(providers)('%s provider built with no credential', (vendor, build) => {
  it('throws a ConfigurationError that names what is missing', () => {
    expect(build).toThrow(ConfigurationError);
    expect(build).toThrow(
      `Configuration Error: Either ${vendor} client, apiKey, or executor is required`,
    );
  });
});
