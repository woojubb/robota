import en from './locales/en.json';
import ko from './locales/ko.json';

/** Each language's name, written in that language. The strings live in `locales/<lang>.json`. */
export const languages = {
  en: en.languageName,
  ko: ko.languageName,
} as const;

export const defaultLang = 'en' as const;

function strings(catalog: typeof en, other: typeof en) {
  return {
    'nav.blog': catalog['nav.blog'],
    'site.title': catalog['site.title'],
    'site.description': catalog['site.description'],
    'theme.toggle': catalog['theme.toggle'],
    // The language switch names the other language in that language, so its readers can find it.
    'lang.switch': other.languageName,
  };
}

export const ui = {
  en: strings(en, ko),
  ko: strings(ko, en),
} as const;
