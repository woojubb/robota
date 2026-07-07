# Robota Blog

Astro-based blog with terminal-themed dark UI. Deployed to Cloudflare Pages.

- **URL**: https://blog.robota.io
- **Framework**: Astro 6
- **Hosting**: Cloudflare Pages
- **Design**: Terminal dark theme (JetBrains Mono + Noto Sans KR, #39ff85 green accent)

## Local Development

From monorepo root:

```sh
pnpm --filter robota-blog dev      # dev server (localhost:4321)
pnpm --filter robota-blog build    # production build → dist/
pnpm --filter robota-blog preview  # preview build locally
```

## Cloudflare Pages Deployment

### Build Settings (Dashboard)

| Setting | Value |
|---------|-------|
| Framework preset | Astro |
| Build command | `pnpm --filter robota-blog build` |
| Build output directory | `apps/blog/dist` |
| Root directory | `/` |

### Environment Variables

| Variable | Value |
|----------|-------|
| `NODE_VERSION` | `22` |

### Custom Domain

`blog.robota.io` → Cloudflare Pages Custom domains

### Deploy Trigger

Push to the connected branch triggers automatic build and deploy.

## Adding a New Post

Posts live in the Astro content collection at `src/content/blog/{en,ko}/` (defined in
`src/content.config.ts`). Add a `.md` or `.mdx` file under the folder for its locale — `en/` for
English, `ko/` for Korean — with frontmatter that satisfies the collection schema:

```md
---
title: "Post Title"
subtitle: "Optional subtitle"
date: "2026-01-01"
author: "Author Name"       # optional
authorUrl: "https://..."     # optional
image: "https://..."         # optional
lang: "en"                    # required — must be "en" or "ko"
---

Content here...
```

Required fields: `title`, `date`, `lang`. The `lang` value must match the folder (`en` or `ko`) and
is what the listing pages (`src/pages/index.astro`, `src/pages/ko/index.astro`) filter on. No
`layout` field is needed — rendering is handled by the collection's route template.
