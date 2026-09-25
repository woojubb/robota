import { createRecordEnvResolver } from '@robota-sdk/agent-core';
import { describe, expect, it, vi } from 'vitest';

import {
  TRANSPORT_ENVIRONMENT,
  connectionEnvironmentNames,
  findConnectionEnvironmentDivergence,
  sealConnectionEnvironment,
  verifyConnectionEnvironment,
} from './connection-environment.js';
import { createProviderFromExactProfile } from './provider-factory.js';

import type { ISerializableProviderProfile } from '../background-tasks/types.js';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';

const createProvider = vi.fn(() => ({ type: 'stub' }) as unknown as IAIProvider);
const DEFINITIONS: IProviderDefinition[] = [
  {
    type: 'openai',
    destinationEnvironment: ['OPENAI_BASE_URL'],
    defaults: { apiKey: '$ENV:OPENAI_API_KEY', baseURL: 'https://default.invalid/v1' },
    createProvider,
  },
];
const PROFILE: ISerializableProviderProfile = { type: 'openai', model: 'm', apiKeyEnv: 'MY_KEY' };

describe('connectionEnvironmentNames', () => {
  it('lists the transport set, what the definition declares and the credential variable', () => {
    const names = connectionEnvironmentNames(PROFILE, DEFINITIONS);
    expect(names).toEqual(
      expect.arrayContaining([...TRANSPORT_ENVIRONMENT, 'OPENAI_BASE_URL', 'MY_KEY']),
    );
    expect(names).toEqual([...names].sort());
  });

  it('reads the variable an `$ENV:` literal names', () => {
    const names = connectionEnvironmentNames(
      { type: 'openai', model: 'm', apiKey: '$ENV:OTHER_KEY' },
      DEFINITIONS,
    );
    expect(names).toContain('OTHER_KEY');
  });

  it('still compares the transport set for a provider no definition describes', () => {
    expect(connectionEnvironmentNames({ type: 'custom', model: 'm' }, DEFINITIONS)).toEqual(
      [...TRANSPORT_ENVIRONMENT].sort(),
    );
  });
});

describe('findConnectionEnvironmentDivergence', () => {
  it('treats unset and empty alike, and names the first differing variable', () => {
    expect(findConnectionEnvironmentDivergence(['A', 'B'], { A: '' }, {})).toBeUndefined();
    expect(findConnectionEnvironmentDivergence(['A', 'B'], { B: 'x' }, { B: 'y' })).toBe('B');
  });
});

describe('sealed connection check', () => {
  it('verifies the environment it was sealed over, and nothing else', () => {
    const check = sealConnectionEnvironment(['A', 'B'], { A: '1', B: 'secret' });
    expect(verifyConnectionEnvironment(check, { A: '1', B: 'secret' })).toBe(true);
    expect(verifyConnectionEnvironment(check, { A: '1', B: 'other' })).toBe(false);
    expect(verifyConnectionEnvironment(check, { A: '1' })).toBe(false);
  });

  it('carries no value, and a fresh nonce each time', () => {
    const first = sealConnectionEnvironment(['B'], { B: 'secret' });
    const second = sealConnectionEnvironment(['B'], { B: 'secret' });
    expect(JSON.stringify(first)).not.toContain('secret');
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.digest).not.toBe(second.digest);
  });
});

describe('createProviderFromExactProfile', () => {
  it('fills nothing from this process registry defaults', () => {
    createProvider.mockClear();
    createProviderFromExactProfile(
      { type: 'openai', model: 'm', apiKey: 'sk-given' },
      undefined,
      DEFINITIONS,
      createRecordEnvResolver({}),
    );
    expect(createProvider).toHaveBeenCalledWith({ name: 'openai', model: 'm', apiKey: 'sk-given' });
  });

  it('refuses a credential reference that resolves to nothing, rather than using a default one', () => {
    expect(() =>
      createProviderFromExactProfile(
        PROFILE,
        undefined,
        DEFINITIONS,
        createRecordEnvResolver({ OPENAI_API_KEY: 'sk-default' }),
      ),
    ).toThrow(/resolved to nothing/);
  });

  it('builds a provider that names no credential, when its definition needs none', () => {
    createProvider.mockClear();
    createProviderFromExactProfile(
      { type: 'openai', model: 'm', baseURL: 'http://local.invalid' },
      'override',
      DEFINITIONS,
      createRecordEnvResolver({}),
    );
    expect(createProvider).toHaveBeenCalledWith({
      name: 'openai',
      model: 'override',
      baseURL: 'http://local.invalid',
    });
  });
});
