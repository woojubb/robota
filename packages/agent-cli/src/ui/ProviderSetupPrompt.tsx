import React, { useState } from 'react';
import type { IProviderSetupInput } from '../utils/provider-settings.js';
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
  onSubmit: (input: IProviderSetupInput) => void;
  onCancel: () => void;
}

export default function ProviderSetupPrompt({
  type,
  onSubmit,
  onCancel,
}: IProviderSetupPromptProps): React.ReactElement {
  const [state, setState] = useState<IProviderSetupFlowState>(() => createProviderSetupFlow(type));
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
