export const i18n = {
    defaultLocale: 'ko',
    locales: ['ko', 'en', 'ja'],
} as const;

export type Locale = (typeof i18n)['locales'][number];

export const localeNames: Record<Locale, string> = {
    ko: '한국어',
    en: 'English',
    ja: '日本語',
};

export const localeFlags: Record<Locale, string> = {
    ko: '🇰🇷',
    en: '🇺🇸',
    ja: '🇯🇵',
};

// Detect user's preferred locale
export function detectLocale(): Locale {
    if (typeof window === 'undefined') {
        return i18n.defaultLocale;
    }

    // Check localStorage first
    const stored = localStorage.getItem('locale') as Locale;
    if (stored && i18n.locales.includes(stored)) {
        return stored;
    }

    // Check browser language
    const browserLang = navigator.language.split('-')[0] as Locale;
    if (i18n.locales.includes(browserLang)) {
        return browserLang;
    }

    // Default fallback
    return i18n.defaultLocale;
}

// Save locale preference
export function saveLocale(locale: Locale): void {
    if (typeof window !== 'undefined') {
        localStorage.setItem('locale', locale);
    }
} 