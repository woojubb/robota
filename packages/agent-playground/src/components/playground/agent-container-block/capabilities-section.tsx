import { Bot, Puzzle, Zap } from 'lucide-react';

import { Badge } from '../../ui/badge';
import { Label } from '../../ui/label';
import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';

export interface ICapabilitiesSectionProps {
  agent: IPlaygroundAgentConfig;
}

export function CapabilitiesSection({ agent }: ICapabilitiesSectionProps) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium">Capabilities</Label>
      <div className="flex flex-wrap gap-1">
        {agent.tools && agent.tools.length > 0 && (
          <Badge variant="outline" className="text-xs">
            <Zap className="h-2 w-2 mr-1" />
            {agent.tools.length} tools
          </Badge>
        )}
        {agent.plugins && agent.plugins.length > 0 && (
          <Badge variant="outline" className="text-xs">
            <Puzzle className="h-2 w-2 mr-1" />
            {agent.plugins.length} plugins
          </Badge>
        )}
        <Badge variant="outline" className="text-xs">
          <Bot className="h-2 w-2 mr-1" />
          {agent.defaultModel.provider}
        </Badge>
      </div>
    </div>
  );
}
