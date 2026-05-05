'use client';

import { cn } from '../../../lib/utils';

export function SkipToContent({ className }: { className?: string }) {
  return (
    <a
      href="#main-content"
      className={cn(
        'sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50',
        'bg-primary text-primary-foreground px-4 py-2 rounded-md',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        className,
      )}
    >
      Skip to main content
    </a>
  );
}
