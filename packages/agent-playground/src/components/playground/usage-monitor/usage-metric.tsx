import { Progress } from '../../ui/progress';
import { PERCENTAGE_MULTIPLIER } from './constants';
import { getUsageColor } from './usage-color';

export interface IUsageMetricProps {
  icon: React.ReactNode;
  label: string;
  current: number;
  max: number;
}

export function UsageMetric({ icon, label, current, max }: IUsageMetricProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className={`text-sm ${getUsageColor(current, max)}`}>
          {current} / {max}
        </span>
      </div>
      <Progress value={(current / max) * PERCENTAGE_MULTIPLIER} className="h-2" />
    </div>
  );
}
