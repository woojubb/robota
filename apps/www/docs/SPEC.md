# SPEC.md — apps/www (robota-www)

**Package**: `robota-www` (private)
**Type**: Next.js 15 application (static export)
**Deploy target**: Cloudflare Pages (`robota-www` project)
**Live URL**: `https://www.robota.io`

---

## 1. Scope

`apps/www` owns the public marketing website for the Robota project. It renders the product landing page, feature comparison, showcase gallery, roadmap, enterprise information, and beta sign-up form. The app is statically exported to the `out/` directory and deployed to Cloudflare Pages via Wrangler. It supports two locales (English and Korean) through next-intl.

---

## 2. Boundaries

This app does **not** own:

- The Robota SDK, agent runtime, or any `@robota-sdk/*` packages — those live in `packages/`.
- API documentation or technical reference content — that belongs to `apps/docs`.
- The visual agent playground — that belongs to `apps/agent-web`.
- Any server-side database, authentication system, or persistent user state. The beta form POSTs to `/api/beta` at runtime (client-side fetch), but this app does not own or implement that endpoint — it is expected to be provided by a separate API layer or a Cloudflare Worker.
- Global design tokens or shared UI components — styling is entirely local to this app via Tailwind CSS v4 and `globals.css`.

---

## 3. Architecture Overview

### Runtime model

The app uses Next.js 15 with `output: 'export'` (static export). There are no server-side API routes or SSR pages at build time. All pages except `src/app/[locale]/beta/page.tsx` are async Server Components that call next-intl server helpers (`getTranslations`, `setRequestLocale`) during static generation.

### Layer structure

```
apps/www/
├── src/
│   ├── app/                    Next.js App Router root
│   │   ├── layout.tsx          Root layout (imports globals.css, renders children as ReactElement)
│   │   ├── page.tsx            Root page — client component, browser-language redirect to /[locale]
│   │   ├── globals.css         Global Tailwind v4 theme tokens and base styles
│   │   └── [locale]/           Locale-scoped route segment
│   │       ├── layout.tsx      Locale layout: sets metadata, wraps in NextIntlClientProvider + Header + Footer
│   │       ├── page.tsx        Home/landing page (hero, features grid, CTA)
│   │       ├── compare/        Why Robota — feature comparison table page
│   │       ├── enterprise/     Enterprise security policy and contact page
│   │       ├── roadmap/        Public roadmap with Now/Next/Later sections
│   │       ├── showcase/       Featured and community projects gallery
│   │       └── beta/           Beta sign-up form (client component, posts to /api/beta)
│   ├── components/
│   │   ├── Header.tsx          Sticky navigation bar with locale switcher (client component)
│   │   ├── Footer.tsx          Site-wide footer with link columns (client component)
│   │   └── CostCalculator.tsx  Interactive BYOK cost estimator widget (client component)
│   ├── i18n/
│   │   ├── routing.ts          next-intl routing config — locales ['en', 'ko'], defaultLocale 'en'
│   │   └── request.ts          next-intl server request config — loads locale JSON from messages/
│   └── messages/
│       ├── en.json             English message catalog (SSOT for all copy)
│       └── ko.json             Korean message catalog
├── next.config.ts              Next.js config: static export + next-intl plugin
├── wrangler.toml               Cloudflare Pages config: project robota-www, output dir out/
└── docs/
    ├── README.md               Developer quickstart
    └── SPEC.md                 This file
```

### Routing

| Route                  | Component                              | Rendering                                   |
| ---------------------- | -------------------------------------- | ------------------------------------------- |
| `/`                    | `src/app/page.tsx`                     | Client — JS redirect to `/{browser-locale}` |
| `/{locale}`            | `src/app/[locale]/page.tsx`            | Static (SSG)                                |
| `/{locale}/compare`    | `src/app/[locale]/compare/page.tsx`    | Static (SSG)                                |
| `/{locale}/enterprise` | `src/app/[locale]/enterprise/page.tsx` | Static (SSG)                                |
| `/{locale}/roadmap`    | `src/app/[locale]/roadmap/page.tsx`    | Static (SSG)                                |
| `/{locale}/showcase`   | `src/app/[locale]/showcase/page.tsx`   | Static (SSG)                                |
| `/{locale}/beta`       | `src/app/[locale]/beta/page.tsx`       | Client (not statically generated)           |
| `/robots.txt`          | `src/app/robots.ts`                    | Static route handler (`force-static`)       |
| `/sitemap.xml`         | `src/app/sitemap.ts`                   | Static route handler (`force-static`)       |

Supported locales: `en`, `ko`. Locale is the first URL segment under every route. `generateStaticParams` in the locale layout emits both locales at build time.

### i18n

All user-visible strings are stored in `src/messages/{locale}.json`. The message catalog is loaded server-side via next-intl's `getRequestConfig` and passed to `NextIntlClientProvider` so client components can also consume translations. No inline string literals appear in page components — all copy is looked up via `t()` or `t.raw()`.

### Styling

Tailwind CSS v4 (PostCSS plugin). Theme tokens are defined as CSS custom properties in `globals.css` under `:root`. The design system is dark-mode only (no light/dark switch). The `tw-animate-css` package provides animation utilities.

---

## 4. Type Ownership

This app defines no exported TypeScript types. All types are file-local.

| Type       | Location                         | Purpose                                               |
| ---------- | -------------------------------- | ----------------------------------------------------- |
| `FormData` | `src/app/[locale]/beta/page.tsx` | Local state shape for the beta sign-up form fields    |
| `Locale`   | `src/i18n/routing.ts`            | Union type `'en' \| 'ko'` derived from routing config |

Inline anonymous data shapes (e.g., `Array<{ icon: string; title: string; description: string }>` cast from `t.raw()` return values) exist in page components but are not named types — they are local casts only.

---

## 5. Public API Surface

This app is a static website. It has no npm exports and no TypeScript module boundary. The "public API surface" is its HTTP URL structure.

### Static pages (generated at build time)

| URL pattern            | Kind          | Description                                                             |
| ---------------------- | ------------- | ----------------------------------------------------------------------- |
| `/`                    | HTML redirect | Client-side browser-language redirect to `/{locale}`                    |
| `/{locale}`            | HTML page     | Product landing page                                                    |
| `/{locale}/compare`    | HTML page     | Feature comparison vs Claude Code, Cursor, Aider, Cline                 |
| `/{locale}/enterprise` | HTML page     | Enterprise security policy, data handling, FAQ, contact                 |
| `/{locale}/roadmap`    | HTML page     | Public roadmap — Now/Next/Later sections                                |
| `/{locale}/showcase`   | HTML page     | Featured and community projects gallery                                 |
| `/{locale}/beta`       | HTML page     | Beta access sign-up form                                                |
| `/robots.txt`          | Text          | Generated by `src/app/robots.ts` — crawl rules + sitemap/host (SEO-001) |
| `/sitemap.xml`         | XML           | Generated by `src/app/sitemap.ts` — every locale × route URL (SEO-001)  |

### Runtime HTTP dependency

| Endpoint    | Method | Consumer                         | Description                                                                                                            |
| ----------- | ------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/api/beta` | `POST` | `src/app/[locale]/beta/page.tsx` | Beta application submission. Not implemented in this app — must be provided externally (Cloudflare Worker or similar). |

### React component exports

The following components are importable from within the app but are not part of any external package boundary:

| Export           | Kind                     | File                                | Description                            |
| ---------------- | ------------------------ | ----------------------------------- | -------------------------------------- |
| `Header`         | named function component | `src/components/Header.tsx`         | Sticky navigation bar                  |
| `Footer`         | named function component | `src/components/Footer.tsx`         | Site-wide footer                       |
| `CostCalculator` | named function component | `src/components/CostCalculator.tsx` | Interactive BYOK cost estimator        |
| `routing`        | const                    | `src/i18n/routing.ts`               | next-intl routing configuration object |
| `Locale`         | type                     | `src/i18n/routing.ts`               | Locale union type `'en' \| 'ko'`       |

---

## 6. Extension Points

This app is a static marketing site. There are no plugin hooks, provider registrations, or formal extension mechanisms.

The intended extension patterns are:

- **Adding a new page**: create `src/app/[locale]/{slug}/page.tsx` as an async Server Component; add translations to `src/messages/en.json` and `src/messages/ko.json`; add navigation links to `Header.tsx` and `Footer.tsx`.
- **Adding a new locale**: add the locale string to `routing.locales` in `src/i18n/routing.ts`; add a corresponding `src/messages/{locale}.json`; update `generateStaticParams` in `src/app/[locale]/layout.tsx`.
- **Updating copy/content**: edit the relevant key in `src/messages/en.json` (and `ko.json`). Page components consume all copy via `t()` — no inline strings to update.
- **Theming**: adjust CSS custom properties in `src/app/globals.css` under `:root`.

---

## 7. Error Taxonomy

This app has no domain error classes. The only runtime error surface is in the beta sign-up form.

| Error condition                                | Location                                        | Handling                                                                                                |
| ---------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /api/beta` non-2xx response              | `src/app/[locale]/beta/page.tsx` `handleSubmit` | Sets `error` state to `"Submission failed: {statusText}"`; displayed as red alert banner above the form |
| Unexpected JS exception during form submission | `src/app/[locale]/beta/page.tsx` `handleSubmit` | Sets `error` state to `err.message` or `"Submission failed. Please try again."`                         |
| Unknown locale in request                      | `src/i18n/request.ts`                           | Falls back to `routing.defaultLocale` (`'en'`)                                                          |
| Missing translation key                        | next-intl default                               | next-intl logs a warning and returns the key path as a string                                           |

---

## 8. Test Strategy

There are currently **no automated tests** in this app. No test framework (Jest, Vitest, Playwright) is configured.

### Current state

- Test files: 0
- Test configuration: none
- Coverage: 0%

### Recommended test additions (not yet implemented)

- Smoke test: build succeeds and `out/` contains the expected HTML files for both locales.
- Locale routing: `src/i18n/routing.ts` resolves `['en', 'ko']` with default `'en'`.
- `CostCalculator` unit test: verify cost formula output for known inputs (e.g., 2h/day, Claude Sonnet, mixed, moderate).
- Beta form: `FormData` validation — required fields `name`, `email`, `useCase` prevent submission when empty.

---

## 9. Class Contract Registry

This app uses React function components exclusively. There are no `class` declarations, no `implements` constraints, and no `extends` relationships in the source code.

| Symbol           | Kind                                | File                                   | Extends / Implements |
| ---------------- | ----------------------------------- | -------------------------------------- | -------------------- |
| `RootLayout`     | function component                  | `src/app/layout.tsx`                   | —                    |
| `RootPage`       | function component                  | `src/app/page.tsx`                     | —                    |
| `LocaleLayout`   | async function component            | `src/app/[locale]/layout.tsx`          | —                    |
| `HomePage`       | async function component            | `src/app/[locale]/page.tsx`            | —                    |
| `ComparePage`    | async function component            | `src/app/[locale]/compare/page.tsx`    | —                    |
| `EnterprisePage` | async function component            | `src/app/[locale]/enterprise/page.tsx` | —                    |
| `RoadmapPage`    | async function component            | `src/app/[locale]/roadmap/page.tsx`    | —                    |
| `ShowcasePage`   | async function component            | `src/app/[locale]/showcase/page.tsx`   | —                    |
| `BetaPage`       | function component (`'use client'`) | `src/app/[locale]/beta/page.tsx`       | —                    |
| `Header`         | function component (`'use client'`) | `src/components/Header.tsx`            | —                    |
| `Footer`         | function component (`'use client'`) | `src/components/Footer.tsx`            | —                    |
| `CostCalculator` | function component (`'use client'`) | `src/components/CostCalculator.tsx`    | —                    |
| `Check`          | function component                  | `src/app/[locale]/compare/page.tsx`    | —                    |
| `Cross`          | function component                  | `src/app/[locale]/compare/page.tsx`    | —                    |
