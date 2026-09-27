# Robota Blog

Astro-based blog with a terminal-themed dark UI, published at https://blog.robota.io. It is internal to
the monorepo (`robota-blog`, private) and imports no Robota packages.

- **URL**: https://blog.robota.io
- **Framework**: Astro (static output, English and Korean locales)
- **Hosting**: Cloudflare Pages (project `robota`)
- **Design**: Terminal dark theme (JetBrains Mono + Noto Sans KR, #39ff85 green accent)

## Local Development

From the monorepo root:

```sh
pnpm --filter robota-blog dev        # dev server (localhost:4321)
pnpm --filter robota-blog build      # production build → dist/
pnpm --filter robota-blog preview    # preview the build locally
pnpm --filter robota-blog typecheck  # astro sync + TypeScript check
```

## Deployment

The Cloudflare Pages project `robota` is connected to the GitHub repository. A push to `main` builds and
deploys production (`blog.robota.io`); a push to any other branch builds a preview at
`<branch>.robota.pages.dev`. Nothing needs to be run by hand.

### Build Settings (Dashboard)

| Setting                | Value                             |
| ---------------------- | --------------------------------- |
| Framework preset       | Astro                             |
| Build command          | `pnpm --filter robota-blog build` |
| Build output directory | `apps/blog/dist`                  |
| Root directory         | `/`                               |

Environment variable: `NODE_VERSION` = `22` (the package requires Node `>=22.12.0`).

### Manual deploy (fallback)

```sh
pnpm --filter robota-blog deploy
# astro build && wrangler pages deploy dist --project-name robota --branch main
```

This uploads a local build straight to production and needs a Wrangler login with access to the
project. Use it only when the Git integration cannot be used.

## Adding a New Post

Posts live in the Astro content collection at `src/content/blog/{en,ko}/` (defined in
`src/content.config.ts`). Add a `.md` or `.mdx` file under the folder for its locale — `en/` for
English, `ko/` for Korean — with frontmatter that satisfies the collection schema:

```md
---
title: "Post Title"
subtitle: "Optional subtitle"
date: "2026-01-01"
author: "Author Name"        # optional
authorUrl: "https://..."     # optional, must be a URL
image: "https://..."         # optional, must be a URL
lang: "en"                   # required — must be "en" or "ko"
---

Content here...
```

Required fields: `title`, `date`, `lang`. The `lang` value must match the folder (`en` or `ko`) and
is what the listing pages (`src/pages/index.astro`, `src/pages/ko/index.astro`) filter on. No
`layout` field is needed — rendering is handled by the collection's route template.
