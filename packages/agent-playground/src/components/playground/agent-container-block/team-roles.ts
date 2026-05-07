import { Bot, Crown, Settings, Shield, Zap } from 'lucide-react';

import type { ITeamRoleDefinition } from './types';

export const TEAM_ROLES: ITeamRoleDefinition[] = [
  { value: 'coordinator', label: 'Coordinator', icon: Crown, color: 'text-yellow-600' },
  { value: 'specialist', label: 'Specialist', icon: Zap, color: 'text-blue-600' },
  { value: 'validator', label: 'Validator', icon: Shield, color: 'text-green-600' },
  { value: 'assistant', label: 'Assistant', icon: Bot, color: 'text-gray-600' },
  { value: 'monitor', label: 'Monitor', icon: Settings, color: 'text-purple-600' },
];

const DEFAULT_ROLE_INDEX = 3;

export function getTeamRoleInfo(teamRole: string): ITeamRoleDefinition {
  return TEAM_ROLES.find((role) => role.value === teamRole) ?? TEAM_ROLES[DEFAULT_ROLE_INDEX];
}
