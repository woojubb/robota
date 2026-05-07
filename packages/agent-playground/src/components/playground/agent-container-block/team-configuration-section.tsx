import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { TEAM_ROLES } from './team-roles';

export interface ITeamConfigurationSectionProps {
  teamRole: string;
  priority: number;
  isEditing: boolean;
  onRoleChange?: (role: string) => void;
  onPriorityChange?: (priority: number) => void;
}

export function TeamConfigurationSection({
  teamRole,
  priority,
  isEditing,
  onRoleChange,
  onPriorityChange,
}: ITeamConfigurationSectionProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label className="text-xs">Team Role</Label>
        <Select value={teamRole} onValueChange={onRoleChange} disabled={!isEditing}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEAM_ROLES.map((role) => (
              <SelectItem key={role.value} value={role.value}>
                <div className="flex items-center gap-2">
                  <role.icon className={`h-3 w-3 ${role.color}`} />
                  {role.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Priority</Label>
        <Input
          type="number"
          value={priority}
          onChange={(event) => onPriorityChange?.(parseInt(event.target.value) || 0)}
          className="h-7 text-xs"
          disabled={!isEditing}
          min={0}
          max={10}
        />
      </div>
    </div>
  );
}
