import { CardContent } from '../../ui/card';
import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import { AgentActionRow } from './agent-action-row';
import { CapabilitiesSection } from './capabilities-section';
import { SystemMessageSection } from './system-message-section';
import { TeamConfigurationSection } from './team-configuration-section';

export interface IAgentContainerDetailsProps {
  agent: IPlaygroundAgentConfig;
  teamRole: string;
  priority: number;
  isEditing: boolean;
  isLeader: boolean;
  onConfigure?: () => void;
  onPriorityChange?: (priority: number) => void;
  onRemove?: () => void;
  onRoleChange?: (role: string) => void;
  onSetLeader?: () => void;
  onToggleEditing: () => void;
}

export function AgentContainerDetails(props: IAgentContainerDetailsProps) {
  return (
    <CardContent className="pt-0 pl-8">
      <div className="space-y-3">
        <TeamConfigurationSection
          teamRole={props.teamRole}
          priority={props.priority}
          isEditing={props.isEditing}
          onRoleChange={props.onRoleChange}
          onPriorityChange={props.onPriorityChange}
        />
        <CapabilitiesSection agent={props.agent} />
        <SystemMessageSection systemMessage={props.agent.defaultModel.systemMessage} />
        <AgentActionRow
          isEditing={props.isEditing}
          isLeader={props.isLeader}
          onConfigure={props.onConfigure}
          onRemove={props.onRemove}
          onSetLeader={props.onSetLeader}
          onToggleEditing={props.onToggleEditing}
        />
      </div>
    </CardContent>
  );
}
