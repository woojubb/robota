'use client';

import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';

export function ScreenReaderOnly({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn('sr-only', className)}>{children}</span>;
}
