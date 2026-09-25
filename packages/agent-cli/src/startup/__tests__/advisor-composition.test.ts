import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeHostSettingsSource } from '@robota-sdk/agent-framework';

import { parseCliArgs } from '../../utils/cli-args.js';
import {
  ADVISOR_CONSENT_SETTING_KEY,
  composeCliAdvisor,
  createSettingsAdvisorConsentStore,
} from '../advisor-composition.js';

import type { ICliAdvisorInput } from '../advisor-composition.js';
import type { IAIProvider, IProviderDefinitionConfig } from '@robota-sdk/agent-core';

let home: string;
let settingsPath: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'robota-advisor-'));
  settingsPath = join(home, 'settings.json');
  writeFileSync(
    settingsPath,
    JSON.stringify({
      currentProvider: 'main',
      providers: {
        main: { type: 'vendor-a', model: 'main-model', apiKey: 'k' },
        strong: { type: 'vendor-b', model: 'strong-model', apiKey: 'k' },
      },
    }),
  );
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

const providerDefinitions = ['vendor-a', 'vendor-b'].map((type) => ({
  type,
  createProvider: (config: IProviderDefinitionConfig) =>
    ({ name: config.name, model: config.model }) as unknown as IAIProvider,
}));

function input(overrides: Partial<ICliAdvisorInput> = {}): ICliAdvisorInput {
  return {
    flag: undefined,
    userSettings: {},
    safeMode: false,
    env: {},
    orgPolicy: null,
    settingsSources: [createNodeHostSettingsSource('user', settingsPath)],
    providerDefinitions,
    userSettingsPath: settingsPath,
    ...overrides,
  };
}

describe('composeCliAdvisor', () => {
  it('adds no tool when no advisor is configured', () => {
    const advisor = composeCliAdvisor(input());
    expect(advisor.tool).toBeUndefined();
    expect(advisor.controller.isRegistered()).toBe(false);
  });

  it('adds the tool when the saved setting names an advisor', () => {
    const advisor = composeCliAdvisor(input({ userSettings: { advisorModel: 'strong' } }));
    expect(advisor.tool?.schema.name).toBe('Advisor');
    expect(advisor.controller.status().target).toBe('strong');
  });

  it('lets the --advisor flag win over the saved setting', () => {
    const args = parseCliArgs(['--advisor', 'main:other-model']);
    const advisor = composeCliAdvisor(
      input({ flag: args.advisor, userSettings: { advisorModel: 'strong' } }),
    );
    expect(advisor.controller.status().target).toBe('main:other-model');
    const off = composeCliAdvisor(input({ flag: 'off', userSettings: { advisorModel: 'strong' } }));
    expect(off.tool).toBeUndefined();
  });

  it('ignores the saved advisor in safe mode', () => {
    const advisor = composeCliAdvisor(
      input({ safeMode: true, userSettings: { advisorModel: 'strong' } }),
    );
    expect(advisor.tool).toBeUndefined();
  });

  it('adds nothing under ROBOTA_DISABLE_ADVISOR=1, and /advisor cannot turn it on', () => {
    const advisor = composeCliAdvisor(
      input({ flag: 'strong', env: { ROBOTA_DISABLE_ADVISOR: '1' } }),
    );
    expect(advisor.tool).toBeUndefined();
    expect(advisor.controller.set('strong').success).toBe(false);
  });

  it('starts without the advisor, and says so, when the organization does not allow it', () => {
    const advisor = composeCliAdvisor(
      input({ flag: 'strong', orgPolicy: { allowedProviders: ['main'] } }),
    );
    expect(advisor.tool).toBeUndefined();
    expect(advisor.notice).toContain('organization policy');
  });

  it('resolves a profile, or a profile with a model, to that profile provider', async () => {
    const advisor = composeCliAdvisor(input({ flag: 'strong:bigger-model' }));
    expect(advisor.controller.displayLabel()).toBe('bigger-model');
    expect(advisor.controller.set('strong').success).toBe(true);
    expect(advisor.controller.displayLabel()).toBe('strong-model');
    expect(advisor.controller.set('nope').success).toBe(false);
  });
});

describe('advisor consent store', () => {
  it('persists consent per vendor in the user settings file, keeping other settings', () => {
    const store = createSettingsAdvisorConsentStore(settingsPath);
    expect(store.has('vendor-b')).toBe(false);
    store.grant('vendor-b');
    store.grant('vendor-b');
    const reopened = createSettingsAdvisorConsentStore(settingsPath);
    expect(reopened.has('vendor-b')).toBe(true);
    expect(reopened.has('vendor-c')).toBe(false);
    const saved = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    expect(saved[ADVISOR_CONSENT_SETTING_KEY]).toEqual(['vendor-b']);
    expect(saved['currentProvider']).toBe('main');
  });
});
