'use client';

import { useEffect, useRef, type RefObject } from 'react';

export function useFocusManagement() {
  const focusRef = useRef<HTMLElement>(null);

  const focusElement = (element?: HTMLElement | null) => {
    const target = element || focusRef.current;
    if (target) {
      target.focus();
    }
  };

  const trapFocus = (containerRef: RefObject<HTMLElement>) => {
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const focusableElements = container.querySelectorAll(
        'a[href], button, textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select',
      );

      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      const handleTabKey = (e: KeyboardEvent) => {
        if (e.key === 'Tab') {
          if (e.shiftKey) {
            if (document.activeElement === firstElement) {
              lastElement.focus();
              e.preventDefault();
            }
          } else if (document.activeElement === lastElement) {
            firstElement.focus();
            e.preventDefault();
          }
        }

        if (e.key === 'Escape') {
          const closeButton = container.querySelector('[data-close]') as HTMLElement;
          if (closeButton) {
            closeButton.click();
          }
        }
      };

      container.addEventListener('keydown', handleTabKey);
      firstElement?.focus();

      return () => {
        container.removeEventListener('keydown', handleTabKey);
      };
    }, [containerRef]);
  };

  return { focusRef, focusElement, trapFocus };
}
