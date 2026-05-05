import type { TUniversalValue } from '@robota-sdk/agent-core';

import type { IToolBlock } from '../tool-container-block-types';
import { ToolContainerEmptyState } from './tool-container-empty-state';
import { ToolList } from './tool-list';

interface IToolContainerContentProps {
  tools: IToolBlock[];
  maxHeightClassName: string;
  isEditable: boolean;
  onToolUpdate: (toolBlock: IToolBlock) => void;
  onToolRemove: (toolId: string) => void;
  onToolExecute: (toolId: string, parameters: Record<string, TUniversalValue>) => void;
}

export function ToolContainerContent({
  tools,
  maxHeightClassName,
  isEditable,
  onToolUpdate,
  onToolRemove,
  onToolExecute,
}: IToolContainerContentProps) {
  if (tools.length === 0) {
    return <ToolContainerEmptyState isEditable={isEditable} />;
  }

  return (
    <ToolList
      tools={tools}
      maxHeightClassName={maxHeightClassName}
      isEditable={isEditable}
      onToolUpdate={onToolUpdate}
      onToolRemove={onToolRemove}
      onToolExecute={onToolExecute}
    />
  );
}
