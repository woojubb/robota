import { Bot } from 'lucide-react';

import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import { CardHeader } from '../../ui/card';
import { Input } from '../../ui/input';
import { AgentHeaderActions } from './agent-header-actions';
import { AgentStatusIndicator } from './agent-status-indicator';
import { ValidationErrors } from './validation-errors';
import type { IAgentConfigurationValidation, TAgentConfigUpdateHandler } from './types';

interface IAgentConfigurationHeaderProps {
  editedConfig: IPlaygroundAgentConfig;
  validation: IAgentConfigurationValidation;
  isActive: boolean;
  isExecuting: boolean;
  onConfigUpdate: TAgentConfigUpdateHandler;
  onExecute?: (config: IPlaygroundAgentConfig) => void;
  onOpenChat?: (config: IPlaygroundAgentConfig) => void;
  onDuplicate?: (config: IPlaygroundAgentConfig) => void;
  onDelete?: (config: IPlaygroundAgentConfig) => void;
}

export function AgentConfigurationHeader({
  editedConfig,
  validation,
  isActive,
  isExecuting,
  onConfigUpdate,
  onExecute,
  onOpenChat,
  onDuplicate,
  onDelete,
}: IAgentConfigurationHeaderProps) {
  return (
    <CardHeader className="pb-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-blue-600" />
          <Input
            value={editedConfig.name}
            onChange={(event) => onConfigUpdate({ name: event.target.value })}
            className="h-6 text-sm font-semibold border-none p-0 focus-visible:ring-0"
            placeholder="Agent Name"
            disabled={isExecuting}
          />
          <AgentStatusIndicator
            isActive={isActive}
            isExecuting={isExecuting}
            isValid={validation.isValid}
          />
        </div>

        <AgentHeaderActions
          editedConfig={editedConfig}
          validation={validation}
          isExecuting={isExecuting}
          onExecute={onExecute}
          onOpenChat={onOpenChat}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </div>

      <ValidationErrors errors={validation.errors} />
    </CardHeader>
  );
}
