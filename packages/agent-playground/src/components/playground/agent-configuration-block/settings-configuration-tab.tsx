import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import type { TAgentConfigUpdateHandler } from './types';

interface ISettingsConfigurationTabProps {
  config: IPlaygroundAgentConfig;
  isExecuting: boolean;
  onConfigUpdate: TAgentConfigUpdateHandler;
}

export function SettingsConfigurationTab({
  config,
  isExecuting,
  onConfigUpdate,
}: ISettingsConfigurationTabProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs font-medium">Agent Name</Label>
        <Input
          value={config.name}
          onChange={(event) => onConfigUpdate({ name: event.target.value })}
          placeholder="Agent Name"
          className="h-8 text-xs"
          disabled={isExecuting}
        />
      </div>
    </div>
  );
}
