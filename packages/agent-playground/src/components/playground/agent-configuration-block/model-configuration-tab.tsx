import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from './constants';
import { ModelRangeField } from './model-range-field';
import { ModelSelectionGrid } from './model-selection-grid';
import { SystemMessageField } from './system-message-field';
import type { TAgentConfigUpdateHandler } from './types';

interface IModelConfigurationTabProps {
  config: IPlaygroundAgentConfig;
  isExecuting: boolean;
  onConfigUpdate: TAgentConfigUpdateHandler;
}

export function ModelConfigurationTab({
  config,
  isExecuting,
  onConfigUpdate,
}: IModelConfigurationTabProps) {
  const updateDefaultModel = (updates: Partial<IPlaygroundAgentConfig['defaultModel']>) => {
    onConfigUpdate({
      defaultModel: {
        ...config.defaultModel,
        ...updates,
      },
    });
  };

  return (
    <div className="space-y-3">
      <ModelSelectionGrid
        config={config}
        isExecuting={isExecuting}
        onDefaultModelUpdate={updateDefaultModel}
      />

      <ModelRangeField
        label="Temperature"
        value={config.defaultModel.temperature || DEFAULT_TEMPERATURE}
        max={2}
        min={0}
        step={0.1}
        isExecuting={isExecuting}
        onChange={(value) => updateDefaultModel({ temperature: value })}
      />

      <ModelRangeField
        label="Max Tokens"
        value={config.defaultModel.maxTokens || DEFAULT_MAX_TOKENS}
        max={4000}
        min={100}
        step={100}
        isExecuting={isExecuting}
        onChange={(value) => updateDefaultModel({ maxTokens: value })}
      />

      <SystemMessageField
        value={config.defaultModel.systemMessage || ''}
        isExecuting={isExecuting}
        onChange={(value) => updateDefaultModel({ systemMessage: value })}
      />
    </div>
  );
}
