/**
 * #3282 §4b — `buildProviderProfilesSnapshot`, the Settings screen's "Providers & Models" list.
 */

import { describe, expect, it } from 'vitest';

import { buildProviderProfilesSnapshot } from '../provider-profile-summary.js';

import type { IProviderProfileSettings } from '../provider-settings.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

const ANTHROPIC: IProviderDefinition = {
  type: 'anthropic',
  displayName: 'Anthropic',
  modelCatalog: {
    status: 'live',
    entries: [{ id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' }],
  },
  credentialRequirement: { anyOf: ['apiKey'] },
  createProvider: () => {
    throw new Error('not used');
  },
};

const LOCAL: IProviderDefinition = {
  type: 'local',
  displayName: 'Local',
  modelCatalog: { status: 'unavailable' },
  createProvider: () => {
    throw new Error('not used');
  },
};

describe('buildProviderProfilesSnapshot', () => {
  it('lists every configured profile with its plain provider name and model label', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-test' },
    };

    const snapshot = buildProviderProfilesSnapshot(providers, 'anthropic', [ANTHROPIC]);

    expect(snapshot.profiles).toEqual([
      {
        name: 'anthropic',
        providerLabel: 'Anthropic',
        model: { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
        current: true,
      },
    ]);
  });

  it('falls back to the raw model id when the catalog has no matching entry', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      anthropic: { type: 'anthropic', model: 'claude-legacy', apiKey: 'sk-test' },
    };

    const snapshot = buildProviderProfilesSnapshot(providers, 'anthropic', [ANTHROPIC]);

    expect(snapshot.profiles[0]!.model).toEqual({ id: 'claude-legacy', label: 'claude-legacy' });
  });

  it('marks only the current profile, never guessing for the rest', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-test' },
      backup: { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-test-2' },
    };

    const snapshot = buildProviderProfilesSnapshot(providers, 'anthropic', [ANTHROPIC]);

    expect(snapshot.profiles.map((p) => [p.name, p.current])).toEqual([
      ['anthropic', true],
      ['backup', false],
    ]);
  });

  it('flags "Key missing" when the provider needs a credential and none is usable', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
    };

    const snapshot = buildProviderProfilesSnapshot(providers, 'anthropic', [ANTHROPIC]);

    expect(snapshot.profiles[0]!.connectionState).toBe('Key missing');
  });

  it('flags "Key missing" for an $ENV: reference whose variable is not set', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: '$ENV:NOT_SET_XYZ' },
    };

    const snapshot = buildProviderProfilesSnapshot(providers, 'anthropic', [ANTHROPIC]);

    expect(snapshot.profiles[0]!.connectionState).toBe('Key missing');
  });

  it('omits connectionState once a usable credential is configured', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-test' },
    };

    const snapshot = buildProviderProfilesSnapshot(providers, 'anthropic', [ANTHROPIC]);

    expect('connectionState' in snapshot.profiles[0]!).toBe(false);
  });

  it('omits connectionState for a provider that needs no credential', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      local: { type: 'local', model: 'llama' },
    };

    const snapshot = buildProviderProfilesSnapshot(providers, 'local', [LOCAL]);

    expect('connectionState' in snapshot.profiles[0]!).toBe(false);
  });

  it('omits model when the profile has none configured yet', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      broken: { type: 'anthropic' },
    };

    const snapshot = buildProviderProfilesSnapshot(providers, undefined, [ANTHROPIC]);

    expect('model' in snapshot.profiles[0]!).toBe(false);
  });

  it('omits a profile an org-policy allowlist excludes', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-test' },
      backup: { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-test-2' },
    };

    const snapshot = buildProviderProfilesSnapshot(providers, 'anthropic', [ANTHROPIC], ['anthropic']);

    expect(snapshot.profiles.map((p) => p.name)).toEqual(['anthropic']);
  });

  it('returns an empty list when no providers are configured', () => {
    expect(buildProviderProfilesSnapshot(undefined, undefined, [ANTHROPIC])).toEqual({ profiles: [] });
  });
});
