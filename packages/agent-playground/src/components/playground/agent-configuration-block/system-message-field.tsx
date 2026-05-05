import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';

interface ISystemMessageFieldProps {
  value: string;
  isExecuting: boolean;
  onChange: (value: string) => void;
}

export function SystemMessageField({ value, isExecuting, onChange }: ISystemMessageFieldProps) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">System Message</Label>
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="You are a helpful AI assistant..."
        className="min-h-[60px] text-xs resize-none"
        disabled={isExecuting}
      />
    </div>
  );
}
