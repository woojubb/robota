'use client';

import { Input } from '../../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Switch } from '../../ui/switch';
import type { IPluginOptionInputProps } from './types';

export function PluginOptionInput({
  option,
  value,
  onChange,
  disabled = false,
}: IPluginOptionInputProps) {
  switch (option.type) {
    case 'boolean':
      return <Switch checked={Boolean(value)} onCheckedChange={onChange} disabled={disabled} />;
    case 'number':
      return (
        <Input
          type="number"
          value={Number(value || option.default || 0)}
          onChange={(event) => onChange(Number(event.target.value))}
          placeholder={option.description}
          disabled={disabled}
          className="h-8 text-xs"
        />
      );
    case 'select':
      return (
        <Select
          value={String(value || option.default)}
          onValueChange={onChange}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {option.options?.map((optionValue) => (
              <SelectItem key={optionValue} value={optionValue}>
                {optionValue}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    default:
      return (
        <Input
          value={String(value || '')}
          onChange={(event) => onChange(event.target.value)}
          placeholder={option.description}
          disabled={disabled}
          className="h-8 text-xs"
        />
      );
  }
}
