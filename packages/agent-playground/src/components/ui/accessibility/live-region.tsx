'use client';

import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';

export function LiveRegion({
  children,
  politeness = 'polite',
  className,
}: {
  children: ReactNode;
  politeness?: 'polite' | 'assertive' | 'off';
  className?: string;
}) {
  return (
    <div aria-live={politeness} aria-atomic="true" className={cn('sr-only', className)}>
      {children}
    </div>
  );
}
