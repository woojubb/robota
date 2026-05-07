import type { IRateLimitWindow } from './types';
import { getUsageColor } from './usage-color';

export interface IRateLimitRowProps {
  label: string;
  limit: IRateLimitWindow;
}

export function RateLimitRow({ label, limit }: IRateLimitRowProps) {
  return (
    <div className="flex justify-between text-xs">
      <span>{label}</span>
      <span className={getUsageColor(limit.limit - limit.remaining, limit.limit)}>
        {limit.remaining} remaining
      </span>
    </div>
  );
}
