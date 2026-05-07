import { Label } from '../../ui/label';
import type { IToolBlock } from '../tool-container-block-types';

interface IToolBlockPreviewProps {
  toolBlock: IToolBlock;
}

export function ToolBlockPreview({ toolBlock }: IToolBlockPreviewProps) {
  if (!toolBlock.isEnabled || Object.keys(toolBlock.parameters).length === 0) {
    return null;
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">Execution Preview</Label>
      <div className="p-2 bg-gray-50 rounded text-xs">
        <code className="text-gray-700">
          {toolBlock.tool.name}({JSON.stringify(toolBlock.parameters)})
        </code>
      </div>
    </div>
  );
}
