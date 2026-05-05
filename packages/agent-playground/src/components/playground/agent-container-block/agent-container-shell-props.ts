import type { IAgentContainerDetailsProps } from './agent-container-details';
import type { IAgentContainerHeaderProps } from './agent-container-header';
import type { IAgentContainerState } from './agent-container-state';
import type { IResolvedAgentContainerBlockProps } from './types';

export function getAgentContainerHeaderProps(
  block: IResolvedAgentContainerBlockProps,
  state: IAgentContainerState,
): IAgentContainerHeaderProps {
  return {
    agent: block.agent,
    index: block.index,
    totalAgents: block.totalAgents,
    isExpanded: state.isExpanded,
    isActive: block.isActive,
    isExecuting: block.isExecuting,
    isLeader: block.isLeader,
    roleInfo: state.roleInfo,
    priority: block.priority,
    draggable: block.draggable,
  };
}

export function getAgentContainerDetailsProps(
  block: IResolvedAgentContainerBlockProps,
  state: IAgentContainerState,
): IAgentContainerDetailsProps {
  return {
    agent: block.agent,
    teamRole: block.teamRole,
    priority: block.priority,
    isEditing: state.isEditing,
    isLeader: block.isLeader,
    onConfigure: block.onEdit,
    onPriorityChange: block.onPriorityChange,
    onRemove: block.onRemove,
    onRoleChange: block.onRoleChange,
    onSetLeader: block.onSetLeader,
    onToggleEditing: state.onToggleEditing,
  };
}
