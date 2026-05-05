import type { TUniversalValue } from '@robota-sdk/agent-core';

import { ScrollArea } from '../../ui/scroll-area';
import type { IToolBlock } from '../tool-container-block-types';
import { IndividualToolBlock } from './individual-tool-block';

interface IToolListProps {
  tools: IToolBlock[];
  maxHeightClassName: string;
  isEditable: boolean;
  onToolUpdate: (toolBlock: IToolBlock) => void;
  onToolRemove: (toolId: string) => void;
  onToolExecute: (toolId: string, parameters: Record<string, TUniversalValue>) => void;
}

export function ToolList({
  tools,
  maxHeightClassName,
  isEditable,
  onToolUpdate,
  onToolRemove,
  onToolExecute,
}: IToolListProps) {
  return (
    <ScrollArea className={`w-full ${maxHeightClassName}`}>
      <div className="space-y-3">
        {tools.map((toolBlock) => (
          <IndividualToolBlock
            key={toolBlock.id}
            toolBlock={toolBlock}
            onUpdate={onToolUpdate}
            onRemove={() => onToolRemove(toolBlock.id)}
            onExecute={(params) => onToolExecute(toolBlock.id, params)}
            isEditable={isEditable}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
