import type { TUniversalValue } from '@robota-sdk/agent-core';

import { Badge } from '../../ui/badge';
import { Label } from '../../ui/label';
import type { IToolBlock, TToolSchemaParameter } from '../tool-container-block-types';
import { getToolSchema } from './tool-schema';
import { ToolParameterInput } from './tool-parameter-input';

interface IToolBlockParametersProps {
  toolBlock: IToolBlock;
  isEditable: boolean;
  onParameterChange: (key: string, value: TUniversalValue) => void;
}

export function ToolBlockParameters({
  toolBlock,
  isEditable,
  onParameterChange,
}: IToolBlockParametersProps) {
  const schema = getToolSchema(toolBlock.tool);

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium">Parameters</Label>
      {Object.entries(schema?.parameters?.properties || {}).map(([key, paramConfig]) => {
        const parameter = paramConfig as TToolSchemaParameter;
        const isRequired = schema?.parameters?.required?.includes(key);

        return (
          <div key={key} className="space-y-1">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-gray-600">
                {key}
                {isRequired && <span className="text-red-500">*</span>}
              </Label>
              {isRequired && (
                <Badge variant="outline" className="text-xs px-1 py-0">
                  Required
                </Badge>
              )}
            </div>
            <ToolParameterInput
              parameter={parameter}
              value={toolBlock.parameters[key]}
              onChange={(value) => onParameterChange(key, value)}
              disabled={!isEditable || !toolBlock.isEnabled}
            />
            <p className="text-xs text-gray-400">{parameter.description}</p>
          </div>
        );
      })}
    </div>
  );
}
