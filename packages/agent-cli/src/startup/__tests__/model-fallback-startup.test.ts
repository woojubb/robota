import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FallbackProvider, createNodeHostSettingsSource } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseCliArgs } from '../../utils/cli-args.js';
import { applyModelFallbackChain } from '../model-fallback-startup.js';

import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';

const primaryProvider = { name: 'anthropic' } as unknown as IAIProvider;
const DEFINITIONS: IProviderDefinition[] = ['anthropic', 'openai', 'gemini'].map((type) => ({
  type,
  createProvider: () => ({ name: type }) as unknown as IAIProvider,
}));

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'robota-fallback-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function settingsSource(document: Record<string, unknown>) {
  const path = join(dir, 'settings.json');
  writeFileSync(path, JSON.stringify(document));
  return createNodeHostSettingsSource('user', path);
}

const PROFILES = {
  currentProvider: 'claude',
  providers: {
    claude: { type: 'anthropic', model: 'claude-main', apiKey: 'a' },
    openai: { type: 'openai', model: 'gpt-profile', apiKey: 'b' },
    gemini: { type: 'gemini', model: 'gemini-profile', apiKey: 'c' },
  },
};

function apply(
  document: Record<string, unknown>,
  fallbackFlag: string[] | undefined,
  allowedProviders?: string[],
): { provider: IAIProvider; notices: string[] } {
  const notices: string[] = [];
  const provider = applyModelFallbackChain({
    provider: primaryProvider,
    fallbackFlag,
    settingsSources: [settingsSource(document)],
    primaryConfig: { name: 'anthropic', model: 'claude-main', apiKey: 'a' },
    providerDefinitions: DEFINITIONS,
    ...(allowedProviders !== undefined && { orgPolicy: { allowedProviders } }),
    notice: (message) => notices.push(message),
  });
  return { provider, notices };
}

describe('--fallback-model', () => {
  it('parses a comma-separated list', () => {
    expect(parseCliArgs(['--fallback-model', 'openai, gemini:gemini-pro']).fallbackModel).toEqual([
      'openai',
      'gemini:gemini-pro',
    ]);
    expect(parseCliArgs([]).fallbackModel).toBeUndefined();
  });
});

describe('applyModelFallbackChain', () => {
  it('leaves the provider alone when no chain is configured', () => {
    expect(apply(PROFILES, undefined).provider).toBe(primaryProvider);
  });

  it('reads the fallbackModel setting', () => {
    const { provider } = apply({ ...PROFILES, fallbackModel: ['openai', 'gemini'] }, undefined);
    expect(provider).toBeInstanceOf(FallbackProvider);
    expect((provider as FallbackProvider).chain).toEqual([
      { provider: 'openai', model: 'gpt-profile' },
      { provider: 'gemini', model: 'gemini-profile' },
    ]);
  });

  it('lets the flag win over the setting', () => {
    const { provider } = apply({ ...PROFILES, fallbackModel: ['openai'] }, ['gemini:gemini-pro']);
    expect((provider as FallbackProvider).chain).toEqual([
      { provider: 'gemini', model: 'gemini-pro' },
    ]);
  });

  it('announces what the organization policy dropped', () => {
    const { provider, notices } = apply(
      { ...PROFILES, fallbackModel: ['openai', 'gemini'] },
      undefined,
      ['claude', 'gemini'],
    );
    expect((provider as FallbackProvider).chain).toEqual([
      { provider: 'gemini', model: 'gemini-profile' },
    ]);
    expect(notices).toEqual([
      'Fallback models not allowed by your organization policy were dropped: openai.',
    ]);
  });
});
