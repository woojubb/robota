import { useMemo, useState } from 'react';

import type { IAgentContainerState } from './agent-container-state';
import { getTeamRoleInfo } from './team-roles';

export function useAgentContainerState(teamRole: string): IAgentContainerState {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const roleInfo = useMemo(() => getTeamRoleInfo(teamRole), [teamRole]);

  return {
    isEditing,
    isExpanded,
    roleInfo,
    onExpandedChange: setIsExpanded,
    onToggleEditing: () => setIsEditing((current) => !current),
  };
}
