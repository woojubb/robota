import { Label } from '../../ui/label';

export interface ISystemMessageSectionProps {
  systemMessage?: string;
}

export function SystemMessageSection({ systemMessage }: ISystemMessageSectionProps) {
  if (!systemMessage) {
    return null;
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">System Message</Label>
      <div className="p-2 bg-gray-50 rounded text-xs text-gray-600 max-h-16 overflow-y-auto">
        {systemMessage}
      </div>
    </div>
  );
}
