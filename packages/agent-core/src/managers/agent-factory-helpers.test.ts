import { describe, expect, it } from 'vitest';

import { applyAgentDefaults, resolveFactoryOptions } from './agent-factory-helpers';

import type { IAgentConfig } from '../interfaces/agent';
import type { IAIProvider } from '../interfaces/provider';

const provider = { name: 'mock-provider' } as IAIProvider;

function baseConfig(): Partial<IAgentConfig> {
  return {
    aiProviders: [provider],
    defaultModel: { provider: 'mock-provider', model: 'mock-model' },
  };
}

describe('resolveFactoryOptions — defaultSystemMessage neutrality', () => {
  it('defaults to an EMPTY system message (no baked-in persona text)', () => {
    const resolved = resolveFactoryOptions({});
    expect(resolved.defaultSystemMessage).toBe('');
  });

  it('preserves an explicit empty string (empty is expressible)', () => {
    const resolved = resolveFactoryOptions({ defaultSystemMessage: '' });
    expect(resolved.defaultSystemMessage).toBe('');
  });

  it('honors a caller-supplied default system message', () => {
    const resolved = resolveFactoryOptions({ defaultSystemMessage: 'You are a test agent.' });
    expect(resolved.defaultSystemMessage).toBe('You are a test agent.');
  });
});

describe('applyAgentDefaults — systemMessage resolution', () => {
  it('leaves systemMessage empty when neither config nor factory options provide one', () => {
    const config = applyAgentDefaults(baseConfig(), resolveFactoryOptions({}));
    expect(config.systemMessage).toBe('');
  });

  it('applies the factory defaultSystemMessage when the config has none', () => {
    const config = applyAgentDefaults(
      baseConfig(),
      resolveFactoryOptions({ defaultSystemMessage: 'factory default' }),
    );
    expect(config.systemMessage).toBe('factory default');
  });

  it('keeps an explicit empty config systemMessage over a non-empty factory default', () => {
    const config = applyAgentDefaults(
      { ...baseConfig(), systemMessage: '' },
      resolveFactoryOptions({ defaultSystemMessage: 'factory default' }),
    );
    expect(config.systemMessage).toBe('');
  });

  it('keeps an explicit config systemMessage over the factory default', () => {
    const config = applyAgentDefaults(
      { ...baseConfig(), systemMessage: 'explicit' },
      resolveFactoryOptions({ defaultSystemMessage: 'factory default' }),
    );
    expect(config.systemMessage).toBe('explicit');
  });
});
