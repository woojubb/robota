import React from 'react';
import { writeFileSync } from 'node:fs';
import { render, useApp } from 'ink';
import InteractivePrompt from '../../InteractivePrompt.js';
import {
  createProviderSetupFlow,
  formatProviderSetupHelpLinks,
  getProviderSetupStep,
  submitProviderSetupValue,
  validateProviderSetupValue,
  type IProviderSetupFlowState,
  type TProviderSetupType,
} from '@robota-sdk/agent-sdk';
import type { IProviderDefinition } from '../../../utils/provider-definition.js';
import type { TInteractivePrompt } from '../../../utils/interactive-prompt.js';

const openaiDefaults = {
  apiKey: '$ENV:OPENAI_API_KEY',
};

const providerDefinitions: readonly IProviderDefinition[] = [
  {
    type: 'openai',
    defaults: openaiDefaults,
    setupHelpLinks: [
      {
        kind: 'api-key',
        label: 'OpenAI API keys',
        url: 'https://platform.openai.com/api-keys',
      },
    ],
    setupSteps: [
      {
        key: 'model',
        title: 'OpenAI model',
        required: true,
      },
      {
        key: 'apiKey',
        title: 'OpenAI API key',
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
  const initial = createProviderSetupFlow(type, providerDefinitions);
  const [state, setState] = React.useState<IProviderSetupFlowState>(initial);
  const [prompt, setPrompt] = React.useState<TInteractivePrompt>(() => toPrompt(initial));

  return (
    <InteractivePrompt
      prompt={prompt}
      onSubmit={(value) => {
        const result = submitProviderSetupValue(state, value);
        if (result.status === 'complete') {
          writeFileSync(outputPath, JSON.stringify(result.input), 'utf8');
          exit();
          setTimeout(() => process.exit(0), 0);
          return;
        }
        if (result.status === 'error') {
          throw new Error(result.message);
        }
        setState(result.state);
        setPrompt(toPrompt(result.state));
      }}
      onCancel={() => {
        exit();
        setTimeout(() => process.exit(2), 0);
      }}
    />
  );
}

function toPrompt(flow: IProviderSetupFlowState): TInteractivePrompt {
  const step = getProviderSetupStep(flow);
  return {
    kind: 'text',
    title: step.title,
    ...toPromptDescription(flow),
    ...(step.defaultValue !== undefined ? { placeholder: step.defaultValue } : {}),
    ...(step.defaultValue !== undefined ? { allowEmpty: true } : {}),
    ...(step.masked !== undefined ? { masked: step.masked } : {}),
    validate: (value) => validateProviderSetupValue(step, value),
  };
}

function toPromptDescription(
  flow: IProviderSetupFlowState,
): { description: string } | Record<string, never> {
  const description = formatProviderSetupHelpLinks(flow.setupHelpLinks);
  return description.length > 0 ? { description } : {};
}

render(<Driver type={rawType} />);
