import { ui, defaultLang, languages } from './ui';

export type Lang = keyof typeof languages;

export function getLangFromUrl(url: URL): Lang {
  const [, lang] = url.pathname.split('/');
  if (lang in languages) return lang as Lang;
  return defaultLang;
}

export function useTranslations(lang: Lang) {
  return function t(key: keyof (typeof ui)[typeof defaultLang]): string {
    return ui[lang][key] || ui[defaultLang][key];
  };
}

export function getLocalePath(lang: Lang, path: string): string {
  if (lang === defaultLang) return path;
  return `/${lang}${path}`;
}

export function getSwitchLangPath(currentLang: Lang, currentPath: string): string {
  const targetLang = currentLang === 'en' ? 'ko' : 'en';
  if (currentLang === defaultLang) {
    // Currently on /blog/slug → switch to /ko/blog/slug
    return `/${targetLang}${currentPath}`;
  } else {
    // Currently on /ko/blog/slug → switch to /blog/slug
    return currentPath.replace(`/${currentLang}`, '');
  }
}
