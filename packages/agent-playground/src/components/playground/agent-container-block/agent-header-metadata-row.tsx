import { Badge } from '../../ui/badge';
import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import type { ITeamRoleDefinition } from './types';

export interface IAgentHeaderMetadataRowProps {
  agent: IPlaygroundAgentConfig;
  roleInfo: ITeamRoleDefinition;
  priority: number;
}

export function AgentHeaderMetadataRow({
  agent,
  roleInfo,
  priority,
}: IAgentHeaderMetadataRowProps) {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500 ml-8">
      <Badge variant="secondary" className="text-xs">
        {roleInfo.label}
      </Badge>
      <span>•</span>
      <span>{agent.defaultModel.provider}</span>
      <span>•</span>
      <span>{agent.defaultModel.model}</span>
      {priority > 0 && (
        <>
          <span>•</span>
          <span>P{priority}</span>
        </>
      )}
    </div>
  );
}
