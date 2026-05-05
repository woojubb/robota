import type { DragEvent } from 'react';
import type { LucideIcon } from 'lucide-react';

import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';

export interface IAgentContainerBlockProps {
  agent: IPlaygroundAgentConfig;
  index: number;
  totalAgents: number;
  isActive?: boolean;
  isExecuting?: boolean;
  isLeader?: boolean;
  teamRole?: string;
  priority?: number;
  onAgentChange: (agent: IPlaygroundAgentConfig) => void;
  onRemove?: () => void;
  onEdit?: () => void;
  onSetLeader?: () => void;
  onPriorityChange?: (priority: number) => void;
  onRoleChange?: (role: string) => void;
  className?: string;
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  onDragOver?: (event: DragEvent) => void;
  onDrop?: (event: DragEvent) => void;
}

export interface ITeamRoleDefinition {
  value: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

export interface IResolvedAgentContainerBlockProps
  extends Omit<
    IAgentContainerBlockProps,
    'className' | 'draggable' | 'isActive' | 'isExecuting' | 'isLeader' | 'priority' | 'teamRole'
  > {
  className: string;
  draggable: boolean;
  isActive: boolean;
  isExecuting: boolean;
  isLeader: boolean;
  priority: number;
  teamRole: string;
}
