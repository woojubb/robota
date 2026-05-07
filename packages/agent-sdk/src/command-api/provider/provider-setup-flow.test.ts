import { describe, expect, it } from 'vitest';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import {
  createProviderSetupFlow,
  formatProviderSetupHelpLinks,
  formatProviderSetupPromptLabel,
  getProviderSetupStep,
} from './provider-setup-flow.js';

const providerDefinitions: readonly IProviderDefinition[] = [
  {
    type: 'openai',
    setupHelpLinks: [
      {
        kind: 'api-key',
        label: 'OpenAI API keys',
        url: 'https://platform.openai.com/api-keys',
      },
    ],
    setupSteps: [{ key: 'apiKey', title: 'OpenAI API key', masked: true }],
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
];

describe('provider setup flow', () => {
  it('carries provider-owned setup help links into generic prompt labels', () => {
    const state = createProviderSetupFlow('openai', providerDefinitions);

    expect(state.setupHelpLinks).toEqual(providerDefinitions[0]?.setupHelpLinks);
    expect(formatProviderSetupHelpLinks(state.setupHelpLinks)).toBe(
      '  Setup help: API key: OpenAI API keys - https://platform.openai.com/api-keys',
    );
    expect(formatProviderSetupPromptLabel(getProviderSetupStep(state), state.setupHelpLinks)).toBe(
      [
        '  Setup help: API key: OpenAI API keys - https://platform.openai.com/api-keys',
        '  OpenAI API key: ',
      ].join('\n'),
    );
  });
});
