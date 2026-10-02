# apps/www — robota-www

Public marketing website for the Robota project (__PROJECT_WEBSITE_URL__), in English and Korean, deployed to
Cloudflare Pages. Documentation is not served here; it lives at __PROJECT_DOCS_URL__ (`apps/docs`).

## Package

`robota-www` · private · Next.js 15 (static export) · Tailwind CSS v4 · next-intl

## Development

```bash
pnpm --filter robota-www dev       # start dev server on port 3010
pnpm --filter robota-www build     # static export → out/
pnpm --filter robota-www typecheck # TypeScript check (no emit)
pnpm --filter robota-www lint      # ESLint
```

## Deploy

The Cloudflare Pages project `robota-www` is connected to the GitHub repository: a push to `main` deploys
production (`__PROJECT_WEBSITE_HOST__`, `www.__PROJECT_WEBSITE_HOST__`). Other branches get no usable preview, so check a change
locally with `pnpm --filter robota-www dev`, or build and serve the static export (with `_redirects`)
via `pnpm --filter robota-www build && pnpm --filter robota-www exec wrangler pages dev out --compatibility-date=2026-08-01`.

The `deploy` script is a manual fallback that uploads a local build straight to production and needs a
Wrangler login:

```bash
pnpm --filter robota-www run deploy
# equivalent to: next build && wrangler pages deploy out --project-name robota-www --branch main
```

## Legacy documentation redirects

The documentation used to be served from `__PROJECT_WEBSITE_HOST__`. [`public/_redirects`](../public/_redirects) forwards
those old URLs (`/guide/...`, `/examples/...`, `/getting-started/...`, `/packages/...` and similar, including
the old `.html` pages) to the matching English page on `docs.__PROJECT_WEBSITE_HOST__` with a permanent (301) redirect.
When a docs route is renamed, update the matching rule there.

## Spec

See [SPEC.md](./SPEC.md) for the full architectural contract.
