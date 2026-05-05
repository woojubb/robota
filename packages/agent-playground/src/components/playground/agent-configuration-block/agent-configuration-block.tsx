'use client';

import { Card, CardContent } from '../../ui/card';
import { AgentConfigurationHeader } from './agent-configuration-header';
import { AgentConfigurationTabs } from './agent-configuration-tabs';
import type { IAgentConfigurationBlockProps } from './types';
import { useAgentConfigurationState } from './use-agent-configuration-state';

export function AgentConfigurationBlock({
  config,
  isActive = false,
  isExecuting = false,
  onConfigChange,
  onExecute,
  onOpenChat,
  onDuplicate,
  onDelete,
  className = '',
}: IAgentConfigurationBlockProps) {
  const { editedConfig, validation, handleConfigUpdate } = useAgentConfigurationState({
    config,
    isExecuting,
    onConfigChange,
  });

  return (
    <Card
      className={`
            border-2 transition-all duration-200 bg-white
            ${isActive ? 'border-blue-500 shadow-md' : 'border-gray-200'}
            ${isExecuting ? 'border-green-500 shadow-lg' : ''}
            ${!validation.isValid ? 'border-red-200' : ''}
            ${className}
        `}
    >
      <AgentConfigurationHeader
        editedConfig={editedConfig}
        validation={validation}
        isActive={isActive}
        isExecuting={isExecuting}
        onConfigUpdate={handleConfigUpdate}
        onExecute={onExecute}
        onOpenChat={onOpenChat}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />

      <CardContent className="pt-0">
        <AgentConfigurationTabs
          config={editedConfig}
          isExecuting={isExecuting}
          onConfigUpdate={handleConfigUpdate}
        />
      </CardContent>
    </Card>
  );
}
