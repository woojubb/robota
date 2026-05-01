import React, { useState } from 'react';
import type { IProviderSetupInput } from '../utils/provider-settings.js';
import type { IProviderDefinition } from '../utils/provider-definition.js';
import {
  createProviderSetupFlow,
  getProviderSetupStep,
  submitProviderSetupValue,
  validateProviderSetupValue,
  type IProviderSetupFlowState,
  type TProviderSetupType,
} from '../utils/provider-setup-flow.js';
import TextPrompt from './TextPrompt.js';

interface IProviderSetupPromptProps {
  type: TProviderSetupType;
  providerDefinitions: readonly IProviderDefinition[];
  onSubmit: (input: IProviderSetupInput) => void;
  onCancel: () => void;
}

export default function ProviderSetupPrompt({
  type,
  providerDefinitions,
  onSubmit,
  onCancel,
}: IProviderSetupPromptProps): React.ReactElement {
  const [state, setState] = useState<IProviderSetupFlowState>(() =>
    createProviderSetupFlow(type, providerDefinitions),
  );
  const step = getProviderSetupStep(state);

  const handleStepSubmit = (rawValue: string): void => {
    const result = submitProviderSetupValue(state, rawValue);
    if (result.status === 'next') {
      setState(result.state);
      return;
    }
    if (result.status === 'complete') {
      onSubmit(result.input);
    }
  };

  return (
    <TextPrompt
      key={`${type}-${step.key}`}
      title={step.title}
      placeholder={step.defaultValue}
      allowEmpty={step.defaultValue !== undefined}
      masked={step.masked}
      validate={(value) => validateProviderSetupValue(step, value)}
      onSubmit={handleStepSubmit}
      onCancel={onCancel}
    />
  );
}
