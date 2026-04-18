# Blog Internationalization (i18n) Design

## Overview

Add multi-language support to the Robota blog (apps/blog). Default language is English (no URL prefix). Korean uses `/ko/` prefix. Not all posts require translations.

## URL Structure

| Language          | URL pattern        | Example                            |
| ----------------- | ------------------ | ---------------------------------- |
| English (default) | `/blog/<slug>/`    | `/blog/how-coding-agent-works/`    |
| Korean            | `/ko/blog/<slug>/` | `/ko/blog/how-coding-agent-works/` |
| English index     | `/`                | —                                  |
| Korean index      | `/ko/`             | —                                  |

## File Structure

Migrate from `src/pages/blog/*.md` to Content Collections:

```
src/content/blog/
  en/
    how-coding-agent-works.md
  ko/
    how-coding-agent-works.md
src/content/config.ts          # Zod schema for blog collection
src/pages/
  blog/[...slug].astro         # English blog post route
  index.astro                  # English index
  ko/
    blog/[...slug].astro       # Korean blog post route
    index.astro                # Korean index
src/i18n/
  config.ts                    # i18n configuration
  translations/
    en.json                    # English UI strings
    ko.json                    # Korean UI strings
```

## Content Collections Schema

```ts
// src/content/config.ts
import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
    date: z.string(),
    author: z.string().optional(),
    authorUrl: z.string().url().optional(),
    image: z.string().url().optional(),
    lang: z.enum(['en', 'ko']),
  }),
});

export const collections = { blog };
```

## Translation Mapping

Posts are matched by filename (slug). If `en/how-coding-agent-works.md` and `ko/how-coding-agent-works.md` both exist, they are translations of each other.

If a post exists only in one language, no translation link is shown.

## Routing

### English route: `src/pages/blog/[...slug].astro`

- Query Content Collections for `blog/en/*`
- Render with BlogPost layout
- Include `hreflang` alternate link if Korean version exists

### Korean route: `src/pages/ko/blog/[...slug].astro`

- Query Content Collections for `blog/ko/*`
- Render with BlogPost layout
- Include `hreflang` alternate link if English version exists

### Index pages

- `/` — list English posts
- `/ko/` — list Korean posts

## UI i18n

### Library

Use `@astrolicious/i18n` or `astro-i18next` for UI string management.

### Translation files

```json
// src/i18n/translations/en.json
{
  "nav.blog": "blog",
  "theme.toggle": "Toggle theme",
  "post.readMore": "Read more",
  "lang.switch": "한국어"
}
```

```json
// src/i18n/translations/ko.json
{
  "nav.blog": "블로그",
  "theme.toggle": "테마 전환",
  "post.readMore": "더 보기",
  "lang.switch": "English"
}
```

### Language Switcher

Header navigation: EN / KO toggle button next to theme toggle.

- On a post page: if translation exists, link to translated version. If not, link to the other language's index.
- On index page: link to other language's index.

## SEO

### HTML lang attribute

- English pages: `<html lang="en">`
- Korean pages: `<html lang="ko">`

### hreflang tags

On every page that has a translation:

```html
<link rel="alternate" hreflang="en" href="https://blog.robota.io/blog/how-coding-agent-works/" />
<link rel="alternate" hreflang="ko" href="https://blog.robota.io/ko/blog/how-coding-agent-works/" />
```

### Sitemap

Include all language versions. Astro sitemap integration handles this with i18n config.

## Migration Plan

1. Install i18n library
2. Create Content Collections schema (`src/content/config.ts`)
3. Move `src/pages/blog/how-coding-agent-works.md` → `src/content/blog/en/how-coding-agent-works.md`
4. Create Korean version at `src/content/blog/ko/how-coding-agent-works.md`
5. Create dynamic route pages (`blog/[...slug].astro`, `ko/blog/[...slug].astro`)
6. Update index pages for both languages
7. Add i18n translation files
8. Add language switcher to header
9. Update layouts with `lang` attribute and `hreflang` tags
10. Update sitemap config

## Out of Scope

- Automatic translation (manual only)
- More than 2 languages (extensible but not implemented now)
- Language detection / auto-redirect based on browser locale

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
