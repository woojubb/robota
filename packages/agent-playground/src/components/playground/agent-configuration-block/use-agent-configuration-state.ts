import { useCallback, useMemo, useRef, useState } from 'react';

import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import type { IAgentConfigurationValidation, TAgentConfigUpdateHandler } from './types';

export function validateAgentConfiguration(
  config: IPlaygroundAgentConfig,
): IAgentConfigurationValidation {
  const errors: string[] = [];

  if (!config.name?.trim()) {
    errors.push('Agent name is required');
  }

  if (!config.defaultModel?.model) {
    errors.push('Model selection is required');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

interface IUseAgentConfigurationStateOptions {
  config: IPlaygroundAgentConfig;
  isExecuting: boolean;
  onConfigChange: (config: IPlaygroundAgentConfig) => void;
}

interface IUseAgentConfigurationStateResult {
  editedConfig: IPlaygroundAgentConfig;
  validation: IAgentConfigurationValidation;
  handleConfigUpdate: TAgentConfigUpdateHandler;
}

export function useAgentConfigurationState({
  config,
  isExecuting,
  onConfigChange,
}: IUseAgentConfigurationStateOptions): IUseAgentConfigurationStateResult {
  const [editedConfig, setEditedConfig] = useState<IPlaygroundAgentConfig>(config);
  const prevConfigRef = useRef(config);

  if (prevConfigRef.current !== config) {
    prevConfigRef.current = config;
    setEditedConfig(config);
  }

  const validation = useMemo(() => validateAgentConfiguration(editedConfig), [editedConfig]);

  const handleConfigUpdate = useCallback<TAgentConfigUpdateHandler>(
    (updates) => {
      if (isExecuting) return;

      setEditedConfig((previous) => {
        const newConfig = { ...previous, ...updates };
        onConfigChange(newConfig);
        return newConfig;
      });
    },
    [isExecuting, onConfigChange],
  );

  return {
    editedConfig,
    validation,
    handleConfigUpdate,
  };
}
