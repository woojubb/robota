import { Copy, Play, Trash2 } from 'lucide-react';

import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import { WebLogger } from '../../../lib/web-logger';
import { Button } from '../../ui/button';
import type { IAgentConfigurationValidation } from './types';

interface IAgentHeaderActionsProps {
  editedConfig: IPlaygroundAgentConfig;
  validation: IAgentConfigurationValidation;
  isExecuting: boolean;
  onExecute?: (config: IPlaygroundAgentConfig) => void;
  onOpenChat?: (config: IPlaygroundAgentConfig) => void;
  onDuplicate?: (config: IPlaygroundAgentConfig) => void;
  onDelete?: (config: IPlaygroundAgentConfig) => void;
}

export function AgentHeaderActions({
  editedConfig,
  validation,
  isExecuting,
  onExecute,
  onOpenChat,
  onDuplicate,
  onDelete,
}: IAgentHeaderActionsProps) {
  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenChat?.(editedConfig);
        }}
        className="h-7 px-3 text-xs"
        type="button"
      >
        Chat
      </Button>

      <RunButton
        editedConfig={editedConfig}
        isExecuting={isExecuting}
        isValid={validation.isValid}
        onExecute={onExecute}
      />

      <SecondaryHeaderActions
        editedConfig={editedConfig}
        isExecuting={isExecuting}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
    </div>
  );
}

interface ISecondaryHeaderActionsProps {
  editedConfig: IPlaygroundAgentConfig;
  isExecuting: boolean;
  onDuplicate?: (config: IPlaygroundAgentConfig) => void;
  onDelete?: (config: IPlaygroundAgentConfig) => void;
}

function SecondaryHeaderActions({
  editedConfig,
  isExecuting,
  onDuplicate,
  onDelete,
}: ISecondaryHeaderActionsProps) {
  if (isExecuting) {
    return null;
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onDuplicate?.(editedConfig)}
        className="h-7 w-7 p-0"
      >
        <Copy className="h-3 w-3" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onDelete?.(editedConfig)}
        className="h-7 w-7 p-0 text-red-500"
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </>
  );
}

interface IRunButtonProps {
  editedConfig: IPlaygroundAgentConfig;
  isExecuting: boolean;
  isValid: boolean;
  onExecute?: (config: IPlaygroundAgentConfig) => void;
}

function RunButton({ editedConfig, isExecuting, isValid, onExecute }: IRunButtonProps) {
  if (isExecuting) {
    return null;
  }

  return (
    <Button
      size="sm"
      variant="default"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (onExecute) {
          onExecute(editedConfig);
        } else {
          WebLogger.warn('onExecute is not provided');
        }
      }}
      disabled={!isValid}
      className="h-7 px-3 text-xs relative z-10"
      type="button"
    >
      <Play className="h-3 w-3 mr-1" />
      Play
    </Button>
  );
}
