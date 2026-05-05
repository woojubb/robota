import { useCallback, useState } from 'react';
import type { TUniversalValue } from '@robota-sdk/agent-core';

import { Card, CardContent } from '../../ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible';
import type { IToolBlock } from '../tool-container-block-types';
import { getToolBlockClassName } from './tool-block-class-name';
import { ToolBlockHeader } from './tool-block-header';
import { ToolBlockParameters } from './tool-block-parameters';
import { ToolBlockPreview } from './tool-block-preview';

interface IIndividualToolBlockProps {
  toolBlock: IToolBlock;
  onUpdate: (toolBlock: IToolBlock) => void;
  onRemove: () => void;
  onExecute: (parameters: Record<string, TUniversalValue>) => void;
  isEditable?: boolean;
}

export function IndividualToolBlock({
  toolBlock,
  onUpdate,
  onRemove,
  onExecute,
  isEditable = false,
}: IIndividualToolBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasErrors = toolBlock.validationErrors.length > 0;

  const handleParameterChange = useCallback(
    (key: string, value: TUniversalValue) => {
      onUpdate({ ...toolBlock, parameters: { ...toolBlock.parameters, [key]: value } });
    },
    [toolBlock, onUpdate],
  );

  const handleToggleEnabled = useCallback(() => {
    onUpdate({ ...toolBlock, isEnabled: !toolBlock.isEnabled });
  }, [toolBlock, onUpdate]);

  return (
    <Card className={getToolBlockClassName(toolBlock, hasErrors)}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <ToolBlockHeader
            toolBlock={toolBlock}
            hasErrors={hasErrors}
            isExpanded={isExpanded}
            isEditable={isEditable}
            onToggleEnabled={handleToggleEnabled}
            onExecute={() => onExecute(toolBlock.parameters)}
            onRemove={onRemove}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <div className="space-y-3">
              <ToolBlockParameters
                toolBlock={toolBlock}
                isEditable={isEditable}
                onParameterChange={handleParameterChange}
              />
              <ToolBlockPreview toolBlock={toolBlock} />
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
