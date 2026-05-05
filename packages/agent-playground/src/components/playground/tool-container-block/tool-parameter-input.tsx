import type { TUniversalValue } from '@robota-sdk/agent-core';

import { Input } from '../../ui/input';
import { Switch } from '../../ui/switch';
import { Textarea } from '../../ui/textarea';

interface IToolParameterInputProps {
  parameter: { type: string; description?: string; default?: TUniversalValue };
  value: TUniversalValue;
  onChange: (value: TUniversalValue) => void;
  disabled?: boolean;
}

export function ToolParameterInput({
  parameter,
  value,
  onChange,
  disabled = false,
}: IToolParameterInputProps) {
  switch (parameter.type) {
    case 'string':
      return (
        <Input
          value={String(value || '')}
          onChange={(event) => onChange(event.target.value)}
          placeholder={parameter.description}
          disabled={disabled}
          className="h-8 text-xs"
        />
      );
    case 'number':
      return (
        <Input
          type="number"
          value={Number(value || parameter.default || 0)}
          onChange={(event) => onChange(Number(event.target.value))}
          placeholder={parameter.description}
          disabled={disabled}
          className="h-8 text-xs"
        />
      );
    case 'boolean':
      return <Switch checked={Boolean(value)} onCheckedChange={onChange} disabled={disabled} />;
    default:
      return (
        <Textarea
          value={String(value || '')}
          onChange={(event) => onChange(event.target.value)}
          placeholder={parameter.description}
          disabled={disabled}
          className="min-h-[60px] text-xs resize-none"
        />
      );
  }
}
