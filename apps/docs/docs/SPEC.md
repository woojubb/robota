# SPEC.md — robota-docs

## Scope

Owns the Robota SDK documentation site. A Next.js 15 static-export app that renders Markdown content from the monorepo (`content/` and `packages/*/docs/`) as HTML pages, with multilingual support (en/ko) and full-text search via Pagefind. Deployed to Cloudflare Pages at `docs.robota.io`.

## Boundaries

- Does not own runtime package contracts; Markdown content is sourced from `content/` and `packages/*/docs/` at build time.
- Does not define or enforce package APIs; it renders documentation authored by package owners.
- Does not run agent execution — static export only (`output: 'export'`).
- OWNS: page routing, sidebar generation, MDX rendering pipeline, i18n routing, and site layout.

## Architecture Overview

Next.js 15 app with `output: 'export'` (static HTML). React 19. Internationalization via `next-intl` (locales: `en`, `ko`).

**Build pipeline:**

1. `next build` — generates static HTML under `out/` via `generateStaticParams`.
2. `pagefind --site out` (postbuild) — indexes the output for client-side full-text search.
3. `wrangler pages deploy out --project-name robota-docs --branch main` — deploys to Cloudflare Pages.

**Content sourcing (build-time, Node.js fs):**

- `src/lib/content.ts` — discovers all `.md` files from `content/` and `packages/*/docs/`, maps them to slug arrays, reads and parses them with `gray-matter`, resolves locale-aware fallbacks (ko → en).
- `src/lib/sidebar.ts` — builds the full sidebar tree by reading titles from the same Markdown sources; respects a fixed ordering for the `guide` section.
- `src/lib/toc.ts` — parses `##` / `###` headings from Markdown source to produce a table-of-contents array.

**MDX rendering:**

- `next-mdx-remote/rsc` for server-side MDX rendering.
- Remark plugins: `remark-gfm`, `src/lib/remark-mermaid.ts`, `src/lib/remark-fix-links.ts`.
- Rehype plugins: `rehype-slug`, `rehype-autolink-headings`, `rehype-pretty-code` (shiki, `github-dark`).
- Custom MDX components: `CodeBlock`, `MermaidDiagram`, `Callout`, `PackageManagerTabs`.

**Routing:**

- `src/app/[locale]/[[...slug]]/page.tsx` — catch-all route for all documentation pages, locale-aware.
- `src/app/page.tsx` — root redirect to `/{defaultLocale}`.
- `src/i18n/routing.ts` — defines `locales: ['en', 'ko']`, `defaultLocale: 'en'`.
- `src/messages/en.json` / `src/messages/ko.json` — UI string catalogs.

**Layout components:**

- `src/components/DocsLayout.tsx` — outer shell (sidebar + content + TOC).
- `src/components/Sidebar.tsx` — collapsible sidebar from `buildSidebar()`.
- `src/components/Header.tsx` — top navigation bar.
- `src/components/TableOfContents.tsx` — sticky in-page TOC.
- `src/components/SearchButton.tsx` — Pagefind search trigger.
- `src/components/ThemeToggle.tsx` — dark/light theme switcher.

## Type Ownership

All types are internal to this app. No types are exported to other workspace packages.

| Symbol        | File                                    | Kind      | Description                                          |
| ------------- | --------------------------------------- | --------- | ---------------------------------------------------- |
| `PageContent` | `src/lib/content.ts`                    | interface | Parsed page: `source`, `frontmatter`, `filePath`     |
| `SidebarItem` | `src/lib/sidebar.ts`                    | interface | Recursive sidebar node: `title`, `href`, `children?` |
| `TocEntry`    | `src/lib/toc.ts`                        | interface | TOC heading: `id`, `text`, `level`                   |
| `PageParams`  | `src/app/[locale]/[[...slug]]/page.tsx` | interface | Route params: `locale`, `slug?`                      |

## Public API Surface

No programmatic exports. This is a private static web app (`"private": true`).

| Artifact                      | Kind            | Description                                            |
| ----------------------------- | --------------- | ------------------------------------------------------ |
| Static site (`out/`)          | build output    | Rendered HTML pages for Cloudflare Pages deployment    |
| `src/lib/content.ts`          | internal module | Slug discovery, file resolution, page content parsing  |
| `src/lib/sidebar.ts`          | internal module | Sidebar tree builder (locale-aware)                    |
| `src/lib/toc.ts`              | internal module | Markdown heading extractor for in-page TOC             |
| `src/lib/remark-mermaid.ts`   | internal plugin | Remark plugin transforming Mermaid fences to diagrams  |
| `src/lib/remark-fix-links.ts` | internal plugin | Remark plugin rewriting relative `.md` links to routes |

## Extension Points

- **New documentation sources**: To include a new content directory, update `collectMarkdownFiles` calls and `buildSidebar` in `src/lib/sidebar.ts`.
- **New sidebar section**: Add a `buildSection(...)` call in `buildSidebar()` in `src/lib/sidebar.ts`.
- **New locale**: Add the locale to `routing.ts`, create `src/messages/<locale>.json`, and add Markdown files under `content/<locale>/` for localized content.
- **New MDX components**: Register components in the `components` map in `src/app/[locale]/[[...slug]]/page.tsx`.
- **Site theme / styling**: Edit `src/app/globals.css` (CSS custom properties) and `postcss.config.mjs`.

## Error Taxonomy

No application-level error types. Build failures surface through Next.js build exit codes and Node.js script errors. Missing slug routes return Next.js `notFound()` (404 page).

## Test Strategy

- No test files or test scripts are defined for this app.
- Lint is run via `next lint`.
- TypeScript is validated via `pnpm typecheck` (`tsc --noEmit`).
- Validation relies on successful `pnpm build` (Next.js static export + Pagefind indexing).
- Recommended: link-checking and build smoke tests to catch broken Markdown references.

## Class Contract Registry

No classes exist in this app. It is a documentation-only build pipeline with no TypeScript runtime classes.
