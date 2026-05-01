import React from 'react';
import { writeFileSync } from 'node:fs';
import { render, useApp } from 'ink';
import ProviderSetupPrompt from '../../ProviderSetupPrompt.js';
import type { TProviderSetupType } from '../../../utils/provider-setup-flow.js';
import type { IProviderDefinition } from '../../../utils/provider-definition.js';

const openaiDefaults = {
  model: 'supergemma4-26b-uncensored-v2',
  apiKey: 'lm-studio',
  baseURL: 'http://localhost:1234/v1',
};

const providerDefinitions: readonly IProviderDefinition[] = [
  {
    type: 'openai',
    defaults: openaiDefaults,
    setupSteps: [
      {
        key: 'baseURL',
        title: 'OpenAI-compatible base URL',
        defaultValue: openaiDefaults.baseURL,
      },
      {
        key: 'model',
        title: 'OpenAI-compatible model',
        defaultValue: openaiDefaults.model,
      },
      {
        key: 'apiKey',
        title: 'OpenAI-compatible API key',
        defaultValue: openaiDefaults.apiKey,
        masked: true,
      },
    ],
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
  {
    type: 'anthropic',
    defaults: { model: 'claude-sonnet-4-6' },
    setupSteps: [
      { key: 'apiKey', title: 'Anthropic API key', required: true, masked: true },
      { key: 'model', title: 'Anthropic model', defaultValue: 'claude-sonnet-4-6' },
    ],
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
];

const [, , outputPath, rawType] = process.argv;

if (!outputPath || (rawType !== 'openai' && rawType !== 'anthropic')) {
  process.stderr.write('Usage: provider-setup-prompt-driver <output-path> <openai|anthropic>\n');
  process.exit(1);
}

function Driver({ type }: { type: TProviderSetupType }): React.ReactElement {
  const { exit } = useApp();
  return (
    <ProviderSetupPrompt
      type={type}
      providerDefinitions={providerDefinitions}
      onSubmit={(input) => {
        writeFileSync(outputPath, JSON.stringify(input), 'utf8');
        exit();
        setTimeout(() => process.exit(0), 0);
      }}
      onCancel={() => {
        exit();
        setTimeout(() => process.exit(2), 0);
      }}
    />
  );
}

render(<Driver type={rawType} />);
