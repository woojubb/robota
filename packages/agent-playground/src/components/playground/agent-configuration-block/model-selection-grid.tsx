import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import { Label } from '../../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { modelOptions, providerOptions } from './constants';

interface IModelSelectionGridProps {
  config: IPlaygroundAgentConfig;
  isExecuting: boolean;
  onDefaultModelUpdate: (updates: Partial<IPlaygroundAgentConfig['defaultModel']>) => void;
}

export function ModelSelectionGrid({
  config,
  isExecuting,
  onDefaultModelUpdate,
}: IModelSelectionGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label className="text-xs font-medium">Provider</Label>
        <Select
          value={config.defaultModel.provider}
          onValueChange={(value) => onDefaultModelUpdate({ provider: value })}
          disabled={isExecuting}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select Provider" />
          </SelectTrigger>
          <SelectContent>
            {providerOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs font-medium">Model</Label>
        <Select
          value={config.defaultModel.model}
          onValueChange={(value) => onDefaultModelUpdate({ model: value })}
          disabled={isExecuting}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Select Model" />
          </SelectTrigger>
          <SelectContent>
            {modelOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
