'use client';

import { useEffect } from 'react';
import { useHighContrastMode, useReducedMotion, useFocusVisible } from '@/components/ui/accessibility';

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
    // Initialize accessibility features
    useHighContrastMode();
    useReducedMotion();
    useFocusVisible();

    // Additional accessibility setup
    useEffect(() => {
        // Set initial ARIA attributes on the document
        document.documentElement.setAttribute('lang', 'en');

        // Add meta tags for better accessibility
        const viewport = document.querySelector('meta[name="viewport"]');
        if (viewport) {
            viewport.setAttribute('content', viewport.getAttribute('content') + ', user-scalable=yes');
        }

        // Prefers color scheme detection
        const prefersColorScheme = window.matchMedia('(prefers-color-scheme: dark)');
        const handleColorSchemeChange = (e: MediaQueryListEvent) => {
            document.documentElement.setAttribute('data-prefers-color-scheme', e.matches ? 'dark' : 'light');
        };

        document.documentElement.setAttribute('data-prefers-color-scheme', prefersColorScheme.matches ? 'dark' : 'light');
        prefersColorScheme.addEventListener('change', handleColorSchemeChange);

        return () => {
            prefersColorScheme.removeEventListener('change', handleColorSchemeChange);
        };
    }, []);

    return <>{children}</>;
} 