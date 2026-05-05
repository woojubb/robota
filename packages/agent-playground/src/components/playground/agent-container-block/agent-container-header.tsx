import type { ComponentPropsWithoutRef } from 'react';

import { CardHeader } from '../../ui/card';
import { cn } from '../../../lib/utils';
import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import { AgentHeaderMainRow } from './agent-header-main-row';
import { AgentHeaderMetadataRow } from './agent-header-metadata-row';
import type { ITeamRoleDefinition } from './types';

export interface IAgentContainerHeaderProps extends ComponentPropsWithoutRef<'div'> {
  agent: IPlaygroundAgentConfig;
  index: number;
  totalAgents: number;
  isExpanded: boolean;
  isActive: boolean;
  isExecuting: boolean;
  isLeader: boolean;
  roleInfo: ITeamRoleDefinition;
  priority: number;
  draggable: boolean;
}

export function AgentContainerHeader({
  agent,
  index,
  totalAgents,
  isExpanded,
  isActive,
  isExecuting,
  isLeader,
  roleInfo,
  priority,
  draggable,
  className,
  ...cardHeaderProps
}: IAgentContainerHeaderProps) {
  return (
    <CardHeader
      {...cardHeaderProps}
      className={cn('pb-2 cursor-pointer hover:bg-gray-50', className)}
    >
      <AgentHeaderMainRow
        agent={agent}
        index={index}
        totalAgents={totalAgents}
        isExpanded={isExpanded}
        isActive={isActive}
        isExecuting={isExecuting}
        isLeader={isLeader}
        roleInfo={roleInfo}
        draggable={draggable}
      />
      <AgentHeaderMetadataRow agent={agent} roleInfo={roleInfo} priority={priority} />
    </CardHeader>
  );
}
