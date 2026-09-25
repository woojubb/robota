import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createNodeHostSettingsSource,
  describeProviderDestination,
  providerDestinationOf,
} from '@robota-sdk/agent-framework';

import { parseCliArgs } from '../../utils/cli-args.js';
import {
  ADVISOR_CONSENT_SETTING_KEY,
  composeCliAdvisor,
  createSettingsAdvisorConsentStore,
} from '../advisor-composition.js';

import type { ICliAdvisorInput } from '../advisor-composition.js';
import type { IAIProvider, IProviderDefinitionConfig } from '@robota-sdk/agent-core';

let home: string;
const mainProvider = { name: 'vendor-a' } as unknown as IAIProvider;
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
        local: { type: 'vendor-a', model: 'local-model', baseURL: 'http://localhost:11434/v1' },
        cloud: { type: 'vendor-a', model: 'cloud-model', baseURL: 'https://API.vendor-a.test/v1' },
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
    mainProvider: {
      provider: mainProvider,
      config: { name: 'vendor-a', baseURL: 'https://api.vendor-a.test/v2' },
    },
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

describe('advisor destination', () => {
  it('is the provider type with the host it talks to', () => {
    expect(
      describeProviderDestination(
        { name: 'vendor-a', baseURL: 'https://API.Vendor-A.test/v1' },
        providerDefinitions,
      ),
    ).toBe('vendor-a@api.vendor-a.test');
    expect(describeProviderDestination({ name: 'vendor-a' }, providerDefinitions)).toBe(
      'vendor-a@default',
    );
  });

  it('records where the main provider sends requests, by its host', () => {
    composeCliAdvisor(input());
    expect(providerDestinationOf(mainProvider)).toBe('vendor-a@api.vendor-a.test');
  });

  it('needs consent for a profile of the main provider type on another endpoint', async () => {
    const advisor = composeCliAdvisor(input({ flag: 'local' }));
    const result = await advisor.controller.consult({
      history: [],
      systemPrompt: 's',
      mainDestination: providerDestinationOf(mainProvider),
      sessionId: 's',
      turnId: 't',
    });
    expect(result.outcome).toBe('declined');
    expect(result.text).toContain('vendor-a@localhost:11434');
    expect(result.text).toContain('consent');
  });

  it('needs no consent for a profile on the host the main provider already uses', async () => {
    const chat = vi.fn(async () => ({
      id: 'a',
      role: 'assistant' as const,
      content: 'advice',
      state: 'complete' as const,
      timestamp: new Date(),
    }));
    const definitions = providerDefinitions.map((definition) => ({
      ...definition,
      createProvider: (config: IProviderDefinitionConfig) =>
        ({ name: config.name, chat }) as unknown as IAIProvider,
    }));
    const advisor = composeCliAdvisor(input({ flag: 'cloud', providerDefinitions: definitions }));
    const result = await advisor.controller.consult({
      history: [],
      systemPrompt: 's',
      mainDestination: providerDestinationOf(mainProvider),
      sessionId: 's',
      turnId: 't',
    });
    expect(result.outcome).toBe('answered');
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
