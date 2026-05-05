'use client';

import { useRef, type ReactNode } from 'react';
import { useKeyboardNavigation } from './use-keyboard-navigation';

export function KeyboardNavigatable({
  children,
  onArrowKeys = true,
  onEnterSpace = true,
  className,
}: {
  children: ReactNode;
  onArrowKeys?: boolean;
  onEnterSpace?: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useKeyboardNavigation(containerRef, { onArrowKeys, onEnterSpace });

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}
