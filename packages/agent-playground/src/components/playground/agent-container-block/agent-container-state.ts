import type { ITeamRoleDefinition } from './types';

export interface IAgentContainerState {
  isEditing: boolean;
  isExpanded: boolean;
  roleInfo: ITeamRoleDefinition;
  onExpandedChange: (isExpanded: boolean) => void;
  onToggleEditing: () => void;
}
