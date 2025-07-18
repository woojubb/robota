'use client';

import { useState, useEffect, useCallback } from 'react';
import { Locale, TranslationKey, t, detectLocale, saveLocale } from '@/lib/i18n';

export function useTranslation() {
    const [locale, setLocaleState] = useState<Locale>('ko');
    const [isInitialized, setIsInitialized] = useState(false);

    // Initialize locale from storage or browser preferences
    useEffect(() => {
        const detectedLocale = detectLocale();
        setLocaleState(detectedLocale);
        setIsInitialized(true);
    }, []);

    // Translation function that uses current locale
    const translate = useCallback((key: TranslationKey): string => {
        return t(key, locale);
    }, [locale]);

    // Change locale and save preference
    const setLocale = useCallback((newLocale: Locale) => {
        setLocaleState(newLocale);
        saveLocale(newLocale);

        // Update document language
        if (typeof document !== 'undefined') {
            document.documentElement.lang = newLocale;
        }
    }, []);

    return {
        locale,
        setLocale,
        t: translate,
        isInitialized,
    };
}

// Simplified hook for quick translations
export function useT() {
    const { t } = useTranslation();
    return t;
} 