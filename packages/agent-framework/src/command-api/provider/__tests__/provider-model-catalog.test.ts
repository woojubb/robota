/**
 * #3282 §2 — `buildModelListSnapshot` / `resolveModelListSelection`.
 *
 * The one shared source the `/model` command and the session's `listModels()` wire projection both
 * build from, so unit coverage here is coverage for both callers at once.
 */

import { describe, expect, it } from 'vitest';

import { buildModelListSnapshot, resolveModelListSelection } from '../provider-model-catalog.js';

import type { IProviderProfileSettings } from '../provider-settings.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

const ANTHROPIC: IProviderDefinition = {
  type: 'anthropic',
  displayName: 'Anthropic',
  modelCatalog: {
    status: 'live',
    entries: [
      { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
    ],
  },
  createProvider: () => {
    throw new Error('not used');
  },
};

const OPENAI: IProviderDefinition = {
  type: 'openai',
  displayName: 'OpenAI',
  modelCatalog: { status: 'unavailable' },
  createProvider: () => {
    throw new Error('not used');
  },
};

const NO_DISPLAY_NAME: IProviderDefinition = {
  type: 'mystery',
  modelCatalog: { status: 'fallback', entries: [] },
  createProvider: () => {
    throw new Error('not used');
  },
};

describe('buildModelListSnapshot', () => {
  it('lists the current profile first, then the rest in settings order', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      'my-openai': { type: 'openai', model: 'gpt-5.1' },
      anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
    };

    const snapshot = buildModelListSnapshot(providers, 'anthropic', 'claude-sonnet-4-6', [
      ANTHROPIC,
      OPENAI,
    ]);

    expect(snapshot.groups.map((g) => g.profileName)).toEqual(['anthropic', 'my-openai']);
    expect(snapshot.currentProfile).toBe('anthropic');
    expect(snapshot.currentModel).toBe('claude-sonnet-4-6');
  });

  it('uses the provider catalog entries when the catalog has any', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
    };

    const snapshot = buildModelListSnapshot(providers, 'anthropic', 'claude-sonnet-4-6', [ANTHROPIC]);

    expect(snapshot.groups[0]!.providerLabel).toBe('Anthropic');
    expect(snapshot.groups[0]!.models).toEqual([
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ]);
  });

  it('falls back to just the configured model when the catalog is unavailable', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      'my-openai': { type: 'openai', model: 'gpt-5.1' },
    };

    const snapshot = buildModelListSnapshot(providers, 'my-openai', 'gpt-5.1', [OPENAI]);

    expect(snapshot.groups[0]!.models).toEqual([{ id: 'gpt-5.1', label: 'gpt-5.1' }]);
  });

  it("keeps the profile's configured model even when a refreshed catalog no longer lists it", () => {
    const providers: Record<string, IProviderProfileSettings> = {
      anthropic: { type: 'anthropic', model: 'claude-legacy' },
    };

    const snapshot = buildModelListSnapshot(providers, 'anthropic', 'claude-legacy', [ANTHROPIC]);

    expect(snapshot.groups[0]!.models).toEqual([
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'claude-legacy', label: 'claude-legacy' },
    ]);
  });

  it('skips a profile missing type or model — it could not run via /provider switch either', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
      broken: { type: 'anthropic' },
      alsoBroken: { model: 'x' },
    };

    const snapshot = buildModelListSnapshot(providers, 'anthropic', 'claude-sonnet-4-6', [ANTHROPIC]);

    expect(snapshot.groups.map((g) => g.profileName)).toEqual(['anthropic']);
  });

  it('falls back to the provider type when its definition declares no displayName', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      mystery: { type: 'mystery', model: 'x' },
    };

    const snapshot = buildModelListSnapshot(providers, undefined, 'x', [NO_DISPLAY_NAME]);

    expect(snapshot.groups[0]!.providerLabel).toBe('mystery');
  });

  it('falls back to the raw type for a profile whose provider has no matching definition at all', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      ghost: { type: 'ghost', model: 'y' },
    };

    const snapshot = buildModelListSnapshot(providers, undefined, 'y', [ANTHROPIC]);

    // No definitions array reaches this at all — `providerLabel` still has a final "Unknown
    // provider" fallback for that case, but `buildModelListSnapshot` never produces it: a profile
    // reaching `providerLabel` already passed the `!profile.type` skip above, so `profile.type` is
    // always defined here.
    expect(snapshot.groups[0]!.providerLabel).toBe('ghost');
  });

  it('omits `currentProfile` when no provider is current, without a nullish placeholder', () => {
    const snapshot = buildModelListSnapshot({}, undefined, '', []);

    expect('currentProfile' in snapshot).toBe(false);
    expect(snapshot.groups).toEqual([]);
  });

  it('#3282 §2 review: omits a profile an org-policy allowlist excludes', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
      'my-openai': { type: 'openai', model: 'gpt-5.1' },
    };

    const snapshot = buildModelListSnapshot(
      providers,
      'anthropic',
      'claude-sonnet-4-6',
      [ANTHROPIC, OPENAI],
      ['anthropic'],
    );

    expect(snapshot.groups.map((g) => g.profileName)).toEqual(['anthropic']);
  });

  it('an undefined allowlist (no org policy) offers every configured profile', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
      'my-openai': { type: 'openai', model: 'gpt-5.1' },
    };

    const snapshot = buildModelListSnapshot(
      providers,
      'anthropic',
      'claude-sonnet-4-6',
      [ANTHROPIC, OPENAI],
      undefined,
    );

    expect(snapshot.groups.map((g) => g.profileName)).toEqual(['anthropic', 'my-openai']);
  });
});

describe('resolveModelListSelection', () => {
  it('prefers the current profile when an id is offered by more than one', () => {
    const providers: Record<string, IProviderProfileSettings> = {
      'anthropic-2': { type: 'anthropic', model: 'claude-haiku-4-5' },
      anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
    };
    const snapshot = buildModelListSnapshot(providers, 'anthropic', 'claude-sonnet-4-6', [ANTHROPIC]);

    const selection = resolveModelListSelection(snapshot, 'claude-haiku-4-5');

    expect(selection?.profileName).toBe('anthropic');
  });

  it('returns undefined for an id no configured profile offers', () => {
    const snapshot = buildModelListSnapshot(
      { anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' } },
      'anthropic',
      'claude-sonnet-4-6',
      [ANTHROPIC],
    );

    expect(resolveModelListSelection(snapshot, 'not-a-real-model')).toBeUndefined();
  });
});
