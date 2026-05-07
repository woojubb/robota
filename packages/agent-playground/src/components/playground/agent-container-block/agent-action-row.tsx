import { Crown, Edit3, Settings, Trash2 } from 'lucide-react';

import { Button } from '../../ui/button';

export interface IAgentActionRowProps {
  isEditing: boolean;
  isLeader: boolean;
  onConfigure?: () => void;
  onRemove?: () => void;
  onSetLeader?: () => void;
  onToggleEditing: () => void;
}

export function AgentActionRow({
  isEditing,
  isLeader,
  onConfigure,
  onRemove,
  onSetLeader,
  onToggleEditing,
}: IAgentActionRowProps) {
  return (
    <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
      {!isLeader && (
        <Button size="sm" variant="outline" onClick={onSetLeader} className="h-6 px-2 text-xs">
          <Crown className="h-3 w-3 mr-1" />
          Set Leader
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={onToggleEditing} className="h-6 px-2 text-xs">
        <Edit3 className="h-3 w-3 mr-1" />
        {isEditing ? 'Done' : 'Edit'}
      </Button>
      <Button size="sm" variant="outline" onClick={onConfigure} className="h-6 px-2 text-xs">
        <Settings className="h-3 w-3 mr-1" />
        Configure
      </Button>
      <div className="flex-1" />
      <Button size="sm" variant="ghost" onClick={onRemove} className="h-6 w-6 p-0 text-red-500">
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}
