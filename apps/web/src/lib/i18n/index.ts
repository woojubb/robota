import { ko } from './translations/ko';
import { en } from './translations/en';
import { ja } from './translations/ja';
import { i18n, Locale, detectLocale, saveLocale } from './config';

export { type Locale, i18n, detectLocale, saveLocale };

// All translations
export const translations = {
    ko,
    en,
    ja,
} as const;

// Type for nested translation keys
type NestedKeyOf<T> = T extends object
    ? {
        [K in keyof T]: K extends string
        ? T[K] extends object
        ? `${K}.${NestedKeyOf<T[K]>}`
        : K
        : never;
    }[keyof T]
    : never;

export type TranslationKey = NestedKeyOf<typeof ko>;

// Get nested property from object using dot notation
function getNestedProperty(obj: any, path: string): string {
    return path.split('.').reduce((current, key) => current?.[key], obj) || path;
}

// Translation function
export function t(key: TranslationKey, locale: Locale = 'ko'): string {
    const translation = translations[locale];
    if (!translation) {
        console.warn(`Translation not found for locale: ${locale}`);
        return key;
    }

    const value = getNestedProperty(translation, key);
    if (value === key) {
        console.warn(`Translation key not found: ${key} for locale: ${locale}`);
        // Fallback to Korean if key not found
        if (locale !== 'ko') {
            return getNestedProperty(translations.ko, key) || key;
        }
    }

    return value;
} 