export const languages = {
  en: 'English',
  ko: '한국어',
} as const;

export const defaultLang = 'en' as const;

export const ui = {
  en: {
    'nav.blog': 'blog',
    'site.title': 'Robota Blog',
    'site.description': 'Coding agents, AI, and development',
    'theme.toggle': 'Toggle theme',
    'lang.switch': '한국어',
  },
  ko: {
    'nav.blog': '블로그',
    'site.title': 'Robota Blog',
    'site.description': '코딩 에이전트, AI, 개발 이야기',
    'theme.toggle': '테마 전환',
    'lang.switch': 'English',
  },
} as const;
