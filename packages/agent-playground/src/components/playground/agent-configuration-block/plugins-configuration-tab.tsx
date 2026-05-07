import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import { Badge } from '../../ui/badge';
import { Label } from '../../ui/label';

interface IPluginsConfigurationTabProps {
  config: IPlaygroundAgentConfig;
}

export function PluginsConfigurationTab({ config }: IPluginsConfigurationTabProps) {
  const plugins = config.plugins || [];

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium">Active Plugins ({plugins.length})</Label>
      <div className="space-y-2 max-h-32 overflow-y-auto">
        {plugins.map((plugin, index) => (
          <div
            key={index}
            className="flex items-center justify-between p-2 bg-gray-50 rounded text-xs"
          >
            <div>
              <div className="font-medium">{plugin.constructor.name}</div>
              <div className="text-gray-500">Plugin configuration</div>
            </div>
            <Badge variant="secondary" className="text-xs">
              Enabled
            </Badge>
          </div>
        ))}

        {plugins.length === 0 && (
          <div className="text-center py-4 text-xs text-gray-500">No plugins configured</div>
        )}
      </div>
    </div>
  );
}
