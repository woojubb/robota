# SPEC.md — robota-blog

## Scope

Robota SDK blog. Publishes technical articles on coding agents, AI, and SDK development using Astro (plain, no Starlight). Deployed to Cloudflare Pages at `blog.robota.io`.

## Boundaries

- Does NOT own SDK logic — imports no workspace packages.
- Does NOT run agent execution — static site generation only.
- OWNS: blog content collection, multilingual routing (en/ko), layout and styling.

## Architecture Overview

Astro static site with a custom blog layout. No Starlight or UI framework integration.

**Content pipeline:**

1. `src/content.config.ts` — defines the `blog` collection using Astro's `glob` loader over `src/content/blog/`.
2. `src/pages/[...slug].astro` / `src/pages/ko/[...slug].astro` — dynamic page routes that render individual posts per locale.
3. `src/pages/index.astro` / `src/pages/ko/index.astro` — listing pages that filter posts by `lang` field.
4. `src/layouts/Base.astro` / `src/layouts/BlogPost.astro` — shared layout and per-post layout.

**Markdown processing:**

- `rehype-pretty-code` (shiki, `github-dark` theme) for syntax highlighting.
- `remark-toc` for auto-generated table of contents.
- `src/plugins/remark-mermaid.mjs` — custom remark plugin for Mermaid diagram support.
- `rehype-autolink-headings` for anchor links.

**i18n:** Astro built-in i18n with `defaultLocale: 'en'` and `locales: ['en', 'ko']`, no locale prefix for default. Translations managed in `src/i18n/ui.ts`.

**Sitemap:** Auto-generated via `@astrojs/sitemap`.

**Deployment:** Cloudflare Pages. Wrangler project name `robota`, output directory `dist`.

## Type Ownership

All types are defined in this app. No types exported to other workspace packages.

| Symbol            | File                    | Kind       | Description                              |
| ----------------- | ----------------------- | ---------- | ---------------------------------------- |
| `blog` collection | `src/content.config.ts` | Zod schema | Frontmatter schema for blog post entries |

**Frontmatter schema fields:**

| Field       | Type           | Required | Description                 |
| ----------- | -------------- | -------- | --------------------------- |
| `title`     | `string`       | yes      | Post title                  |
| `subtitle`  | `string`       | no       | Optional subtitle           |
| `date`      | `string`       | yes      | Publication date (ISO 8601) |
| `author`    | `string`       | no       | Author name                 |
| `authorUrl` | `string` (URL) | no       | Author URL                  |
| `image`     | `string` (URL) | no       | Cover image URL             |
| `lang`      | `'en' \| 'ko'` | yes      | Post locale                 |

## Public API Surface

No programmatic exports. This is a private static web app (`"private": true`).

| Artifact                         | Kind            | Description                                           |
| -------------------------------- | --------------- | ----------------------------------------------------- |
| Static site (`dist/`)            | build output    | Rendered HTML pages for Cloudflare Pages deployment   |
| `src/plugins/remark-mermaid.mjs` | internal plugin | Remark plugin transforming Mermaid fences to diagrams |
| `public/_redirects`              | routing config  | Cloudflare Pages redirect rules                       |

## Extension Points

- **New blog posts**: Add `.md` / `.mdx` files under `src/content/blog/en/` or `src/content/blog/ko/`. Files must satisfy the frontmatter schema in `src/content.config.ts`.
- **New locale**: Add a locale to `astro.config.mjs` `i18n.locales`, add UI strings to `src/i18n/ui.ts`, and add a `pages/<locale>/` subtree mirroring `pages/`.
- **Markdown plugins**: Add remark/rehype plugins in `astro.config.mjs` under `markdown.remarkPlugins` / `markdown.rehypePlugins`.
- **Layout customization**: Edit `src/layouts/Base.astro` (site chrome) or `src/layouts/BlogPost.astro` (per-post layout).
- **Styles**: `src/styles/global.css` and `public/styles/global.css` for global CSS custom properties and typography.

## Error Taxonomy

No application-level error types. Build failures surface through Astro build exit codes. Runtime errors surface as Astro 404 pages for missing slug routes.

## Test Strategy

- No test files or test scripts are defined for this app.
- Validation relies on successful `pnpm build` (Astro static build).
- TypeScript is validated via `pnpm typecheck` (`astro sync && tsc --noEmit`).
- Recommended: link-checking and build smoke tests to catch broken content references.

## Class Contract Registry

No classes exist in this app. It is a static Astro site with no TypeScript runtime classes.

## Build

```
pnpm run dev        # astro dev (local dev server)
pnpm run build      # astro build → dist/
pnpm run preview    # astro preview (serve dist/ locally)
pnpm run typecheck  # astro sync && tsc --noEmit
```
