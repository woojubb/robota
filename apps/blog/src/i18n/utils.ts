import { ui, defaultLang, languages } from './ui';

export type Lang = keyof typeof languages;

export function useTranslations(lang: Lang) {
  return function t(key: keyof (typeof ui)[typeof defaultLang]): string {
    return ui[lang][key] || ui[defaultLang][key];
  };
}
