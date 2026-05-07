import { ChevronDown, ChevronRight, Crown, GripVertical } from 'lucide-react';

import { Badge } from '../../ui/badge';
import { CardTitle } from '../../ui/card';
import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import { AgentStatusIcon } from './agent-status-icon';
import type { ITeamRoleDefinition } from './types';

export interface IAgentHeaderMainRowProps {
  agent: IPlaygroundAgentConfig;
  index: number;
  totalAgents: number;
  isExpanded: boolean;
  isActive: boolean;
  isExecuting: boolean;
  isLeader: boolean;
  roleInfo: ITeamRoleDefinition;
  draggable: boolean;
}

export function AgentHeaderMainRow({
  agent,
  index,
  totalAgents,
  isExpanded,
  isActive,
  isExecuting,
  isLeader,
  roleInfo,
  draggable,
}: IAgentHeaderMainRowProps) {
  const RoleIcon = roleInfo.icon;

  return (
    <div className="flex items-center gap-2">
      {draggable && <GripVertical className="h-3 w-3 text-gray-400 cursor-move" />}
      {isExpanded ? (
        <ChevronDown className="h-3 w-3 text-gray-400" />
      ) : (
        <ChevronRight className="h-3 w-3 text-gray-400" />
      )}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <RoleIcon className={`h-4 w-4 ${roleInfo.color}`} />
        <CardTitle className="text-xs font-medium truncate">{agent.name}</CardTitle>
        {isLeader && <Crown className="h-3 w-3 text-yellow-500" />}
        <AgentStatusIcon isActive={isActive} isExecuting={isExecuting} />
      </div>
      <Badge variant="outline" className="text-xs px-1 py-0">
        {index + 1}/{totalAgents}
      </Badge>
    </div>
  );
}
