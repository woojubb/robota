import React from 'react';
import { ChevronDown, ChevronRight, Play, Trash2, Zap } from 'lucide-react';

import { Button } from '../../ui/button';
import { CardHeader, CardTitle } from '../../ui/card';
import { Switch } from '../../ui/switch';
import type { IToolBlock } from '../tool-container-block-types';
import { ToolBlockStatusIcon } from './tool-block-status-icon';

interface IToolBlockHeaderOwnProps {
  toolBlock: IToolBlock;
  hasErrors: boolean;
  isExpanded: boolean;
  isEditable: boolean;
  onToggleEnabled: () => void;
  onExecute: () => void;
  onRemove: () => void;
}

type TToolBlockHeaderProps = IToolBlockHeaderOwnProps & React.HTMLAttributes<HTMLDivElement>;

interface IToolBlockTitleProps {
  toolBlock: IToolBlock;
  hasErrors: boolean;
  isExpanded: boolean;
}

function ToolBlockTitle({ toolBlock, hasErrors, isExpanded }: IToolBlockTitleProps) {
  const ToggleIcon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <div className="flex items-center gap-2">
      <ToggleIcon className="h-3 w-3 text-gray-400" />
      <Zap className="h-4 w-4 text-orange-600" />
      <CardTitle className="text-xs font-medium">{toolBlock.tool.name}</CardTitle>
      <ToolBlockStatusIcon hasErrors={hasErrors} isEnabled={toolBlock.isEnabled} />
    </div>
  );
}

interface IToolBlockActionsProps {
  toolBlock: IToolBlock;
  isEditable: boolean;
  onToggleEnabled: () => void;
  onExecute: () => void;
  onRemove: () => void;
}

function ToolBlockActions({
  toolBlock,
  isEditable,
  onToggleEnabled,
  onExecute,
  onRemove,
}: IToolBlockActionsProps) {
  return (
    <div className="flex items-center gap-1">
      <Switch
        checked={toolBlock.isEnabled}
        onCheckedChange={onToggleEnabled}
        disabled={!isEditable}
      />
      {isEditable && (
        <>
          <ToolBlockIconButton onClick={onExecute}>
            <Play className="h-3 w-3" />
          </ToolBlockIconButton>
          <ToolBlockIconButton onClick={onRemove} className="text-red-500">
            <Trash2 className="h-3 w-3" />
          </ToolBlockIconButton>
        </>
      )}
    </div>
  );
}

interface IToolBlockIconButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}

function ToolBlockIconButton({ children, onClick, className = '' }: IToolBlockIconButtonProps) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`h-6 w-6 p-0 ${className}`}
    >
      {children}
    </Button>
  );
}

export const ToolBlockHeader = React.forwardRef<HTMLDivElement, TToolBlockHeaderProps>(
  (
    {
      toolBlock,
      hasErrors,
      isExpanded,
      isEditable,
      onToggleEnabled,
      onExecute,
      onRemove,
      ...triggerProps
    },
    ref,
  ) => {
    return (
      <CardHeader {...triggerProps} ref={ref} className="pb-2 cursor-pointer hover:bg-gray-50">
        <div className="flex items-center justify-between">
          <ToolBlockTitle toolBlock={toolBlock} hasErrors={hasErrors} isExpanded={isExpanded} />
          <ToolBlockActions
            toolBlock={toolBlock}
            isEditable={isEditable}
            onToggleEnabled={onToggleEnabled}
            onExecute={onExecute}
            onRemove={onRemove}
          />
        </div>
        <p className="text-xs text-gray-500 text-left">{toolBlock.tool.description}</p>
        {toolBlock.validationErrors.length > 0 && (
          <div className="mt-1 text-xs text-red-600">{toolBlock.validationErrors[0]}</div>
        )}
      </CardHeader>
    );
  },
);

ToolBlockHeader.displayName = 'ToolBlockHeader';
