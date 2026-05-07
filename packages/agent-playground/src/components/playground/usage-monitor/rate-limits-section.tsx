import { Clock } from 'lucide-react';

import type { IRateLimitInfo } from './types';
import { RateLimitRow } from './rate-limit-row';

export interface IRateLimitsSectionProps {
  rateLimit: IRateLimitInfo;
}

export function RateLimitsSection({ rateLimit }: IRateLimitsSectionProps) {
  return (
    <div className="pt-3 border-t">
      <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
        <Clock className="w-4 h-4" />
        Rate Limits
      </h4>

      <div className="space-y-2">
        <RateLimitRow label="Per Minute" limit={rateLimit.minute} />
        <RateLimitRow label="Per Hour" limit={rateLimit.hour} />
        <RateLimitRow label="Per Day" limit={rateLimit.day} />
      </div>
    </div>
  );
}
