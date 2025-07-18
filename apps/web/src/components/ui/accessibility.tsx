'use client';

import { useEffect, useRef, ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Skip Navigation Links
export function SkipToContent({
    className
}: {
    className?: string
}) {
    return (
        <a
            href="#main-content"
            className={cn(
                "sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50",
                "bg-primary text-primary-foreground px-4 py-2 rounded-md",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                className
            )}
        >
            Skip to main content
        </a>
    );
}

// Screen Reader Only Text
export function ScreenReaderOnly({
    children,
    className
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <span className={cn("sr-only", className)}>
            {children}
        </span>
    );
}

// Live Region for Announcements
export function LiveRegion({
    children,
    politeness = 'polite',
    className
}: {
    children: ReactNode;
    politeness?: 'polite' | 'assertive' | 'off';
    className?: string;
}) {
    return (
        <div
            aria-live={politeness}
            aria-atomic="true"
            className={cn("sr-only", className)}
        >
            {children}
        </div>
    );
}

// Focus Management Hook
export function useFocusManagement() {
    const focusRef = useRef<HTMLElement>(null);

    const focusElement = (element?: HTMLElement | null) => {
        const target = element || focusRef.current;
        if (target) {
            target.focus();
        }
    };

    const trapFocus = (containerRef: React.RefObject<HTMLElement>) => {
        useEffect(() => {
            const container = containerRef.current;
            if (!container) return;

            const focusableElements = container.querySelectorAll(
                'a[href], button, textarea, input[type="text"], input[type="radio"], input[type="checkbox"], select'
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
                    } else {
                        if (document.activeElement === lastElement) {
                            firstElement.focus();
                            e.preventDefault();
                        }
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

// Keyboard Navigation Component
export function KeyboardNavigatable({
    children,
    onArrowKeys = true,
    onEnterSpace = true,
    className
}: {
    children: ReactNode;
    onArrowKeys?: boolean;
    onEnterSpace?: boolean;
    className?: string;
}) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            const focusableElements = Array.from(
                container.querySelectorAll('[tabindex="0"], button, a[href], input, select, textarea')
            ) as HTMLElement[];

            const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);

            if (onArrowKeys) {
                switch (e.key) {
                    case 'ArrowDown':
                    case 'ArrowRight':
                        e.preventDefault();
                        const nextIndex = (currentIndex + 1) % focusableElements.length;
                        focusableElements[nextIndex]?.focus();
                        break;
                    case 'ArrowUp':
                    case 'ArrowLeft':
                        e.preventDefault();
                        const prevIndex = currentIndex === 0 ? focusableElements.length - 1 : currentIndex - 1;
                        focusableElements[prevIndex]?.focus();
                        break;
                    case 'Home':
                        e.preventDefault();
                        focusableElements[0]?.focus();
                        break;
                    case 'End':
                        e.preventDefault();
                        focusableElements[focusableElements.length - 1]?.focus();
                        break;
                }
            }

            if (onEnterSpace && (e.key === 'Enter' || e.key === ' ')) {
                const target = e.target as HTMLElement;
                if (target.tagName !== 'BUTTON' && target.tagName !== 'A') {
                    e.preventDefault();
                    target.click();
                }
            }
        };

        container.addEventListener('keydown', handleKeyDown);
        return () => container.removeEventListener('keydown', handleKeyDown);
    }, [onArrowKeys, onEnterSpace]);

    return (
        <div ref={containerRef} className={className}>
            {children}
        </div>
    );
}

// Announcer for Dynamic Content
export function Announcer({
    message,
    politeness = 'polite'
}: {
    message: string;
    politeness?: 'polite' | 'assertive';
}) {
    const announcerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (message && announcerRef.current) {
            // Clear previous message
            announcerRef.current.textContent = '';

            // Set new message with a slight delay to ensure screen readers pick it up
            setTimeout(() => {
                if (announcerRef.current) {
                    announcerRef.current.textContent = message;
                }
            }, 100);
        }
    }, [message]);

    return (
        <div
            ref={announcerRef}
            aria-live={politeness}
            aria-atomic="true"
            className="sr-only"
        />
    );
}

// High Contrast Mode Detection
export function useHighContrastMode() {
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-contrast: high)');

        const handleChange = (e: MediaQueryListEvent) => {
            if (e.matches) {
                document.documentElement.classList.add('high-contrast');
            } else {
                document.documentElement.classList.remove('high-contrast');
            }
        };

        // Set initial state
        if (mediaQuery.matches) {
            document.documentElement.classList.add('high-contrast');
        }

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);
}

// Reduced Motion Detection
export function useReducedMotion() {
    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

        const handleChange = (e: MediaQueryListEvent) => {
            if (e.matches) {
                document.documentElement.classList.add('reduce-motion');
            } else {
                document.documentElement.classList.remove('reduce-motion');
            }
        };

        // Set initial state
        if (mediaQuery.matches) {
            document.documentElement.classList.add('reduce-motion');
        }

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);
}

// Focus Visible Utility
export function useFocusVisible() {
    useEffect(() => {
        let hadKeyboardEvent = true;
        let keyboardThrottleTimeout: NodeJS.Timeout;

        const handlePointerDown = () => {
            hadKeyboardEvent = false;
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.metaKey || e.altKey || e.ctrlKey) {
                return;
            }
            hadKeyboardEvent = true;
        };

        const handleFocus = (e: FocusEvent) => {
            const target = e.target as HTMLElement;
            if (target.matches(':focus-visible') || hadKeyboardEvent) {
                target.classList.add('focus-visible');
            }
        };

        const handleBlur = (e: FocusEvent) => {
            const target = e.target as HTMLElement;
            target.classList.remove('focus-visible');
        };

        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('mousedown', handlePointerDown, true);
        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('touchstart', handlePointerDown, true);
        document.addEventListener('focus', handleFocus, true);
        document.addEventListener('blur', handleBlur, true);

        return () => {
            document.removeEventListener('keydown', handleKeyDown, true);
            document.removeEventListener('mousedown', handlePointerDown, true);
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('touchstart', handlePointerDown, true);
            document.removeEventListener('focus', handleFocus, true);
            document.removeEventListener('blur', handleBlur, true);
        };
    }, []);
} 