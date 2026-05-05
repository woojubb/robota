'use client';

import { useEffect, type RefObject } from 'react';

interface IKeyboardNavigationOptions {
  onArrowKeys: boolean;
  onEnterSpace: boolean;
}

export function useKeyboardNavigation(
  containerRef: RefObject<HTMLElement | null>,
  { onArrowKeys, onEnterSpace }: IKeyboardNavigationOptions,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const focusableElements = getFocusableElements(container);
      const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);

      if (onArrowKeys) {
        handleArrowNavigation(event, focusableElements, currentIndex);
      }

      if (onEnterSpace) {
        handleActivation(event);
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [containerRef, onArrowKeys, onEnterSpace]);
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll('[tabindex="0"], button, a[href], input, select, textarea'),
  ) as HTMLElement[];
}

function handleArrowNavigation(
  event: KeyboardEvent,
  focusableElements: HTMLElement[],
  currentIndex: number,
): void {
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowRight':
      focusNextElement(event, focusableElements, currentIndex);
      break;
    case 'ArrowUp':
    case 'ArrowLeft':
      focusPreviousElement(event, focusableElements, currentIndex);
      break;
    case 'Home':
      event.preventDefault();
      focusableElements[0]?.focus();
      break;
    case 'End':
      event.preventDefault();
      focusableElements[focusableElements.length - 1]?.focus();
      break;
  }
}

function focusNextElement(
  event: KeyboardEvent,
  focusableElements: HTMLElement[],
  currentIndex: number,
): void {
  event.preventDefault();
  const nextIndex = (currentIndex + 1) % focusableElements.length;
  focusableElements[nextIndex]?.focus();
}

function focusPreviousElement(
  event: KeyboardEvent,
  focusableElements: HTMLElement[],
  currentIndex: number,
): void {
  event.preventDefault();
  const prevIndex = currentIndex === 0 ? focusableElements.length - 1 : currentIndex - 1;
  focusableElements[prevIndex]?.focus();
}

function handleActivation(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  const target = event.target as HTMLElement;
  if (target.tagName !== 'BUTTON' && target.tagName !== 'A') {
    event.preventDefault();
    target.click();
  }
}
