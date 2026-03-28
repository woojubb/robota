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

Create a markdown file in `src/pages/blog/`:

```md
---
layout: ../../layouts/BlogPost.astro
title: "Post Title"
subtitle: "Optional subtitle"
date: "2026-01-01"
---

Content here...
```
