import { Input } from '../../ui/input';
import { Label } from '../../ui/label';

interface IModelRangeFieldProps {
  label: string;
  value: number;
  max: number;
  min: number;
  step: number;
  isExecuting: boolean;
  onChange: (value: number) => void;
}

export function ModelRangeField({
  label,
  value,
  max,
  min,
  step,
  isExecuting,
  onChange,
}: IModelRangeFieldProps) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <Label className="text-xs font-medium">{label}</Label>
        <span className="text-xs text-gray-500">{value}</span>
      </div>
      <Input
        type="range"
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        max={max}
        min={min}
        step={step}
        disabled={isExecuting}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
      />
    </div>
  );
}
