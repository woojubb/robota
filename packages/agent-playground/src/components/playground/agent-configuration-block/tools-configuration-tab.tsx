import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import { Badge } from '../../ui/badge';
import { Label } from '../../ui/label';

interface IToolsConfigurationTabProps {
  config: IPlaygroundAgentConfig;
}

export function ToolsConfigurationTab({ config }: IToolsConfigurationTabProps) {
  const tools = config.tools || [];

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium">Available Tools ({tools.length})</Label>
      <div className="space-y-2 max-h-32 overflow-y-auto">
        {tools.map((tool, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-2 bg-gray-50 rounded text-xs"
          >
            <div>
              <div className="font-medium">{tool.name}</div>
              <div className="text-gray-500">{tool.description}</div>
            </div>
            <Badge variant="secondary" className="text-xs">
              Active
            </Badge>
          </div>
        ))}

        {tools.length === 0 && (
          <div className="text-center py-4 text-xs text-gray-500">No tools configured</div>
        )}
      </div>
    </div>
  );
}
