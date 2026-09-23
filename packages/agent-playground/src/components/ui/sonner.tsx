'use client';

import { useMemo } from 'react';
import type { ToasterProps } from 'sonner';
import { Toaster as Sonner } from 'sonner';

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useMemo(() => {
    if (typeof window === 'undefined') {
      return 'system';
    }
    const root = document.documentElement;
    return root.classList.contains('dark') ? 'dark' : 'light';
  }, []);

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group [--normal-bg:var(--popover)] [--normal-text:var(--popover-foreground)] [--normal-border:var(--border)]"
      {...props}
    />
  );
};

export { Toaster };
